// src/core/services/charging/agentOwnerReward.js
//
// Distributes the agent/collection owner rev-share for x402 runs.
// Fallback chain: Noema account → split_ledger unclaimed → log only.

const DEFAULT_REV_SHARE_BPS = 500;

/**
 * @param {object} params
 * @param {object} params.agentDoc          - userCore doc for the agent (has agentOwnerAddress)
 * @param {object|null} params.collection   - cookCollections doc (has userId, config.revShareBps)
 * @param {number} params.grossPoints       - Full x402 gross in points
 * @param {string} params.runId             - Unique run identifier for ledger entries
 * @param {string} params.spellSlug
 * @param {object} params.economyService    - Singleton with creditLedger.upsertRewardTally
 * @param {object|null} params.splitLedgerDb
 * @param {object} params.logger
 * @returns {Promise<{ status: 'credited'|'unclaimed'|'skipped', pointsAmount: number }>}
 */
async function distributeAgentOwnerReward({
  agentDoc, collection, grossPoints, runId, spellSlug,
  economyService, splitLedgerDb, logger,
}) {
  const revShareBps = collection?.config?.revShareBps ?? DEFAULT_REV_SHARE_BPS;
  const pointsAmount = Math.floor(grossPoints * revShareBps / 10000);

  if (pointsAmount <= 0) {
    return { status: 'skipped', pointsAmount: 0 };
  }

  const ownerUserId = collection?.userId;

  // 1. Owner has a Noema account — credit points directly
  if (ownerUserId && economyService) {
    try {
      await economyService.creditLedger.upsertRewardTally({
        masterAccountId: economyService._toOid(ownerUserId),
        depositorAddress: null,
        rewardCategory: 'agent_owner',
        points: pointsAmount,
      });
      logger.info(`[agentOwnerReward] Credited ${pointsAmount} pts (agent_owner) to ${ownerUserId} for run ${runId}`);
      return { status: 'credited', pointsAmount };
    } catch (err) {
      logger.error(`[agentOwnerReward] Failed to credit ${ownerUserId}: ${err.message}`);
      return { status: 'skipped', pointsAmount };
    }
  }

  // 2. No Noema account but on-chain address known — store for dragnet
  const ownerAddress = agentDoc?.agentOwnerAddress;
  if (ownerAddress && splitLedgerDb) {
    try {
      await splitLedgerDb.createUnclaimedAgentOwnerEntry({
        runId,
        spellSlug,
        agentId: agentDoc.agentId || agentDoc._id?.toString(),
        ownerAddress,
        pointsAmount,
      });
      logger.info(`[agentOwnerReward] Stored ${pointsAmount} pts unclaimed for ${ownerAddress} (run ${runId})`);
      return { status: 'unclaimed', pointsAmount };
    } catch (err) {
      logger.error(`[agentOwnerReward] Failed to store unclaimed entry for ${ownerAddress}: ${err.message}`);
      return { status: 'skipped', pointsAmount };
    }
  }

  // 3. No account, no address — Noema keeps
  logger.debug(`[agentOwnerReward] No owner account or address for run ${runId} — skipping rev-share`);
  return { status: 'skipped', pointsAmount: 0 };
}

module.exports = { distributeAgentOwnerReward };
