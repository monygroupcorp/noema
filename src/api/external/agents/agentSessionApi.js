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
 * @param {object} [deps.splitLedgerDb]
 * @param {object} [deps.logger]
 * @returns {express.Router}
 */
function createAgentSessionApi({ agentAccountDb, treasuryDb, splitLedgerDb, logger }) {
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

  /**
   * PATCH /agents/:agentAccountId/payout-policy
   *
   * Update the payout policy for an agent account.
   */
  router.patch('/agents/:agentAccountId/payout-policy', async (req, res) => {
    const { agentAccountId } = req.params;
    try {
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent account not found' } });
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
   * Return total earnings and recent inflows for an agent account.
   */
  router.get('/agents/:agentAccountId/earnings', async (req, res) => {
    const { agentAccountId } = req.params;
    try {
      const agentAccount = await agentAccountDb.findByAgentAccountId(agentAccountId);
      if (!agentAccount) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent account not found' } });
      }

      if (!splitLedgerDb) {
        return res.status(200).json({
          agentAccountId,
          totalEarnings: { amount: '0.00', currency: 'USDC' },
          recentInflows: [],
        });
      }

      let recentInflows = [];
      let totalGross = 0;
      try {
        // SplitLedgerDB is keyed by partnerId; use findByPartnerId with the agentAccountId as a
        // best-effort approximation if a direct agentAccountId filter isn't available.
        let entries = [];
        if (typeof splitLedgerDb.findByPartnerId === 'function') {
          entries = await splitLedgerDb.findByPartnerId(agentAccountId, 20);
        }
        entries = entries || [];
        totalGross = entries.reduce((sum, e) => sum + parseInt(e.grossAmount || '0', 10), 0);
        recentInflows = entries.map(e => ({
          spellSlug: e.spellSlug || null,
          amount: (parseInt(e.grossAmount || '0', 10) / 1e6).toFixed(6).replace(/\.?0+$/, '') || '0',
          currency: 'USDC',
          timestamp: Math.floor(new Date(e.createdAt).getTime() / 1000),
        }));
      } catch (err) {
        log.warn('[agentSessionApi] Failed to fetch split ledger entries for earnings', { agentAccountId, error: err.message });
      }

      const totalUsd = (totalGross / 1e6).toFixed(2);
      return res.status(200).json({
        agentAccountId,
        totalEarnings: { amount: totalUsd, currency: 'USDC' },
        recentInflows,
      });
    } catch (err) {
      log.error('[agentSessionApi] Unexpected error in earnings handler', { agentAccountId, error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error fetching earnings' } });
    }
  });

  return router;
}

module.exports = { createAgentSessionApi };
