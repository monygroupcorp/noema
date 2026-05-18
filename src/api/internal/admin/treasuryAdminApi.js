/**
 * Treasury Admin API
 *
 * Admin CRUD endpoints for CAMEL agent runtime treasury management.
 * Protected at the network level (internal API) — no auth middleware needed.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('treasuryAdminApi');

/**
 * Create treasury admin API router
 *
 * @param {Object} dependencies
 * @param {import('../../../core/services/db/treasuryDb')} dependencies.treasuryDb
 * @param {import('../../../core/services/db/agentAccountDb')} dependencies.agentAccountDb
 */
function createTreasuryAdminApi({ treasuryDb, agentAccountDb }) {
  const router = express.Router();

  /**
   * GET /internal/v1/admin/treasury
   *
   * List all treasuries
   */
  router.get('/', async (req, res) => {
    try {
      const treasuries = await treasuryDb.listAll();
      return res.json({ treasuries });
    } catch (err) {
      logger.error('[treasuryAdminApi] listAll failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list treasuries' });
    }
  });

  /**
   * GET /internal/v1/admin/treasury/:treasuryId
   *
   * Get treasury by ID
   */
  router.get('/:treasuryId', async (req, res) => {
    try {
      const treasury = await treasuryDb.findByTreasuryId(req.params.treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Treasury ${req.params.treasuryId} not found` });
      }
      const agentCount = agentAccountDb ? await agentAccountDb.countByTreasuryId(req.params.treasuryId) : 0;
      return res.json({ treasury, agentCount });
    } catch (err) {
      logger.error('[treasuryAdminApi] findByTreasuryId failed', { treasuryId: req.params.treasuryId, error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to get treasury' });
    }
  });

  /**
   * POST /internal/v1/admin/treasury
   *
   * Create a new treasury
   */
  router.post('/', async (req, res) => {
    try {
      const { issuerName, issuerDomain, faucetPolicy, treasuryId: requestedTreasuryId, partnerId } = req.body;
      if (!issuerName || !issuerDomain || !faucetPolicy) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'issuerName, issuerDomain, and faucetPolicy are required' });
      }
      let treasuryId;
      if (requestedTreasuryId !== undefined) {
        if (typeof requestedTreasuryId !== 'string' || requestedTreasuryId.trim() === '') {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'treasuryId must be a non-empty string' });
        }
        treasuryId = requestedTreasuryId;
      } else {
        treasuryId = `treasury_${issuerName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${uuidv4().slice(0, 6)}`;
      }
      await treasuryDb.createTreasury({ treasuryId, issuerName, issuerDomain, faucetPolicy, ...(partnerId ? { partnerId } : {}) });
      logger.info('[treasuryAdminApi] Treasury created', { treasuryId, issuerName });
      return res.status(201).json({ treasuryId });
    } catch (err) {
      logger.error('[treasuryAdminApi] createTreasury failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create treasury' });
    }
  });

  /**
   * POST /internal/v1/admin/treasury/:treasuryId/fund
   *
   * Add points to treasury balance
   */
  router.post('/:treasuryId/fund', async (req, res) => {
    const { treasuryId } = req.params;
    try {
      const { points } = req.body;
      if (points === undefined || points === null) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'points is required' });
      }
      if (!Number.isInteger(points) || points <= 0) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'points must be a positive integer' });
      }

      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Treasury ${treasuryId} not found` });
      }

      await treasuryDb.addBalance(treasuryId, points);

      const updated = await treasuryDb.findByTreasuryId(treasuryId);
      return res.json({ balance: updated.balance });
    } catch (err) {
      logger.error('[treasuryAdminApi] addBalance failed', { treasuryId, error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fund treasury' });
    }
  });

  /**
   * POST /internal/v1/admin/treasury/:treasuryId/debit
   *
   * Debit points from treasury balance (validates sufficient balance first)
   */
  router.post('/:treasuryId/debit', async (req, res) => {
    const { treasuryId } = req.params;
    try {
      const { points } = req.body;
      if (points === undefined || points === null) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'points is required' });
      }
      if (!Number.isInteger(points) || points <= 0) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'points must be a positive integer' });
      }

      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Treasury ${treasuryId} not found` });
      }

      const debited = await treasuryDb.debitBalance(treasuryId, points);
      if (!debited) {
        return res.status(400).json({ error: 'INSUFFICIENT_BALANCE', message: `Insufficient balance to debit ${points} points` });
      }

      const updated = await treasuryDb.findByTreasuryId(treasuryId);
      return res.json({ balance: updated.balance });
    } catch (err) {
      logger.error('[treasuryAdminApi] debitBalance failed', { treasuryId, error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to debit treasury' });
    }
  });

  /**
   * PATCH /internal/v1/admin/treasury/:treasuryId/policy
   *
   * Update faucet policy fields
   */
  router.patch('/:treasuryId/policy', async (req, res) => {
    const { treasuryId } = req.params;
    try {
      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Treasury ${treasuryId} not found` });
      }

      const allowed = ['starterGrant', 'monthlyMax', 'subsidyMode', 'refillCadence'];
      const fields = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) fields[key] = req.body[key];
      }
      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'At least one of starterGrant, monthlyMax, subsidyMode, refillCadence is required' });
      }

      if (fields.subsidyMode !== undefined && !['on', 'off', 'hybrid'].includes(fields.subsidyMode)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: "subsidyMode must be 'on', 'off', or 'hybrid'" });
      }
      if (fields.refillCadence !== undefined && !['weekly', 'biweekly', 'monthly'].includes(fields.refillCadence)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: "refillCadence must be 'weekly', 'biweekly', or 'monthly'" });
      }
      if (fields.starterGrant !== undefined && (!Number.isInteger(fields.starterGrant) || fields.starterGrant < 0)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'starterGrant must be a non-negative integer' });
      }
      if (fields.monthlyMax !== undefined && (!Number.isInteger(fields.monthlyMax) || fields.monthlyMax < 0)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'monthlyMax must be a non-negative integer' });
      }

      const updatedPolicy = { ...treasury.faucetPolicy, ...fields };
      await treasuryDb.updateFaucetPolicy(treasuryId, updatedPolicy);
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[treasuryAdminApi] updateFaucetPolicy failed', { treasuryId, error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update faucet policy' });
    }
  });

  /**
   * PATCH /internal/v1/admin/treasury/:treasuryId/status
   *
   * Set treasury status to 'active' or 'suspended'
   */
  router.patch('/:treasuryId/status', async (req, res) => {
    const { treasuryId } = req.params;
    try {
      const { status } = req.body;
      if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: "status must be 'active' or 'suspended'" });
      }

      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Treasury ${treasuryId} not found` });
      }

      await treasuryDb.setStatus(treasuryId, status);
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[treasuryAdminApi] setStatus failed', { treasuryId, error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update treasury status' });
    }
  });

  /**
   * PATCH /internal/v1/admin/treasury/:treasuryId/partner
   *
   * Link or update the partnerId for a treasury
   */
  router.patch('/:treasuryId/partner', async (req, res) => {
    const { treasuryId } = req.params;
    try {
      const { partnerId } = req.body;
      if (!partnerId || typeof partnerId !== 'string') {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'partnerId must be a non-empty string' });
      }

      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Treasury ${treasuryId} not found` });
      }

      await treasuryDb.updatePartnerId(treasuryId, partnerId);
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[treasuryAdminApi] updatePartnerId failed', { treasuryId, error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update partnerId' });
    }
  });

  return router;
}

module.exports = { createTreasuryAdminApi };
