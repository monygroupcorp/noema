/**
 * agentFaucetWorker.js
 *
 * Daily sweep: for each active treasury that is due for a drip, score its
 * active agent sub-accounts by session recency and distribute points from
 * the treasury balance, subject to per-agent monthly caps.
 *
 * Cadence is checked per-treasury (weekly / biweekly / monthly) against
 * treasury.lastDripAt — the worker itself runs daily.
 */

const FAUCET_INTERVAL_MS = 24 * 60 * 60 * 1000; // run daily; per-treasury cadence checked inside

const CADENCE_DAYS = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

/**
 * Run one faucet sweep across all active treasuries.
 *
 * @param {{
 *   treasuryDb: object,
 *   agentAccountDb: object,
 *   faucetDripsDb: object,
 *   economyService: object,
 *   logger: object,
 * }} deps
 * @returns {Promise<{ treasuriesProcessed: number, agentsDripped: number, totalPointsDripped: number, errors: number }>}
 */
async function runFaucet({ treasuryDb, agentAccountDb, faucetDripsDb, economyService, logger }) {
  const log = logger || console;

  let treasuriesProcessed = 0;
  let agentsDripped = 0;
  let totalPointsDripped = 0;
  let errors = 0;

  const treasuries = await treasuryDb.findActiveTreasuries();

  for (const treasury of treasuries) {
    try {
      // ── a. Cadence check ───────────────────────────────────────────────────
      const cadenceDays = CADENCE_DAYS[treasury.faucetPolicy?.refillCadence] ?? 30;
      const cadenceMs = cadenceDays * 86400000;
      const lastDrip = treasury.lastDripAt ? new Date(treasury.lastDripAt) : null;
      const isDue = !lastDrip || (Date.now() - lastDrip.getTime() >= cadenceMs);

      if (!isDue) {
        log.debug(`[agentFaucetWorker] Treasury ${treasury.treasuryId} not yet due — skipping`);
        continue;
      }

      // ── b. Load active agents ──────────────────────────────────────────────
      const agents = await agentAccountDb.findActiveByTreasuryId(treasury.treasuryId);
      if (agents.length === 0) {
        log.debug(`[agentFaucetWorker] Treasury ${treasury.treasuryId} has no active agents — skipping`);
        continue;
      }

      // ── c. Score each agent (v1: pure recency) ────────────────────────────
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);

      const scored = agents.map(agent => {
        // Clamp to [0, 30]: Math.max(0, ...) handles future-dated sessionIssuedAt (clock skew
        // or renewed sessions), preventing score from exceeding 1.0.
        const sessionRecencyDays = Math.min(
          30,
          Math.max(0, (periodEnd.getTime() - new Date(agent.sessionIssuedAt).getTime()) / 86400000),
        );
        // Newer agents score higher: 1 at day 0, 0 at day 30
        const score = Math.max(0, (30 - sessionRecencyDays) / 30);
        return { ...agent, sessionRecencyDays, score };
      });

      const totalScore = scored.reduce((sum, a) => sum + a.score, 0);
      if (totalScore === 0) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} — all agent scores are 0, skipping`);
        continue;
      }

      // ── d. Compute drip amounts with monthly cap ───────────────────────────
      // Cap window starts at lastDripAt (cadence-aligned), not the first of the calendar month.
      // This prevents agents who receive a weekly drip from accumulating points that
      // exceed monthlyMax just because calendar-month arithmetic resets the window early.
      const capWindowStart = treasury.lastDripAt ? new Date(treasury.lastDripAt) : new Date(periodEnd.getTime() - cadenceMs);
      const monthlyMax = treasury.faucetPolicy?.monthlyMax ?? 0;
      if (monthlyMax === 0) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} has monthlyMax=0 — no drips will be issued; check faucetPolicy`);
        continue;
      }

      // perCycleBudget is the explicit sweep pool. Fall back to monthlyMax for legacy treasuries
      // that predate Fix 4 (no migration required). Warn so ops know to set it explicitly.
      const perCycleBudget = treasury.faucetPolicy?.perCycleBudget ?? treasury.faucetPolicy?.monthlyMax ?? null;
      if (perCycleBudget === null) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} has neither perCycleBudget nor monthlyMax — skipping; check faucetPolicy`);
        continue;
      }
      if (treasury.faucetPolicy?.perCycleBudget == null) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} missing perCycleBudget — falling back to monthlyMax=${monthlyMax}; set faucetPolicy.perCycleBudget`);
      }
      const cycleBudget = Math.min(perCycleBudget, treasury.balance);

      const agentsWithAlloc = [];
      for (const agent of scored) {
        const dripsThisCycle = await faucetDripsDb.findByAgentAndPeriod(agent.agentAccountId, capWindowStart);
        const pointsReceivedThisCycle = dripsThisCycle.reduce((sum, d) => sum + d.amount, 0);
        const cap = Math.max(0, monthlyMax - pointsReceivedThisCycle);

        const rawAlloc = Math.floor((agent.score / totalScore) * cycleBudget);
        const dripAmount = Math.min(rawAlloc, cap);

        agentsWithAlloc.push({ agent, dripAmount, cap });
      }

      // ── e. Drip each agent (sequential, fail-safe) ────────────────────────
      let treasuryBalanceExhausted = false;

      for (const { agent, dripAmount } of agentsWithAlloc) {
        if (dripAmount <= 0) continue;

        // Once exhausted, write skipped records for all remaining agents with non-zero allocations.
        if (treasuryBalanceExhausted) {
          try {
            await faucetDripsDb.createDrip({
              treasuryId: treasury.treasuryId,
              agentAccountId: agent.agentAccountId,
              noemaAccountId: agent.noemaAccountId,
              amount: dripAmount,
              periodStart,
              periodEnd,
              scoringInputs: { sessionRecencyDays: agent.sessionRecencyDays, score: agent.score },
              creditLedgerEntryId: null,
              status: 'skipped',
              failureReason: 'INSUFFICIENT_BALANCE',
            });
          } catch (dripErr) {
            log.warn('[agentFaucetWorker] failed to record skipped drip for exhausted agent', { agentAccountId: agent.agentAccountId, error: dripErr.message });
          }
          continue;
        }

        // Atomic debit — may fail mid-sweep if treasury runs dry
        const debited = await treasuryDb.debitBalance(treasury.treasuryId, dripAmount);
        if (!debited) {
          log.warn('[agentFaucetWorker] Treasury insufficient balance mid-sweep', {
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            dripAmount,
          });
          try {
            await faucetDripsDb.createDrip({
              treasuryId: treasury.treasuryId,
              agentAccountId: agent.agentAccountId,
              noemaAccountId: agent.noemaAccountId,
              amount: dripAmount,
              periodStart,
              periodEnd,
              scoringInputs: {
                sessionRecencyDays: agent.sessionRecencyDays,
                score: agent.score,
              },
              creditLedgerEntryId: null,
              status: 'skipped',
              failureReason: 'INSUFFICIENT_BALANCE',
            });
          } catch (dripErr) {
            log.warn('[agentFaucetWorker] failed to record mid-sweep skipped drip', { agentAccountId: agent.agentAccountId, error: dripErr.message });
          }
          treasuryBalanceExhausted = true;
          continue;
        }

        // ── Stage 1: credit agent sub-account balance ─────────────────────
        try {
          await agentAccountDb.addBalance(agent.agentAccountId, dripAmount);
        } catch (addErr) {
          log.error('[agentFaucetWorker] addBalance failed after treasury debit — agent NOT credited, manual reconciliation required', {
            stage: 'addBalance',
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            dripAmount,
            error: addErr.message,
          });
          try {
            await faucetDripsDb.createDrip({
              treasuryId: treasury.treasuryId,
              agentAccountId: agent.agentAccountId,
              noemaAccountId: agent.noemaAccountId,
              amount: dripAmount,
              periodStart,
              periodEnd,
              scoringInputs: { sessionRecencyDays: agent.sessionRecencyDays, score: agent.score },
              creditLedgerEntryId: null,
              status: 'failed',
              failureReason: addErr.message,
            });
          } catch (dripErr) {
            log.error('[agentFaucetWorker] failed to record addBalance failure — drip audit trail incomplete', { error: dripErr.message });
          }
          errors++;
          continue;
        }

        // ── Stage 2: credit noema economy ledger ──────────────────────────
        let entryId;
        try {
          const result = await economyService.creditPoints(agent.noemaAccountId, {
            points: dripAmount,
            description: `Faucet drip from treasury ${treasury.treasuryId}`,
            rewardType: 'FAUCET_DRIP',
            relatedItems: { agentAccountId: agent.agentAccountId, treasuryId: treasury.treasuryId },
          });
          entryId = result.entryId;
        } catch (creditErr) {
          log.error('[agentFaucetWorker] creditPoints failed after addBalance — agent sub-account credited but noema ledger not updated, manual reconciliation required', {
            stage: 'creditPoints',
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            dripAmount,
            error: creditErr.message,
          });
          try {
            await faucetDripsDb.createDrip({
              treasuryId: treasury.treasuryId,
              agentAccountId: agent.agentAccountId,
              noemaAccountId: agent.noemaAccountId,
              amount: dripAmount,
              periodStart,
              periodEnd,
              scoringInputs: { sessionRecencyDays: agent.sessionRecencyDays, score: agent.score },
              creditLedgerEntryId: null,
              status: 'failed',
              failureReason: creditErr.message,
            });
          } catch (dripErr) {
            log.error('[agentFaucetWorker] failed to record creditPoints failure — drip audit trail incomplete', { error: dripErr.message });
          }
          errors++;
          continue;
        }

        // ── Both stages succeeded: record credited drip ───────────────────
        try {
          await faucetDripsDb.createDrip({
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            noemaAccountId: agent.noemaAccountId,
            amount: dripAmount,
            periodStart,
            periodEnd,
            scoringInputs: { sessionRecencyDays: agent.sessionRecencyDays, score: agent.score },
            creditLedgerEntryId: entryId.toString(),
            status: 'credited',
            failureReason: null,
          });
        } catch (dripErr) {
          log.warn('[agentFaucetWorker] failed to record credited drip — balances are correct but audit trail incomplete', {
            agentAccountId: agent.agentAccountId, error: dripErr.message,
          });
        }
        log.info(`[agentFaucetWorker] Dripped ${dripAmount} pts to agent ${agent.agentAccountId} from treasury ${treasury.treasuryId}`);
        agentsDripped++;
        totalPointsDripped += dripAmount;
      }

      // ── f. Update lastDripAt ───────────────────────────────────────────────
      // Catch separately from the outer try so a failure here is surfaced as a
      // CRITICAL financial inconsistency (drips issued but lastDripAt not saved →
      // all agents will be double-dripped on the next tick).
      try {
        await treasuryDb.updateLastDripAt(treasury.treasuryId, new Date());
      } catch (updateErr) {
        log.error(
          `[agentFaucetWorker] CRITICAL: updateLastDripAt failed for treasury ${treasury.treasuryId} — ` +
          'agents were dripped but lastDripAt was NOT updated; double-drip will occur on next tick; ' +
          'manual intervention required',
          { treasuryId: treasury.treasuryId, error: updateErr.message },
        );
        errors++;
        // Tag the error so the outer catch can identify it, skip the generic
        // log line, and avoid double-incrementing the errors counter.
        updateErr._lastDripAtFailure = true;
        throw updateErr;
      }
      treasuriesProcessed++;

      if (treasuryBalanceExhausted) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} balance exhausted mid-sweep`);
      }
    } catch (err) {
      if (!err._lastDripAtFailure) {
        // Generic treasury error — not already logged/counted above.
        log.error(`[agentFaucetWorker] Error processing treasury ${treasury.treasuryId}: ${err.message}`);
        errors++;
      }
      // treasuriesProcessed intentionally not incremented on any error path.
    }
  }

  log.info(
    `[agentFaucetWorker] sweep done — treasuriesProcessed=${treasuriesProcessed} agentsDripped=${agentsDripped} totalPointsDripped=${totalPointsDripped} errors=${errors}`,
  );
  return { treasuriesProcessed, agentsDripped, totalPointsDripped, errors };
}

/**
 * Start the daily faucet worker. Runs immediately on startup, then on the FAUCET_INTERVAL_MS cadence.
 * Per-treasury cadence (weekly/biweekly/monthly) is checked inside runFaucet.
 *
 * A module-level `isRunning` guard prevents overlapping sweeps: if runFaucet takes longer
 * than FAUCET_INTERVAL_MS the next tick is skipped with a warning rather than launching a
 * second concurrent sweep (which would hit the faucetDripsDb unique index and throw).
 *
 * @param {{
 *   treasuryDb: object,
 *   agentAccountDb: object,
 *   faucetDripsDb: object,
 *   economyService: object,
 *   logger: object,
 * }} deps
 * @returns {NodeJS.Timeout}
 */
let isRunning = false;

function startFaucet(deps) {
  const log = deps.logger || console;

  async function runGuarded(label) {
    if (isRunning) {
      log.warn(`[agentFaucetWorker] ${label}: faucet sweep already in progress, skipping tick`);
      return;
    }
    isRunning = true;
    try {
      await runFaucet(deps);
    } catch (err) {
      log.error(`[agentFaucetWorker] ${label} failed`, { error: err.message });
    } finally {
      isRunning = false;
    }
  }

  runGuarded('Initial run');
  const handle = setInterval(() => runGuarded('Scheduled run'), FAUCET_INTERVAL_MS);
  if (handle.unref) handle.unref();
  return handle;
}

module.exports = { runFaucet, startFaucet, FAUCET_INTERVAL_MS };
