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
        const sessionRecencyDays = Math.min(
          30,
          (periodEnd.getTime() - new Date(agent.sessionIssuedAt).getTime()) / 86400000,
        );
        // Newer agents score higher: 1 at day 0, 0 at day 30
        const score = Math.max(0, (30 - sessionRecencyDays) / 30);
        // TODO(scoring-v2): query generationOutputsDb for spellsInvoked30d
        const spellsInvoked30d = 0;
        return { ...agent, sessionRecencyDays, score, spellsInvoked30d };
      });

      const totalScore = scored.reduce((sum, a) => sum + a.score, 0);
      if (totalScore === 0) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} — all agent scores are 0, skipping`);
        continue;
      }

      // ── d. Compute drip amounts with monthly cap ───────────────────────────
      const firstOfMonth = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);
      const monthlyMax = treasury.faucetPolicy?.monthlyMax || 0;

      const agentsWithAlloc = [];
      for (const agent of scored) {
        const dripsThisMonth = await faucetDripsDb.findByAgentAndPeriod(agent.agentAccountId, firstOfMonth);
        const pointsReceivedThisMonth = dripsThisMonth.reduce((sum, d) => sum + d.amount, 0);
        const cap = Math.max(0, monthlyMax - pointsReceivedThisMonth);

        const rawAlloc = Math.floor((agent.score / totalScore) * treasury.balance);
        const dripAmount = Math.min(rawAlloc, cap);

        agentsWithAlloc.push({ agent, dripAmount, cap });
      }

      // ── e. Drip each agent (sequential, fail-safe) ────────────────────────
      let treasuryBalanceExhausted = false;

      for (const { agent, dripAmount } of agentsWithAlloc) {
        if (dripAmount <= 0) continue;

        // Atomic debit — may fail mid-sweep if treasury runs dry
        const debited = await treasuryDb.debitBalance(treasury.treasuryId, dripAmount);
        if (!debited) {
          log.warn('[agentFaucetWorker] Treasury insufficient balance mid-sweep', {
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            dripAmount,
          });
          await faucetDripsDb.createDrip({
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            noemaAccountId: agent.noemaAccountId,
            amount: dripAmount,
            periodStart,
            periodEnd,
            scoringInputs: {
              spellsInvoked30d: agent.spellsInvoked30d,
              sessionRecencyDays: agent.sessionRecencyDays,
              score: agent.score,
            },
            creditLedgerEntryId: null,
            status: 'skipped',
            failureReason: 'INSUFFICIENT_BALANCE',
          });
          treasuryBalanceExhausted = true;
          break;
        }

        try {
          await agentAccountDb.addBalance(agent.agentAccountId, dripAmount);
          const { entryId } = await economyService.creditPoints(agent.noemaAccountId, {
            points: dripAmount,
            description: `Faucet drip from treasury ${treasury.treasuryId}`,
            rewardType: 'FAUCET_DRIP',
            relatedItems: {
              agentAccountId: agent.agentAccountId,
              treasuryId: treasury.treasuryId,
            },
          });
          await faucetDripsDb.createDrip({
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            noemaAccountId: agent.noemaAccountId,
            amount: dripAmount,
            periodStart,
            periodEnd,
            scoringInputs: {
              spellsInvoked30d: agent.spellsInvoked30d,
              sessionRecencyDays: agent.sessionRecencyDays,
              score: agent.score,
            },
            creditLedgerEntryId: entryId.toString(),
            status: 'credited',
            failureReason: null,
          });
          log.info(`[agentFaucetWorker] Dripped ${dripAmount} pts to agent ${agent.agentAccountId} from treasury ${treasury.treasuryId}`);
          agentsDripped++;
          totalPointsDripped += dripAmount;
        } catch (err) {
          log.error('[agentFaucetWorker] creditPoints failed after debit — manual reconciliation required', {
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            dripAmount,
            error: err.message,
          });
          await faucetDripsDb.createDrip({
            treasuryId: treasury.treasuryId,
            agentAccountId: agent.agentAccountId,
            noemaAccountId: agent.noemaAccountId,
            amount: dripAmount,
            periodStart,
            periodEnd,
            scoringInputs: {
              spellsInvoked30d: agent.spellsInvoked30d,
              sessionRecencyDays: agent.sessionRecencyDays,
              score: agent.score,
            },
            creditLedgerEntryId: null,
            status: 'failed',
            failureReason: err.message,
          });
          errors++;
        }
      }

      // ── f. Update lastDripAt ───────────────────────────────────────────────
      await treasuryDb.updateLastDripAt(treasury.treasuryId, new Date());
      treasuriesProcessed++;

      if (treasuryBalanceExhausted) {
        log.warn(`[agentFaucetWorker] Treasury ${treasury.treasuryId} balance exhausted mid-sweep`);
      }
    } catch (err) {
      log.error(`[agentFaucetWorker] Error processing treasury ${treasury.treasuryId}: ${err.message}`);
      errors++;
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
 * @param {{
 *   treasuryDb: object,
 *   agentAccountDb: object,
 *   faucetDripsDb: object,
 *   economyService: object,
 *   logger: object,
 * }} deps
 * @returns {NodeJS.Timeout}
 */
function startFaucet(deps) {
  const log = deps.logger || console;
  runFaucet(deps).catch(err => log.error('[agentFaucetWorker] Initial run failed', { error: err.message }));
  const handle = setInterval(() => {
    runFaucet(deps).catch(err => log.error('[agentFaucetWorker] Scheduled run failed', { error: err.message }));
  }, FAUCET_INTERVAL_MS);
  if (handle.unref) handle.unref();
  return handle;
}

module.exports = { runFaucet, startFaucet, FAUCET_INTERVAL_MS };
