/**
 * Agent Session API
 *
 * Exposes the CAMEL ERC-8004 session manifest and revoke endpoints.
 *
 * Routes (registered with full paths, mount at / in external API):
 *   GET  /agents/:agentAccountId/manifest
 *   POST /sessions/:agentAccountId/revoke
 */

const express = require('express');
const { pointsToUsd } = require('./agentUtils');
const { fireSessionCallback } = require('../../../core/services/agents/agentSessionCallback');

/**
 * Create Agent Session API router.
 *
 * @param {object} deps
 * @param {object} deps.agentAccountDb
 * @param {object} deps.treasuryDb
 * @param {object} [deps.logger]
 * @returns {express.Router}
 */
function createAgentSessionApi({ agentAccountDb, treasuryDb, logger }) {
  const log = logger || console;
  const router = express.Router();

  /**
   * GET /agents/:agentAccountId/manifest
   *
   * Public — returns the session manifest for a given agent account.
   */
  router.get('/agents/:agentAccountId/manifest', async (req, res) => {
    const { agentAccountId } = req.params;

    try {
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent account not found' } });
      }

      const treasury = await treasuryDb.findByTreasuryId(agentAccount.treasuryId);
      if (!treasury) {
        log.error('[agentSessionApi] Treasury not found for agentAccount', { agentAccountId, treasuryId: agentAccount.treasuryId });
        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Treasury configuration missing' } });
      }

      const manifest = {
        platform: 'noema.art',
        scope: agentAccount.scope || [],
        issuedAt: Math.floor(new Date(agentAccount.sessionIssuedAt).getTime() / 1000),
        expiresAt: Math.floor(new Date(agentAccount.sessionExpiresAt).getTime() / 1000),
        workspaceURL: `https://noema.art/s/${agentAccount.workspaceSlug}`,
        billing: {
          model: 'treasury-funded',
          treasuryRef: agentAccount.treasuryId,
          agentBalance: pointsToUsd(agentAccount.balance),
          monthlyCap: pointsToUsd(treasury.faucetPolicy?.monthlyMax || 0),
          currency: 'USDC',
        },
      };

      return res.status(200).json(manifest);

    } catch (err) {
      log.error('[agentSessionApi] Unexpected error in manifest handler', { agentAccountId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error fetching manifest' } });
    }
  });

  /**
   * POST /sessions/:agentAccountId/revoke
   *
   * Public (agentAccountId is the implicit credential for v1).
   * Revokes the session and fires a callback to the issuer.
   */
  router.post('/sessions/:agentAccountId/revoke', async (req, res) => {
    const { agentAccountId } = req.params;

    try {
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent account not found' } });
      }

      // Idempotent: already revoked
      if (agentAccount.status === 'revoked') {
        return res.status(200).json({
          agentAccountId,
          status: 'revoked',
          revokedAt: agentAccount.updatedAt
            ? new Date(agentAccount.updatedAt).toISOString()
            : new Date().toISOString(),
        });
      }

      await agentAccountDb.revoke(agentAccountId);

      const revokedAt = new Date().toISOString();

      // Fetch treasury for callback (best-effort)
      let treasury = null;
      try {
        treasury = await treasuryDb.findByTreasuryId(agentAccount.treasuryId);
      } catch (err) {
        log.warn('[agentSessionApi] Failed to fetch treasury for callback', { agentAccountId, error: err.message });
      }

      // Fire session callback async (non-blocking)
      if (treasury) {
        fireSessionCallback({
          issuerDomain: treasury.issuerDomain,
          tokenId: agentAccount.tokenId,
          payload: {
            platform: 'noema.art',
            platformAgentId: agentAccountId,
            scope: agentAccount.scope,
            revokedAt: Math.floor(Date.now() / 1000),
            manifestURI: `https://noema.art/api/agents/${agentAccountId}/manifest`,
            revokeURI: `https://noema.art/api/sessions/${agentAccountId}/revoke`,
            status: 'revoked',
          },
          options: { logger: log },
        });
      }

      return res.status(200).json({
        agentAccountId,
        status: 'revoked',
        revokedAt,
      });

    } catch (err) {
      log.error('[agentSessionApi] Unexpected error in revoke handler', { agentAccountId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error revoking session' } });
    }
  });

  return router;
}

module.exports = { createAgentSessionApi };
