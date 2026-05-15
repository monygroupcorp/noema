/**
 * agentOwnerDragnet.js
 *
 * Daily sweep: find split_ledger agent_owner_unclaimed entries and credit
 * owners who have since linked a wallet/created a Noema account.
 */

const DRAGNET_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BATCH_SIZE = 100;

/**
 * Run one dragnet sweep. Returns { credited, skipped, errors }.
 *
 * @param {{ splitLedgerDb: object, userCoreDb: object, economyService: object, logger: object }} deps
 * @returns {Promise<{ credited: number, skipped: number, errors: number }>}
 */
async function runDragnet({ splitLedgerDb, userCoreDb, economyService, logger }) {
  let credited = 0;
  let skipped = 0;
  let errors = 0;

  const entries = await splitLedgerDb.findUnclaimed(BATCH_SIZE);

  for (const entry of entries) {
    try {
      const user = await userCoreDb.findUserCoreByWalletAddress(entry.ownerAddress);

      if (!user) {
        skipped++;
        continue;
      }

      const masterAccountId = user._id;

      await economyService.creditLedger.upsertRewardTally({
        masterAccountId: economyService._toOid(masterAccountId),
        depositorAddress: null,
        rewardCategory: 'agent_owner',
        points: entry.pointsAmount,
      });

      await economyService.userEconomy.incrementContributorRewards(
        masterAccountId,
        'agent_owner',
        entry.pointsAmount,
      );

      await splitLedgerDb.markAgentOwnerCredited(entry.runId);

      logger?.info(
        `[dragnet] Credited ${entry.pointsAmount} pts (agent_owner) to ${masterAccountId} for run ${entry.runId}`,
      );

      credited++;
    } catch (err) {
      logger?.error(`[dragnet] Error processing run ${entry.runId}: ${err.message}`);
      errors++;
    }
  }

  logger?.info(`[dragnet] sweep done — credited=${credited} skipped=${skipped} errors=${errors}`);
  return { credited, skipped, errors };
}

/**
 * Start the daily dragnet. Returns the interval handle (for teardown).
 *
 * @param {{ splitLedgerDb: object, userCoreDb: object, economyService: object, logger: object }} deps
 * @returns {NodeJS.Timeout}
 */
function startDragnet(deps) {
  // run immediately on start, then repeat daily
  runDragnet(deps).catch(err => deps.logger?.error('[dragnet] initial run failed:', err.message));
  return setInterval(() => {
    runDragnet(deps).catch(err => deps.logger?.error('[dragnet] run failed:', err.message));
  }, DRAGNET_INTERVAL_MS);
}

module.exports = { runDragnet, startDragnet, DRAGNET_INTERVAL_MS };
