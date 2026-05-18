/**
 * Internal Admin API
 *
 * Aggregates admin-only API routers for the internal API.
 */

const express = require('express');
const createRevenueAdminApi = require('./revenueApi');
const { createPartnersAdminApi } = require('./partnersAdminApi');
const { createCollectionsAdminApi } = require('./collectionsAdminApi');
const { createIssuersAdminApi } = require('./issuersAdminApi');
const { createTreasuryAdminApi } = require('./treasuryAdminApi');

/**
 * Create the admin API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.creditLedgerDb
 * @param {Object} dependencies.x402PaymentLogDb
 * @returns {express.Router}
 */
function createAdminApi(dependencies) {
  const router = express.Router();

  // Mount revenue API at /revenue
  // x402PaymentLogDb comes from dependencies.db.x402PaymentLog (initialized in db/index.js)
  const revenueRouter = createRevenueAdminApi({
    creditLedgerDb: dependencies.db?.creditLedger,
    x402PaymentLogDb: dependencies.db?.x402PaymentLog
  });

  router.use('/revenue', revenueRouter);

  const partnersRouter = createPartnersAdminApi({
    partnerDb: dependencies.db?.partner,
    splitLedgerDb: dependencies.db?.splitLedger,
    uploadRecordDb: dependencies.db?.uploadRecords,
  });
  router.use('/partners', partnersRouter);

  const collectionsRouter = createCollectionsAdminApi({
    cookCollectionsDb: dependencies.db?.cookCollections,
  });
  router.use('/collections', collectionsRouter);

  const issuersRouter = createIssuersAdminApi({
    issuerDb: dependencies.db?.issuer,
  });
  router.use('/issuers', issuersRouter);

  const treasuryRouter = createTreasuryAdminApi({
    treasuryDb: dependencies.db?.treasury,
    agentAccountDb: dependencies.db?.agentAccount,
  });
  router.use('/treasury', treasuryRouter);

  return router;
}

module.exports = { createAdminApi };
