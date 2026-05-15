/**
 * Collections Admin API
 *
 * Admin endpoints for collection configuration.
 * Protected at the network level (internal API) — no auth middleware needed.
 */

const express = require('express');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('collectionsAdminApi');

/**
 * Create collections admin API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.cookCollectionsDb
 */
function createCollectionsAdminApi({ cookCollectionsDb }) {
  const router = express.Router();

  /**
   * PATCH /internal/v1/admin/collections/:collectionId/rev-share
   *
   * Set the rev-share BPS for a collection.
   * Body: { bps: number }  — e.g. { bps: 500 } for 5%
   */
  router.patch('/:collectionId/rev-share', async (req, res) => {
    const { bps } = req.body || {};
    if (!Number.isInteger(bps)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'bps must be an integer' } });
    }
    try {
      await cookCollectionsDb.setRevShareBps(req.params.collectionId, bps);
      logger.info('[collectionsAdmin] revShareBps updated', { collectionId: req.params.collectionId, bps });
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[collectionsAdmin] setRevShareBps failed', { error: err.message, collectionId: req.params.collectionId });
      if (err.message.startsWith('Collection not found')) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: err.message } });
      }
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
  });

  return router;
}

module.exports = { createCollectionsAdminApi };
