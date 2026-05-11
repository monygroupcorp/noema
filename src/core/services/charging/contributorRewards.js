// src/core/services/charging/contributorRewards.js
//
// Extracted from webhookProcessor.js so that RunPod and direct-API charge paths
// can award spell and LoRA creator shares alongside ComfyDeploy webhook charges.

const { economyService } = require('../store/economy/EconomyService');
const LoRAModelsDB = require('../db/loRAModelDb');

const SPELL_REWARD_RATE = 0.05;
const PER_LORA_RATE = 0.05;
const LORA_POOL_CAP_RATE = 0.15;

/**
 * Calculates and distributes contributor rewards (spell author + LoRA owners).
 *
 * @param {object} generationRecord - Full generation record from DB.
 * @param {number} basePoints - Base cost in points before rewards are added.
 * @param {{ logger: object }} deps
 * @returns {Promise<{ totalPointsToCharge: number, totalRewards: number, rewardBreakdown: Array }>}
 */
async function distributeContributorRewards(generationRecord, basePoints, { logger }) {
  logger.debug(`[distributeContributorRewards] Calculating rewards for gen ${generationRecord._id} based on ${basePoints} base points.`);
  const generatingUserId = generationRecord.masterAccountId.toString();
  const rewardsToDistribute = [];
  const rewardBreakdown = [];

  const rawLrd = generationRecord.metadata?.loraResolutionData;
  logger.debug(`[distributeContributorRewards] generatingUserId=${generatingUserId}, loraResolutionData keys=${rawLrd ? Object.keys(rawLrd).join(',') : 'MISSING'}, appliedLoras count=${rawLrd?.appliedLoras?.length ?? 'N/A'}`);

  // 1. Spell author reward (fixed 5%)
  const isSpell = generationRecord.metadata?.isSpell;
  const spellOwnerId = generationRecord.metadata?.spell?.ownedBy?.toString();
  if (isSpell && spellOwnerId && spellOwnerId !== generatingUserId) {
    const spellRewardPoints = Math.floor(basePoints * SPELL_REWARD_RATE);
    if (spellRewardPoints > 0) {
      rewardsToDistribute.push({ contributorId: spellOwnerId, points: spellRewardPoints, type: 'spell' });
      logger.info(`[distributeContributorRewards] Spell author ${spellOwnerId} earns ${spellRewardPoints} pts.`);
    }
  }

  // 2. LoRA model trainer rewards (5% per model, capped at 15% total)
  const loras = generationRecord.metadata?.loraResolutionData?.appliedLoras || [];
  const externalLoras = [];
  loras.forEach(lora => {
    const ownerId = lora.ownerAccountId?.toString();
    logger.debug(`[distributeContributorRewards] LoRA '${lora.slug}': ownerAccountId=${ownerId || 'NULL'}, same=${ownerId === generatingUserId}`);
    if (ownerId && ownerId !== generatingUserId) {
      externalLoras.push({ slug: lora.slug, ownerId });
    }
  });

  const totalLoraShares = externalLoras.length;
  if (totalLoraShares > 0) {
    const uncappedLoraPool = Math.floor(basePoints * PER_LORA_RATE * totalLoraShares);
    const loraRewardPool = Math.min(uncappedLoraPool, Math.floor(basePoints * LORA_POOL_CAP_RATE));
    const pointsPerLoraShare = Math.floor(loraRewardPool / totalLoraShares);
    logger.info(`[distributeContributorRewards] LoRA pool: ${totalLoraShares} shares, capped=${loraRewardPool}, per-share=${pointsPerLoraShare}.`);

    if (pointsPerLoraShare > 0) {
      const ownerPoints = {};
      for (const { slug, ownerId } of externalLoras) {
        ownerPoints[ownerId] = (ownerPoints[ownerId] || 0) + pointsPerLoraShare;
      }
      for (const [ownerId, points] of Object.entries(ownerPoints)) {
        rewardsToDistribute.push({ contributorId: ownerId, points, type: 'lora' });
      }
    }
  }

  if (rewardsToDistribute.length === 0) {
    logger.debug('[distributeContributorRewards] No external contributors. No rewards to distribute.');
    return { totalPointsToCharge: basePoints, totalRewards: 0, rewardBreakdown: [] };
  }

  // 3. Issue rewards via tally pattern
  const loraModelsDb = new LoRAModelsDB(logger);
  let totalPointsDistributed = 0;

  for (const reward of rewardsToDistribute) {
    try {
      const walletAddress = await economyService.getUserWalletAddress(reward.contributorId);
      if (!walletAddress) {
        logger.warn(`[distributeContributorRewards] No wallet for contributor ${reward.contributorId}.`);
      }

      await economyService.creditLedger.upsertRewardTally({
        masterAccountId: economyService._toOid(reward.contributorId),
        depositorAddress: walletAddress,
        rewardCategory: reward.type,
        points: reward.points,
      });

      await economyService.userEconomy.incrementContributorRewards(
        reward.contributorId, reward.type, reward.points
      );

      totalPointsDistributed += reward.points;
      logger.info(`[distributeContributorRewards] Credited ${reward.points} pts (${reward.type}) to ${reward.contributorId}.`);
      rewardBreakdown.push({ contributorId: reward.contributorId, points: reward.points, type: reward.type, status: 'credited' });
    } catch (error) {
      logger.error(`[distributeContributorRewards] FAILED to credit ${reward.contributorId}: ${error.message}`);
      rewardBreakdown.push({ contributorId: reward.contributorId, points: reward.points, type: reward.type, status: 'failed', error: error.message });
    }
  }

  // 4. Update per-model reward stats (best-effort)
  if (totalLoraShares > 0) {
    const loraRewardPool = Math.min(
      Math.floor(basePoints * PER_LORA_RATE * totalLoraShares),
      Math.floor(basePoints * LORA_POOL_CAP_RATE)
    );
    const pointsPerLoraShare = Math.floor(loraRewardPool / totalLoraShares);
    if (pointsPerLoraShare > 0) {
      for (const { slug } of externalLoras) {
        try {
          await loraModelsDb.incrementRewardStats(slug, pointsPerLoraShare);
        } catch (err) {
          logger.warn(`[distributeContributorRewards] Failed to update rewardStats for '${slug}': ${err.message}`);
        }
      }
    }
  }

  const totalPointsToCharge = basePoints + totalPointsDistributed;
  logger.info(`[distributeContributorRewards] Complete. Base: ${basePoints}, Rewards: ${totalPointsDistributed}, Total: ${totalPointsToCharge}.`);
  return { totalPointsToCharge, totalRewards: totalPointsDistributed, rewardBreakdown };
}

module.exports = { distributeContributorRewards };
