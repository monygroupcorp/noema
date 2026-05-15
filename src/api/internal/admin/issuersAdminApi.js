const express = require('express');
const { bustJwksCache } = require('../treasury/middleware/assertionJwt');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('issuersAdminApi');

/**
 * @param {{ issuerDb: import('../../../core/services/db/issuerDb') }} deps
 */
function createIssuersAdminApi({ issuerDb }) {
  const router = express.Router();

  // GET /admin/issuers
  router.get('/', async (req, res) => {
    try {
      const issuers = await issuerDb.listIssuers();
      return res.json({ issuers });
    } catch (err) {
      logger.error('[issuersAdmin] list failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // GET /admin/issuers/:issuerId
  router.get('/:issuerId', async (req, res) => {
    try {
      const issuer = await issuerDb.findByIssuerIdAny(req.params.issuerId);
      if (!issuer) return res.status(404).json({ error: 'NOT_FOUND' });
      return res.json({ issuer });
    } catch (err) {
      logger.error('[issuersAdmin] get failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // POST /admin/issuers
  router.post('/', async (req, res) => {
    try {
      const { issuerId, name, jwksUrl } = req.body;
      if (!issuerId || !name || !jwksUrl) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'issuerId, name, and jwksUrl are required' });
      }
      await issuerDb.createIssuer({ issuerId, name, jwksUrl });
      logger.info('[issuersAdmin] Issuer created', { issuerId, name });
      return res.status(201).json({ issuerId });
    } catch (err) {
      logger.error('[issuersAdmin] create failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // PATCH /admin/issuers/:issuerId
  router.patch('/:issuerId', async (req, res) => {
    try {
      const allowed = ['name', 'jwksUrl', 'status'];
      const fields = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) fields[key] = req.body[key];
      }
      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'No updatable fields provided' });
      }
      await issuerDb.updateIssuer(req.params.issuerId, fields);
      if (fields.jwksUrl) bustJwksCache(req.params.issuerId);
      logger.info('[issuersAdmin] Issuer updated', { issuerId: req.params.issuerId, fields: Object.keys(fields) });
      return res.json({ ok: true });
    } catch (err) {
      logger.error('[issuersAdmin] update failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // POST /admin/issuers/:issuerId/jwks/refresh  — force-bust JWKS cache
  router.post('/:issuerId/jwks/refresh', async (req, res) => {
    try {
      const issuer = await issuerDb.findByIssuerIdAny(req.params.issuerId);
      if (!issuer) return res.status(404).json({ error: 'NOT_FOUND' });
      bustJwksCache(req.params.issuerId);
      logger.info('[issuersAdmin] JWKS cache busted', { issuerId: req.params.issuerId });
      return res.json({ ok: true, message: 'JWKS cache cleared — next request will re-fetch' });
    } catch (err) {
      logger.error('[issuersAdmin] jwks refresh failed', { error: err.message });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  return router;
}

module.exports = { createIssuersAdminApi };
