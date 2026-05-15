// src/core/services/charging/chargeGeneration.js
//
// Unified charge entry point for all generation execution paths.
// Implements the §4.2 split formula: compute base → host cut → contributor royalties → platform skim → spend.
//
// Call sites:
//   webhookProcessor.js       (ComfyDeploy post-hoc, actual costUsd from provider)
//   generationExecutionService (immediate adapter, pre-computed basePoints)
//   generationExecutionService (RunPod async-poll, pre-computed basePoints)

const { economyService: defaultEconomyService } = require('../store/economy/EconomyService');
const { distributeContributorRewards } = require('./contributorRewards');
const { USD_PER_POINT } = require('../../constants/economy');

const HOST_CUT_POINTS = 10;
const PLATFORM_ROYALTY_SKIM_RATE = 0.05;

/**
 * @typedef {object} ChargeResult
 * @property {number} totalPointsCharged - Total deducted from masterAccountId
 * @property {number} basePoints         - Compute-only points before any additions
 * @property {number} hostCutPoints      - Platform host cut (0 when sessionHostId absent)
 * @property {number} totalRewards       - Sum credited to contributors
 * @property {number} platformSkimPoints - Platform skim on royalty events (0 when no royalties)
 * @property {Array}  rewardBreakdown    - Per-contributor reward detail
 */

/**
 * Charges a generation against the user's credit ledger, distributes contributor
 * royalties, and updates XP. This is the single authoritative charge path.
 *
 * @param {object} params
 * @param {string|import('mongodb').ObjectId} params.masterAccountId
 * @param {object} params.generationRecord   - Full DB record (used for contributor reward lookup)
 * @param {number} [params.basePoints]       - Pre-computed points (post pricing-multiplier). Provide this OR costUsd.
 * @param {number} [params.costUsd]          - Raw compute USD. Converted to points when basePoints not given.
 * @param {string} [params.toolId]           - For spendContext metadata
 * @param {string} params.idempotencyKey     - Required. Canonical form: `${generationId}:final-debit`
 * @param {string|null} [params.sessionHostId] - When present, adds HOST_CUT_POINTS to the charge
 * @param {object} params.logger
 * @param {object} [params.economyService]   - Override singleton (tests / multi-tenant)
 * @returns {Promise<ChargeResult>}
 */
async function chargeGeneration({
  masterAccountId,
  generationRecord,
  basePoints: basePointsArg,
  costUsd,
  toolId,
  idempotencyKey,
  sessionHostId = null,
  logger,
  economyService: economyServiceArg,
}) {
  const svc = economyServiceArg || defaultEconomyService;

  // Resolve base points from costUsd when not pre-computed
  let basePoints = basePointsArg;
  if (basePoints == null && costUsd != null && costUsd > 0) {
    basePoints = Math.max(1, Math.round(costUsd / USD_PER_POINT));
  }

  if (!basePoints || basePoints <= 0) {
    logger.debug('[chargeGeneration] basePoints=0 — skipping charge');
    return { totalPointsCharged: 0, basePoints: 0, hostCutPoints: 0, totalRewards: 0, platformSkimPoints: 0, rewardBreakdown: [] };
  }

  const genId = generationRecord._id?.toString?.() ?? String(generationRecord._id);

  logger.debug(`[chargeGeneration] gen=${genId} basePoints=${basePoints} sessionHostId=${sessionHostId || 'none'}`);

  // 1. Optional session-host cut (flat points, not part of royalty base)
  const hostCutPoints = sessionHostId ? HOST_CUT_POINTS : 0;

  // 2. Contributor royalties — computed on compute base only, not on host cut
  const { totalPointsToCharge: afterRewards, totalRewards, rewardBreakdown } =
    await distributeContributorRewards(generationRecord, basePoints, { logger });

  // 3. Platform skim on royalty events — a share of what contributors receive
  const platformSkimPoints = totalRewards > 0 ? Math.floor(totalRewards * PLATFORM_ROYALTY_SKIM_RATE) : 0;

  const totalPointsCharged = afterRewards + hostCutPoints + platformSkimPoints;

  logger.debug(`[chargeGeneration] gen=${genId} breakdown: base=${basePoints} hostCut=${hostCutPoints} rewards=${totalRewards} skim=${platformSkimPoints} → total=${totalPointsCharged}`);

  // 4. Spend — single atomic debit with idempotency
  await svc.spend(masterAccountId, {
    pointsToSpend: totalPointsCharged,
    spendContext: { generationId: genId, toolId },
    idempotencyKey,
  });

  logger.info(`[chargeGeneration] Spent ${totalPointsCharged} pts for gen ${genId} (acct ${masterAccountId})`);

  // 5. XP update — best-effort, never blocks
  await svc.updateExp(masterAccountId, totalPointsCharged).catch(err =>
    logger.warn(`[chargeGeneration] EXP update failed for ${masterAccountId}: ${err.message}`)
  );

  return { totalPointsCharged, basePoints, hostCutPoints, totalRewards, platformSkimPoints, rewardBreakdown };
}

module.exports = { chargeGeneration };
