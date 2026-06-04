/**
 * Agent Provisioning API
 *
 * Handles CAMEL ERC-8004 agent onboarding via JWT assertion.
 * Provisions a Noema account, clones a workspace, creates an AgentAccount
 * record, debits the treasury, and credits the agent's economy account.
 *
 * Mount point: POST /:treasuryId/agents (full path /api/v1/treasury/:treasuryId/agents)
 */

const express = require('express');
const { pointsToUsd } = require('./agentUtils');
const { fireSessionCallback } = require('../../../core/services/agents/agentSessionCallback');

/**
 * Create Agent Provisioning API router.
 *
 * @param {object} deps
 * @param {object} deps.treasuryDb
 * @param {object} deps.agentAccountDb
 * @param {object} deps.workspacesDb
 * @param {object} deps.workspaceFactory   - WorkspaceFactory singleton; performs the NFT-aware clone (agent-context strip, $NFT_* substitution, private spell clones, R2 image mirror).
 * @param {object} deps.agentJwtVerifier
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
  workspaceFactory,
  agentJwtVerifier,
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
        jwtPayload = await agentJwtVerifier.verifyAssertionJwt(token, treasury.issuerDomain);
      } catch (err) {
        if (err.name === 'JwksUnavailableError') {
          return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'JWKS service unavailable' } });
        }
        return res.status(401).json({ error: { code: 'INVALID_ASSERTION', message: err.message } });
      }

      const { agentId, tokenId, owner_at_assertion, scope, exp } = jwtPayload;
      const ownerAddress = (owner_at_assertion || '').toLowerCase();

      // Finding #5 — Validate ownerAddress is a real Ethereum address before any account lookup
      if (!/^0x[0-9a-f]{40}$/.test(ownerAddress)) {
        return res.status(400).json({ error: { code: 'INVALID_ASSERTION', message: 'owner_at_assertion must be a valid Ethereum address' } });
      }

      // Extract chain metadata from sub claim: "agent:<chainId>:<adapterAddress>:<agentId>"
      // Store adapter but NOT collection — adapter-owned NFTs resolve via Mode B (adapter.ownerOf)
      // rather than Mode C (adapter → nftId → collection.ownerOf), which would return the adapter address.
      const subParts = (jwtPayload.sub || '').split(':');
      const agentChainId = subParts.length >= 4 ? Number(subParts[1]) || null : null;
      const agentAdapter = subParts.length >= 4 && /^0x[0-9a-f]{40}$/i.test(subParts[2]) ? subParts[2].toLowerCase() : null;

      // Step 4 — Idempotency / existing-account check
      const existing = await agentAccountDb.findByAgentId(agentId);
      if (existing) {
        if (existing.status === 'active') {
          return res.status(200).json({
            agentAccountId: existing.agentAccountId,
            manifestURI: `https://noema.art/api/v1/agents/${existing.agentAccountId}/manifest`,
            revokeURI: `https://noema.art/api/v1/sessions/${existing.agentAccountId}/revoke`,
            balance: { amount: pointsToUsd(existing.balance), currency: 'USDC' },
          });
        }
        if (existing.status === 'revoked') {
          return res.status(409).json({ error: { code: 'AGENT_REVOKED', message: 'This agent account has been permanently revoked' } });
        }
        // status === 'suspended': a prior provisioning attempt debited failed — retry the financial steps only
        if (existing.status === 'suspended') {
          const starterGrant = treasury.faucetPolicy?.starterGrant || 0;
          if (treasury.balance < starterGrant) {
            return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Treasury has insufficient balance for starter grant' } });
          }
          const debitSuccess = await treasuryDb.debitBalance(treasury.treasuryId, starterGrant);
          if (!debitSuccess) {
            return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Treasury balance exhausted during provisioning retry' } });
          }
          await agentAccountDb.setStatus(existing.agentAccountId, 'active');
          if (starterGrant > 0) {
            await agentAccountDb.addBalance(existing.agentAccountId, starterGrant);
            try {
              await economyService.creditPoints(existing.noemaAccountId, {
                points: starterGrant,
                description: 'CAMEL agent starter grant (retry)',
                rewardType: 'AGENT_GRANT',
                relatedItems: { agentAccountId: existing.agentAccountId, treasuryId: treasury.treasuryId, tokenId },
              });
            } catch (err) {
              log.error('[agentProvisioning] creditPoints failed on suspended retry (non-fatal)', { agentAccountId: existing.agentAccountId, error: err.message });
            }
          }
          fireSessionCallback({
            issuerDomain: treasury.issuerDomain,
            tokenId,
            payload: {
              platform: 'noema.art',
              platformAgentId: existing.agentAccountId,
              scope,
              issuedAt: Math.floor(Date.now() / 1000),
              expiresAt: Math.floor(new Date(exp * 1000).getTime() / 1000),
              manifestURI: `https://noema.art/api/v1/agents/${existing.agentAccountId}/manifest`,
              revokeURI: `https://noema.art/api/v1/sessions/${existing.agentAccountId}/revoke`,
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
          return res.status(202).json({
            agentAccountId: existing.agentAccountId,
            manifestURI: `https://noema.art/api/v1/agents/${existing.agentAccountId}/manifest`,
            revokeURI: `https://noema.art/api/v1/sessions/${existing.agentAccountId}/revoke`,
            balance: { amount: pointsToUsd(starterGrant), currency: 'USDC' },
          });
        }
      }

      // Step 5 — Read starterGrant amount (balance pre-check moved to step 10 for freshness)
      const starterGrant = treasury.faucetPolicy?.starterGrant || 0;

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

      // Step 8 — Clone starter workspace via WorkspaceFactory (agent-context strip, NFT image
      // binding, $NFT_* placeholder substitution, private spell clones, R2 image mirror).
      const agentDoc = {
        _id: noemaAccountId,
        agentId,
        agentTokenId: tokenId,
        contractAddress: agentAdapter,
        chainId: agentChainId,
        profile: cardProfile,
        scope: scope || [],
        starterWorkspaceSlug: treasury.starterWorkspaceSlug,
      };
      const tokenUri = jwtPayload.tokenURI || card?.tokenURI || null;
      let workspaceSlug;
      try {
        const ws = await workspaceFactory.provisionAgentWorkspace({ agentDoc, tokenUri });
        workspaceSlug = ws.slug;
      } catch (err) {
        log.error('[agentProvisioning] WorkspaceFactory.provisionAgentWorkspace failed', { error: err.message });
        const code = err.code === 'NOT_FOUND' ? 'TEMPLATE_NOT_FOUND' : 'WORKSPACE_CREATION_FAILED';
        return res.status(503).json({ error: { code, message: 'Failed to create agent workspace' } });
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
          sessionIssuedAt: new Date(),
          sessionExpiresAt: new Date(exp * 1000),
          agentChainId,
          agentAdapter,
        });
        agentAccountId = result.agentAccountId;
      } catch (err) {
        // Finding #4 — E11000 means a concurrent request won the race; treat as idempotent success
        if (err.code === 11000) {
          const racedAccount = await agentAccountDb.findByAgentId(agentId);
          if (racedAccount && racedAccount.status === 'active') {
            return res.status(200).json({
              agentAccountId: racedAccount.agentAccountId,
              manifestURI: `https://noema.art/api/v1/agents/${racedAccount.agentAccountId}/manifest`,
              revokeURI: `https://noema.art/api/v1/sessions/${racedAccount.agentAccountId}/revoke`,
              balance: { amount: pointsToUsd(racedAccount.balance), currency: 'USDC' },
            });
          }
        }
        log.error('[agentProvisioning] AgentAccount creation failed', { agentId, error: err.message });
        return res.status(500).json({ error: { code: 'RECORD_CREATION_FAILED', message: 'Failed to create agent account' } });
      }

      // Step 10 — Fresh balance pre-check + atomic treasury debit (Finding #12: narrow TOCTOU window)
      const freshTreasury = await treasuryDb.findByTreasuryId(treasury.treasuryId);
      if (!freshTreasury || freshTreasury.balance < starterGrant) {
        // Finding #7: clean up cloned workspace before suspending
        try {
          await workspacesDb.deleteWorkspace({ slug: workspaceSlug });
        } catch (cleanupErr) {
          log.error('[agentProvisioning] Workspace cleanup failed after pre-check balance shortfall', {
            workspaceSlug, error: cleanupErr.message
          });
        }
        try {
          await agentAccountDb.setStatus(agentAccountId, 'suspended');
        } catch (suspendErr) {
          log.error('[agentProvisioning] Failed to suspend agent account after balance pre-check failure', {
            agentAccountId, error: suspendErr.message
          });
        }
        return res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: 'Treasury has insufficient balance for starter grant' } });
      }
      const debitSuccess = await treasuryDb.debitBalance(treasury.treasuryId, starterGrant);
      if (!debitSuccess) {
        // Finding #7: clean up cloned workspace before suspending
        try {
          await workspacesDb.deleteWorkspace({ slug: workspaceSlug });
        } catch (cleanupErr) {
          log.error('[agentProvisioning] Workspace cleanup failed after debit failure', {
            workspaceSlug, error: cleanupErr.message
          });
        }
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
          manifestURI: `https://noema.art/api/v1/agents/${agentAccountId}/manifest`,
          revokeURI: `https://noema.art/api/v1/sessions/${agentAccountId}/revoke`,
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
        manifestURI: `https://noema.art/api/v1/agents/${agentAccountId}/manifest`,
        revokeURI: `https://noema.art/api/v1/sessions/${agentAccountId}/revoke`,
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
