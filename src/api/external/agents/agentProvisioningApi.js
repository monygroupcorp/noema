/**
 * Agent Provisioning API
 *
 * Handles CAMEL ERC-8004 agent onboarding via JWT assertion.
 * Provisions a Noema account, clones a workspace, creates an AgentAccount
 * record, debits the treasury, and credits the agent's economy account.
 *
 * Mount point: POST /:treasuryId/agents (mounted at /api/treasury)
 */

const express = require('express');
const { pointsToUsd } = require('./agentUtils');
const { fireSessionCallback } = require('../../../core/services/agents/agentSessionCallback');

const MASTER_WORKSPACE_SLUG = process.env.CAMEL_MASTER_WORKSPACE_SLUG || '745218a5';

/**
 * Create Agent Provisioning API router.
 *
 * @param {object} deps
 * @param {object} deps.treasuryDb
 * @param {object} deps.agentAccountDb
 * @param {object} deps.workspacesDb
 * @param {object} deps.camelJwtVerifier
 * @param {object} deps.economyService
 * @param {object} deps.internalApiClient
 * @param {object} [deps.agentCardFetcher]
 * @param {object} [deps.logger]
 * @returns {express.Router}
 */
function createAgentProvisioningApi({
  treasuryDb,
  agentAccountDb,
  workspacesDb,
  camelJwtVerifier,
  economyService,
  internalApiClient,
  agentCardFetcher: agentCardFetcherFn,
  logger,
}) {
  const fetchAgentCard = agentCardFetcherFn || require('../../../core/services/agents/agentCardFetcher').fetchAgentCard;
  const log = logger || console;
  const router = express.Router({ mergeParams: true });

  /**
   * POST /:treasuryId/agents
   *
   * Provision a CAMEL agent account against the given treasury.
   * Authorization: Bearer <CAMEL assertion JWT>
   */
  router.post('/:treasuryId/agents', async (req, res) => {
    // Step 1 — Extract Bearer token (need treasury first for issuerDomain, validated below)
    const authHeader = req.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } });
    }

    try {
      // Step 2 — Fetch treasury
      const { treasuryId } = req.params;
      const treasury = await treasuryDb.findByTreasuryId(treasuryId);
      if (!treasury) {
        return res.status(404).json({ error: { code: 'TREASURY_NOT_FOUND', message: 'Treasury not found' } });
      }
      if (treasury.status !== 'active') {
        return res.status(403).json({ error: { code: 'TREASURY_SUSPENDED', message: 'Treasury is suspended' } });
      }

      // Step 3 — Verify JWT
      let jwtPayload;
      try {
        jwtPayload = await camelJwtVerifier.verifyAssertionJwt(token, treasury.issuerDomain);
      } catch (err) {
        if (err.name === 'JwksUnavailableError') {
          return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'JWKS service unavailable' } });
        }
        return res.status(401).json({ error: { code: 'INVALID_ASSERTION', message: err.message } });
      }

      const { agentId, tokenId, owner_at_assertion, scope, spending_cap, exp } = jwtPayload;
      const ownerAddress = (owner_at_assertion || '').toLowerCase();

      // Step 4 — Idempotency check
      const existing = await agentAccountDb.findByAgentId(agentId);
      if (existing && existing.status === 'active') {
        return res.status(200).json({
          agentAccountId: existing.agentAccountId,
          manifestURI: `https://noema.art/api/agents/${existing.agentAccountId}/manifest`,
          revokeURI: `https://noema.art/api/sessions/${existing.agentAccountId}/revoke`,
          balance: { amount: pointsToUsd(existing.balance), currency: 'USDC' },
        });
      }

      // Step 5 — Check treasury balance
      const starterGrant = treasury.faucetPolicy?.starterGrant || 0;
      if (treasury.balance < starterGrant) {
        return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Treasury has insufficient balance for starter grant' } });
      }

      // Step 6 — Find or create Noema account
      let noemaAccountId;
      try {
        const { data } = await internalApiClient.post('/internal/v1/data/auth/find-or-create-by-wallet', { address: ownerAddress });
        noemaAccountId = String(data.user._id || data.user.id);
      } catch (err) {
        log.error('[agentProvisioning] find-or-create-by-wallet failed', { ownerAddress, error: err.message });
        return res.status(503).json({ error: { code: 'ACCOUNT_SERVICE_UNAVAILABLE', message: 'Failed to provision Noema account' } });
      }

      // Step 7 — Fetch agent card (best-effort)
      const card = await fetchAgentCard(treasury.issuerDomain, tokenId);
      const cardProfile = card?.profile || { name: 'CAMEL Agent', description: '', image: null };

      // Step 8 — Clone master workspace
      let masterSnapshot;
      try {
        const master = await workspacesDb.findOne({ slug: MASTER_WORKSPACE_SLUG });
        if (!master) throw new Error('Master workspace not found');
        masterSnapshot = JSON.parse(JSON.stringify(master.snapshot)); // deep clone
      } catch (err) {
        log.error('[agentProvisioning] Master workspace not found', { error: err.message });
        return res.status(503).json({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Agent workspace template unavailable' } });
      }

      // Inject NFT card values into snapshot
      if (masterSnapshot.toolWindows) {
        const descWindow = masterSnapshot.toolWindows.find(w => w.templateWindowId === 'w-3');
        if (descWindow && cardProfile.description) descWindow.value = cardProfile.description;
      }

      let workspaceSlug;
      try {
        const ws = await workspacesDb.createWorkspace({
          snapshot: masterSnapshot,
          name: `${cardProfile.name || 'CAMEL Agent'} #${tokenId}`,
          ownerId: noemaAccountId,
          origin: { slug: MASTER_WORKSPACE_SLUG },
          visibility: 'private',
        });
        workspaceSlug = ws.slug;
      } catch (err) {
        log.error('[agentProvisioning] Workspace clone failed', { error: err.message });
        return res.status(503).json({ error: { code: 'WORKSPACE_CREATION_FAILED', message: 'Failed to create agent workspace' } });
      }

      // Step 9 — Create AgentAccount record
      let agentAccountId;
      try {
        const result = await agentAccountDb.createAgentAccount({
          treasuryId: treasury.treasuryId,
          agentId,
          tokenId,
          ownerAddress,
          noemaAccountId,
          workspaceSlug,
          scope: scope || [],
          spendingCap: spending_cap || {},
          sessionIssuedAt: new Date(),
          sessionExpiresAt: new Date(exp * 1000),
        });
        agentAccountId = result.agentAccountId;
      } catch (err) {
        log.error('[agentProvisioning] AgentAccount creation failed', { agentId, error: err.message });
        return res.status(500).json({ error: { code: 'RECORD_CREATION_FAILED', message: 'Failed to create agent account' } });
      }

      // Step 10 — Debit treasury (atomic)
      const debitSuccess = await treasuryDb.debitBalance(treasury.treasuryId, starterGrant);
      if (!debitSuccess) {
        try {
          await agentAccountDb.setStatus(agentAccountId, 'suspended');
        } catch (suspendErr) {
          log.error('[agentProvisioning] Failed to suspend agent account after debit failure', {
            agentAccountId, error: suspendErr.message
          });
        }
        return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Treasury balance exhausted during provisioning' } });
      }

      // Step 11 — Update agent account balance
      if (starterGrant > 0) {
        await agentAccountDb.addBalance(agentAccountId, starterGrant);
      }

      // Step 12 — Credit Noema economy account (non-fatal)
      try {
        if (starterGrant > 0) {
          await economyService.creditPoints(noemaAccountId, {
            points: starterGrant,
            description: 'CAMEL agent starter grant',
            rewardType: 'AGENT_GRANT',
            relatedItems: { agentAccountId, treasuryId: treasury.treasuryId, tokenId },
          });
        }
      } catch (err) {
        log.error('[agentProvisioning] creditPoints failed (non-fatal)', { agentAccountId, error: err.message });
      }

      // Step 13 — Fire session callback async (non-blocking)
      fireSessionCallback({
        issuerDomain: treasury.issuerDomain,
        tokenId,
        payload: {
          platform: 'noema.art',
          platformAgentId: agentAccountId,
          scope,
          issuedAt: Math.floor(Date.now() / 1000),
          expiresAt: Math.floor(new Date(exp * 1000).getTime() / 1000),
          manifestURI: `https://noema.art/api/agents/${agentAccountId}/manifest`,
          revokeURI: `https://noema.art/api/sessions/${agentAccountId}/revoke`,
          billing: {
            model: 'treasury-funded',
            treasuryRef: treasury.treasuryId,
            agentBalance: pointsToUsd(starterGrant),
            monthlyCap: pointsToUsd(treasury.faucetPolicy?.monthlyMax || 0),
            currency: 'USDC',
          },
        },
        options: { logger: log },
      });

      // Step 14 — Return response
      return res.status(202).json({
        agentAccountId,
        manifestURI: `https://noema.art/api/agents/${agentAccountId}/manifest`,
        revokeURI: `https://noema.art/api/sessions/${agentAccountId}/revoke`,
        balance: { amount: pointsToUsd(starterGrant), currency: 'USDC' },
      });

    } catch (err) {
      log.error('[agentProvisioning] Unexpected error', { error: err.message });
      return res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error during agent provisioning' } });
    }
  });

  return router;
}

module.exports = { createAgentProvisioningApi };
