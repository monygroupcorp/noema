/**
 * Partners Admin API
 *
 * Admin CRUD endpoints for partner management.
 * Protected at the network level (internal API) — no auth middleware needed.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('partnersAdminApi');

/**
 * Create partners admin API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.partnerDb
 * @param {Object} dependencies.splitLedgerDb
 * @param {Object} dependencies.uploadRecordDb
 */
function createPartnersAdminApi({ partnerDb, splitLedgerDb, uploadRecordDb }) {
  const router = express.Router();

  /**
   * GET /internal/v1/admin/partners
   *
   * List all partners
   */
  router.get('/', async (req, res) => {
    try {
      const partners = await partnerDb.listPartners();
      return res.json({ partners });
    } catch (error) {
      logger.error('[partnersAdmin] Failed to list partners', { error: error.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list partners' });
    }
  });

  /**
   * GET /internal/v1/admin/partners/:partnerId
   *
   * Get partner detail + ledger summary
   */
  router.get('/:partnerId', async (req, res) => {
    try {
      const partner = await partnerDb.findPartnerById(req.params.partnerId);
      if (!partner) return res.status(404).json({ error: 'NOT_FOUND' });
      const ledger = await splitLedgerDb.findByPartnerId(req.params.partnerId);
      const total = await splitLedgerDb.partnerTotal(req.params.partnerId);
      return res.json({ partner, ledger, totalCredited: total });
    } catch (error) {
      logger.error('[partnersAdmin] Failed to get partner', { error: error.message, partnerId: req.params.partnerId });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to get partner' });
    }
  });

  /**
   * POST /internal/v1/admin/partners
   *
   * Create a new partner
   */
  router.post('/', async (req, res) => {
    try {
      const { name, allowedDomains, splitBps, splitWallet } = req.body;
      if (!name || !allowedDomains?.length) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'name and allowedDomains required' });
      }
      const partnerId = `pk_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${uuidv4().slice(0, 6)}`;
      await partnerDb.createPartner({
        name,
        partnerId,
        allowedDomains,
        splitBps: splitBps ?? 500,
        splitWallet: splitWallet || null,
        settlementMode: 'credit',
      });
      logger.info('[partnersAdmin] Partner created', { partnerId, name });
      return res.status(201).json({ partnerId });
    } catch (error) {
      logger.error('[partnersAdmin] Failed to create partner', { error: error.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create partner' });
    }
  });

  /**
   * PATCH /internal/v1/admin/partners/:partnerId
   *
   * Update partner fields (splitBps, allowedDomains, status, splitWallet, settlementMode)
   */
  router.patch('/:partnerId', async (req, res) => {
    try {
      const allowed = ['splitBps', 'allowedDomains', 'status', 'splitWallet', 'settlementMode'];
      const fields = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) fields[key] = req.body[key];
      }
      await partnerDb.updatePartner(req.params.partnerId, fields);
      return res.json({ ok: true });
    } catch (error) {
      logger.error('[partnersAdmin] Failed to update partner', { error: error.message, partnerId: req.params.partnerId });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update partner' });
    }
  });

  /**
   * GET /internal/v1/admin/partners/:partnerId/uploads
   *
   * Upload history for a partner
   */
  router.get('/:partnerId/uploads', async (req, res) => {
    try {
      const uploads = await uploadRecordDb.findMany(
        { partnerId: req.params.partnerId },
        { sort: { createdAt: -1 }, limit: 100 }
      );
      const uploadCount = await uploadRecordDb.countRecentByPartner(req.params.partnerId);
      const runCount = await uploadRecordDb.countRecentRunsByPartner(req.params.partnerId);
      return res.json({ uploads, uploadCount1h: uploadCount, runCount1h: runCount });
    } catch (error) {
      logger.error('[partnersAdmin] Failed to get uploads', { error: error.message, partnerId: req.params.partnerId });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to get uploads' });
    }
  });

  return router;
}

module.exports = { createPartnersAdminApi };
