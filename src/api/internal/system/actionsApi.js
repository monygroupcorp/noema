const express = require('express');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('ActionsApi');

/**
 * Creates a router for complex, multi-step internal actions.
 * @param {object} dependencies - Service dependencies.
 * @returns {express.Router}
 */
function createActionsApi(dependencies) {
  const router = express.Router();
  const { db } = dependencies;

  if (!db) {
    logger.error('[ActionsApi] Missing critical dependency: db.');
    router.use((req, res) => res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'A critical service is not available.' }}));
    return router;
  }

  // Legacy /create-referral-vault removed — referral registration is now fully on-chain via CreditVault.register()

  return router;
}

module.exports = { createActionsApi };
