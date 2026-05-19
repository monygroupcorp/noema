/**
 * Agent Session API
 *
 * Exposes the CAMEL ERC-8004 session manifest and revoke endpoints.
 *
 * Routes (registered with full paths, mount at / in external API):
 *   GET   /agents/:agentAccountId/manifest
 *   POST  /sessions/:agentAccountId/revoke
 *   PATCH /agents/:agentAccountId/payout-policy
 *   GET   /agents/:agentAccountId/earnings
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
 * @param {object} [deps.agentJwtVerifier]  - AgentJwtVerifier instance. Required for payout-policy auth (Finding #2).
 * @param {object} [deps.splitLedgerDb]
 * @param {object} [deps.logger]
 * @returns {express.Router}
 */
function createAgentSessionApi({ agentAccountDb, treasuryDb, agentJwtVerifier, splitLedgerDb, logger }) {
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

      // Surface status so CAMEL can detect revoked/suspended sessions
      if (agentAccount.status !== 'active') {
        return res.status(200).json({
          platform: 'noema.art',
          agentAccountId,
          status: agentAccount.status, // 'revoked' | 'suspended'
        });
      }

      const treasury = await treasuryDb.findByTreasuryId(agentAccount.treasuryId);
      if (!treasury) {
        log.error('[agentSessionApi] Treasury not found for agentAccount', { agentAccountId, treasuryId: agentAccount.treasuryId });
        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Treasury configuration missing' } });
      }

      const manifest = {
        platform: 'noema.art',
        status: 'active',
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
   * Requires a revokeToken as ?token=<revokeToken> query parameter for accounts
   * that have a revokeToken set (all accounts created after this fix). Legacy
   * accounts without a revokeToken stored are not gated (backward-compat).
   * Revokes the session and fires a callback to the issuer.
   */
  router.post('/sessions/:agentAccountId/revoke', async (req, res) => {
    const { agentAccountId } = req.params;

    try {
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent account not found' } });
      }

      // Finding #11 — revokeToken gate: enforced only when the account has a revokeToken (new accounts).
      // Legacy accounts without the field pass through for backward-compat.
      if (agentAccount.revokeToken) {
        const providedToken = req.query.token;
        if (!providedToken || providedToken !== agentAccount.revokeToken) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid or missing revoke token' } });
        }
      }

      // Idempotent: already revoked
      if (agentAccount.status === 'revoked') {
        // Finding #15 — use dedicated revokedAt field when available; fall back to updatedAt for legacy records.
        const revokedAtValue = agentAccount.revokedAt
          ? new Date(agentAccount.revokedAt).toISOString()
          : agentAccount.updatedAt
            ? new Date(agentAccount.updatedAt).toISOString()
            : new Date().toISOString();
        const idempotentResponse = {
          agentAccountId,
          status: 'revoked',
          revokedAt: revokedAtValue,
        };
        if (!agentAccount.revokedAt) {
          // Indicate that revokedAt is an estimate (updatedAt may have been bumped after revocation)
          idempotentResponse.revokedAt_estimated = true;
        }
        return res.status(200).json(idempotentResponse);
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

  /**
   * PATCH /agents/:agentAccountId/payout-policy
   *
   * Update the payout policy for an agent account.
   *
   * Auth (Finding #2): Requires a valid CAMEL agent JWT in the Authorization header
   * (Bearer <token>). The JWT is verified against the treasury's issuerDomain, and
   * the JWT's `agentId` claim must match the agentAccount's stored `agentId`.
   * Returns 401 if no JWT is present, 403 if the JWT is valid but the agentId
   * does not match the account being modified.
   *
   * When `agentJwtVerifier` is not injected (e.g. legacy test environments), auth
   * is skipped for backward-compat — wire `agentJwtVerifier` in the mount point
   * to activate enforcement.
   */
  router.patch('/agents/:agentAccountId/payout-policy', async (req, res) => {
    const { agentAccountId } = req.params;
    try {
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent account not found' } });
      }

      // Finding #2 — JWT ownership check (enforced when agentJwtVerifier is wired in).
      if (agentJwtVerifier) {
        const authHeader = req.get('Authorization') || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
          return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } });
        }

        // Look up treasury for issuerDomain
        let treasury;
        try {
          treasury = await treasuryDb.findByTreasuryId(agentAccount.treasuryId);
        } catch (err) {
          log.error('[agentSessionApi] Failed to fetch treasury for payout-policy auth', { agentAccountId, error: err.message });
          return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error during authentication' } });
        }
        if (!treasury) {
          log.error('[agentSessionApi] Treasury not found for payout-policy auth', { agentAccountId, treasuryId: agentAccount.treasuryId });
          return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Treasury configuration missing' } });
        }

        let jwtPayload;
        try {
          jwtPayload = await agentJwtVerifier.verifyAssertionJwt(token, treasury.issuerDomain);
        } catch (err) {
          if (err.name === 'JwksUnavailableError') {
            return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'JWKS service unavailable' } });
          }
          return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired agent JWT' } });
        }

        // Verify JWT's agentId matches the account being modified
        if (String(jwtPayload.agentId) !== String(agentAccount.agentId)) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Agent JWT does not match the requested account' } });
        }
      }

      const { mode, withdrawAddress } = req.body;
      if (!['self-fund', 'withdraw', 'split'].includes(mode)) {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: "mode must be 'self-fund', 'withdraw', or 'split'" } });
      }

      const ethAddressRegex = /^0x[0-9a-fA-F]{40}$/;
      if (mode === 'withdraw' || mode === 'split') {
        if (!withdrawAddress || !ethAddressRegex.test(withdrawAddress)) {
          return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'withdrawAddress is required and must be a valid Ethereum address for withdraw/split mode' } });
        }
      }

      const resolvedWithdrawAddress = (mode === 'withdraw' || mode === 'split') ? withdrawAddress : null;
      await agentAccountDb.setPayoutPolicy(agentAccountId, { mode, withdrawAddress: resolvedWithdrawAddress });

      return res.status(200).json({
        agentAccountId,
        payoutPolicy: { mode, withdrawAddress: resolvedWithdrawAddress },
      });
    } catch (err) {
      log.error('[agentSessionApi] Unexpected error in payout-policy handler', { agentAccountId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error updating payout policy' } });
    }
  });

  /**
   * GET /agents/:agentAccountId/earnings
   *
   * Per-agent earnings tracking is not yet implemented (SplitLedger is keyed by
   * partnerId, not agentAccountId). Returns 501 rather than misleading zeros.
   * TODO(v2): wire once agentAccountId is written onto split ledger entries.
   */
  router.get('/agents/:agentAccountId/earnings', (req, res) => {
    return res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'Per-agent earnings tracking not yet implemented' } });
  });

  return router;
}

module.exports = { createAgentSessionApi };
