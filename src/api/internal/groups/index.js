const express = require('express');
const { ObjectId } = require('../../../core/services/db/BaseDB');
const { economyService } = require('../../../core/services/store/economy/EconomyService');
const CreditLedgerDB = require('../../../core/services/db/alchemy/creditLedgerDb');

/**
 * Creates the Groups API router using the existing userCoreDb.
 * @param {Object} deps - Injected dependencies (logger, db)
 * @returns {express.Router}
 */
function createGroupsApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || console;

  if (!deps.db || !deps.db.userCore) {
    logger.error('[GroupsApi] userCoreDb dependency missing');
    throw new Error('userCoreDb dependency missing');
  }
  const userCoreDb = deps.db.userCore;
  const creditLedgerDb = deps.db.creditLedger || new CreditLedgerDB(logger);

  // Util: locate group doc by chatId
  async function findGroupDoc(chatId, platform = 'telegram_group') {
    return userCoreDb.findUserCoreByPlatformId(platform, chatId.toString());
  }

  /**
   * GET /groups/:chatId
   * Returns the group document if it exists.
   */
  router.get('/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const platform = req.query.platform || 'telegram_group';
    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      res.json(groupDoc);
    } catch (err) {
      logger.error(`[GroupsApi] GET /groups/${chatId} failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * POST /groups/sponsor
   * Create or update sponsorship for a chat.
   * Body: { chatId, chatTitle, sponsorMasterAccountId }
   */
  router.post('/sponsor', async (req, res) => {
    const { chatId, chatTitle, sponsorMasterAccountId, platform = 'telegram_group' } = req.body;
    if (!chatId || !sponsorMasterAccountId) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'chatId and sponsorMasterAccountId required' } });
    }
    try {
      let groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) {
        // create
        const { user: created } = await userCoreDb.findOrCreateByPlatformId(platform, chatId.toString(), {
          accountType: 'group',
          sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId),
          profile: { name: chatTitle || `Group ${chatId}` }
        });
        groupDoc = created;
      } else {
        // update
        groupDoc = await userCoreDb.updateUserCore(groupDoc._id, {
          $set: { sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId) }
        });
      }
      res.json(groupDoc);
    } catch (err) {
      logger.error(`[GroupsApi] POST /groups/sponsor failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * PATCH /groups/:chatId/sponsor
   * Body { sponsorMasterAccountId } nullable to clear.
   */
  router.patch('/:chatId/sponsor', async (req, res) => {
    const { chatId } = req.params;
    const { sponsorMasterAccountId } = req.body;
    const platform = req.query.platform || req.body.platform || 'telegram_group';
    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      const update = sponsorMasterAccountId ? { $set: { sponsorMasterAccountId: new ObjectId(sponsorMasterAccountId) } } : { $unset: { sponsorMasterAccountId: '' } };
      const updated = await userCoreDb.updateUserCore(groupDoc._id, update);
      res.json(updated);
    } catch (err) {
      logger.error(`[GroupsApi] PATCH /groups/${chatId}/sponsor failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * GET /groups/:chatId/balance
   * Returns the group pool balance (sum of points_remaining from credit ledger).
   */
  router.get('/:chatId/balance', async (req, res) => {
    const { chatId } = req.params;
    const platform = req.query.platform || 'telegram_group';
    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });

      const activeDeposits = await creditLedgerDb.findActiveDepositsForUser(groupDoc._id);
      const balance = activeDeposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);

      let exp = 0;
      if (deps.db.userEconomy) {
        const economyRecord = await deps.db.userEconomy.findByMasterAccountId(groupDoc._id);
        if (economyRecord && economyRecord.exp != null) {
          exp = Number(economyRecord.exp);
        }
      }

      res.json({ balance, exp });
    } catch (err) {
      logger.error(`[GroupsApi] GET /groups/${chatId}/balance failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * POST /groups/:chatId/fund
   * Transfer points from a user to a group's pool.
   * Body: { funderMasterAccountId, points, platform? }
   *
   * Consent check: funderMasterAccountId must match x-authenticated-account-id header,
   * unless the call carries x-internal-client-key (trusted internal service calls).
   */
  router.post('/:chatId/fund', async (req, res) => {
    const { chatId } = req.params;
    const { funderMasterAccountId, points, platform = 'telegram_group' } = req.body;

    if (!funderMasterAccountId || !points) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'funderMasterAccountId and points required' } });
    }
    if (!Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'points must be a positive integer' } });
    }

    // Consent check: caller must be the funder, unless this is a trusted internal service call
    const isInternalServiceCall = Boolean(req.headers['x-internal-client-key']);
    const authenticatedAccountId = req.headers['x-authenticated-account-id'];
    if (!isInternalServiceCall && authenticatedAccountId && authenticatedAccountId !== funderMasterAccountId) {
      return res.status(403).json({ error: { code: 'CONSENT_REQUIRED', message: 'funderMasterAccountId must match authenticated account' } });
    }

    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });
      if (!groupDoc.sponsorMasterAccountId) {
        return res.status(400).json({ error: { code: 'NOT_SPONSORED', message: 'Group must be sponsored before funding' } });
      }

      // Atomic transfer: spend from funder and credit group pool in one MongoDB transaction
      try {
        await economyService.transferPoints(funderMasterAccountId, groupDoc._id, points, {
          description: 'Group pool funding',
          rewardType: 'GROUP_POOL_FUND',
          relatedItems: { funderMasterAccountId, chatId },
          idempotencyKey: `group-fund:${chatId}:${funderMasterAccountId}:${points}:${Date.now()}`,
        });
      } catch (transferErr) {
        if (transferErr.code === 'INSUFFICIENT_FUNDS') {
          return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Not enough points to fund this amount.' } });
        }
        throw transferErr;
      }

      res.json({ success: true, pointsFunded: points });
    } catch (err) {
      logger.error(`[GroupsApi] POST /groups/${chatId}/fund failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  /**
   * PATCH /groups/:chatId/member-caps
   * Upsert a per-member monthly spend cap.
   * Body: { memberMasterAccountId, monthlyCapPoints, platform? }
   */
  router.patch('/:chatId/member-caps', async (req, res) => {
    const { chatId } = req.params;
    const { memberMasterAccountId, monthlyCapPoints, platform = 'telegram_group' } = req.body;

    if (!memberMasterAccountId || monthlyCapPoints == null) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'memberMasterAccountId and monthlyCapPoints required' } });
    }
    if (!Number.isInteger(monthlyCapPoints) || monthlyCapPoints < 0) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'monthlyCapPoints must be a non-negative integer' } });
    }

    try {
      const groupDoc = await findGroupDoc(chatId, platform);
      if (!groupDoc) return res.status(404).json({ error: { code: 'GROUP_NOT_FOUND' } });

      const updated = await userCoreDb.upsertMemberSpendCap(groupDoc._id, memberMasterAccountId, monthlyCapPoints);
      res.json(updated);
    } catch (err) {
      logger.error(`[GroupsApi] PATCH /groups/${chatId}/member-caps failed: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return router;
}

module.exports = createGroupsApi;
