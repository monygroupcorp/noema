// src/api/internal/treasury/treasuryApi.js
//
// 12-endpoint treasury + agent sub-account surface from §10.2 of agent-auth-client-spec.md.
// Auth tiers:
//   multisig = assertionJwt({ tier: 'multisig' })   — treasury-admin role claim
//   agentAssertion = assertionJwt({ tier: 'agent' }) — agent sub identity claim
//   public = no auth guard

const express = require('express');
const { assertionJwt } = require('./middleware/assertionJwt');
const { agentOwnerSession } = require('./middleware/agentOwnerSession');
const { AgentAccountService } = require('../../../core/services/agents/AgentAccountService');
const { DelegationService } = require('../../../core/services/agents/DelegationService');
const { WorkspaceFactory } = require('../../../core/services/agents/WorkspaceFactory');
const { IpfsService } = require('../../../core/services/ipfs/IpfsService');
const { OnChainVerifier } = require('../../../core/services/agents/OnChainVerifier');
const { ChallengeService } = require('../../../core/services/agents/ChallengeService');
const { VerifyService } = require('../../../core/services/agents/VerifyService');

const multisig = assertionJwt({ tier: 'multisig' });
const agentAssertion = assertionJwt({ tier: 'agent' });

/**
 * @param {{ db, economyService, toolRegistry?, logger }} deps
 * @returns {express.Router}
 */
function createTreasuryApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || console;

  const workspaceFactory = (deps.db?.workspaces && deps.db?.spells)
    ? new WorkspaceFactory({ workspacesDb: deps.db.workspaces, spellsDb: deps.db.spells, userCoreDb: deps.db.userCore, storageService: deps.storageService, ipfsService: deps.ipfsService || new IpfsService(logger), logger })
    : null;

  const svc = new AgentAccountService({
    userCoreDb: deps.db?.userCore,
    economyService: deps.economyService,
    creditLedgerDb: deps.db?.creditLedger,
    toolRegistry: deps.toolRegistry,
    workspaceFactory,
    logger,
  });

  // Shared error handler
  function handleErr(res, err, label) {
    logger.error(`[TreasuryApi] ${label}: ${err.message}`);
    const statusMap = { NOT_FOUND: 404, INVALID_PARAMS: 400, AGENT_EXISTS: 409, WRONG_TREASURY: 403, WRONG_ACCOUNT_TYPE: 409 };
    const status = statusMap[err.code] || 500;
    res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: err.message } });
  }

  // ---------------------------------------------------------------------------
  // Treasury endpoints
  // ---------------------------------------------------------------------------

  /**
   * POST /treasury
   * Create a new treasury account.
   * Body: { name, faucetPolicy? }
   */
  router.post('/', multisig, async (req, res) => {
    try {
      const { name, faucetPolicy } = req.body;
      const doc = await svc.createTreasury({ name, issuerSub: req.assertion.sub, faucetPolicy });
      res.status(201).json(doc);
    } catch (err) { handleErr(res, err, 'POST /treasury'); }
  });

  /**
   * GET /treasury/:id
   * Returns treasury balance + policy. Issuer multisig only.
   */
  router.get('/:id', multisig, async (req, res) => {
    try {
      const { doc, balance } = await svc.getTreasury(req.params.id);
      res.json({ ...doc, balance });
    } catch (err) { handleErr(res, err, 'GET /treasury/:id'); }
  });

  /**
   * POST /treasury/:id/fund
   * Credit points into a treasury.
   * Body: { points, description?, idempotencyKey? }
   */
  router.post('/:id/fund', multisig, async (req, res) => {
    try {
      const { points, description, idempotencyKey } = req.body;
      const result = await svc.fundTreasury(req.params.id, { points, description, idempotencyKey });
      res.json(result);
    } catch (err) { handleErr(res, err, 'POST /treasury/:id/fund'); }
  });

  /**
   * PATCH /treasury/:id/policy
   * Update faucet drip policy.
   * Body: { starterGrantPoints, monthlyMaxPoints, subsidyMode, refillCadence }
   */
  router.patch('/:id/policy', multisig, async (req, res) => {
    try {
      const { starterGrantPoints, monthlyMaxPoints, subsidyMode, refillCadence } = req.body;
      const db = deps.db?.userCore;
      if (!db) throw Object.assign(new Error('userCoreDb unavailable'), { code: 'INTERNAL_ERROR' });
      const updated = await db.updateTreasuryFaucetPolicy(req.params.id, { starterGrantPoints, monthlyMaxPoints, subsidyMode, refillCadence });
      res.json(updated);
    } catch (err) { handleErr(res, err, 'PATCH /treasury/:id/policy'); }
  });

  // ---------------------------------------------------------------------------
  // Agent sub-account endpoints
  // ---------------------------------------------------------------------------

  /**
   * POST /treasury/:id/agents
   * Register an agent sub-account. Requires agent assertion JWT.
   * Body: { agentId, chainId, adapter, registry, tokenId, ownerAddress, collection, scope?, spendingCap? }
   */
  router.post('/:id/agents', agentAssertion, async (req, res) => {
    try {
      const { agentId, chainId, adapter, registry, tokenId, tokenUri, ownerAddress, collection, scope, spendingCap } = req.body;
      const result = await svc.createAgentSubAccount(req.params.id, { agentId, chainId, adapter, registry, tokenId, tokenUri, ownerAddress, collection, scope, spendingCap });
      res.status(201).json(result);
    } catch (err) { handleErr(res, err, 'POST /treasury/:id/agents'); }
  });

  /**
   * GET /treasury/:id/agents/:agentId
   * Public — agent balance + last 10 SPEND_DEBIT entries.
   */
  router.get('/:id/agents/:agentId', async (req, res) => {
    try {
      const data = await svc.getAgentBalance(req.params.agentId);
      // Public endpoint — strip treasury-sensitive fields
      const { agentDoc, balance, recentDebits } = data;
      const publicDoc = {
        _id: agentDoc._id,
        agentId: agentDoc.agentId,
        agentChainId: agentDoc.agentChainId,
        scope: agentDoc.scope,
        profile: agentDoc.profile,
        balance,
        recentDebits,
      };
      res.json(publicDoc);
    } catch (err) { handleErr(res, err, 'GET /treasury/:id/agents/:agentId'); }
  });

  /**
   * POST /treasury/:id/agents/:agentId/topup
   * Transfer points from treasury to agent.
   * Body: { points, idempotencyKey? }
   */
  router.post('/:id/agents/:agentId/topup', multisig, async (req, res) => {
    try {
      const { points, idempotencyKey } = req.body;
      const result = await svc.topUpAgent(req.params.id, req.params.agentId, { points, idempotencyKey });
      res.json(result);
    } catch (err) { handleErr(res, err, 'POST /treasury/:id/agents/:agentId/topup'); }
  });

  /**
   * POST /treasury/:id/agents/:agentId/donate
   * Public — anyone can donate points to an agent.
   * Body: { points, donorNote? }
   */
  router.post('/:id/agents/:agentId/donate', async (req, res) => {
    try {
      const { points, donorNote } = req.body;
      const result = await svc.donateToAgent(req.params.agentId, { points, donorNote });
      res.json(result);
    } catch (err) { handleErr(res, err, 'POST /treasury/:id/agents/:agentId/donate'); }
  });

  return router;
}

/**
 * Agents router — /v1/data/agents/:agentId/*
 * Mounted separately since it does not nest under /treasury.
 */
function createAgentsApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || console;

  const workspaceFactory = (deps.db?.workspaces && deps.db?.spells)
    ? new WorkspaceFactory({ workspacesDb: deps.db.workspaces, spellsDb: deps.db.spells, userCoreDb: deps.db.userCore, storageService: deps.storageService, ipfsService: deps.ipfsService || new IpfsService(logger), logger })
    : null;

  const svc = new AgentAccountService({
    userCoreDb: deps.db?.userCore,
    economyService: deps.economyService,
    creditLedgerDb: deps.db?.creditLedger,
    toolRegistry: deps.toolRegistry,
    workspaceFactory,
    logger,
  });

  const delegationSvc = new DelegationService({
    delegationsDb: deps.db?.agentDelegations,
    userCoreDb: deps.db?.userCore,
    logger,
  });

  // Auth services — challenge/verify owner session
  const onChainVerifier = new OnChainVerifier({ logger });
  const challengeService = new ChallengeService();
  const verifySvc = new VerifyService({ challengeService, onChainVerifier, logger });

  const ownerSession = agentOwnerSession();

  function handleErr(res, err, label) {
    logger.error(`[AgentsApi] ${label}: ${err.message}`);
    const statusMap = {
      NOT_FOUND: 404, INVALID_PARAMS: 400, FORBIDDEN: 403,
      CHALLENGE_NOT_FOUND: 400, CHALLENGE_EXPIRED: 400, INVALID_NONCE: 400,
      INVALID_SIGNATURE: 400, OWNERSHIP_MISMATCH: 403, OWNER_RESOLUTION_FAILED: 502,
      CONFIG_ERROR: 500,
    };
    const status = statusMap[err.code] || 500;
    res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: err.message } });
  }

  const multisig = assertionJwt({ tier: 'multisig' });

  /**
   * GET /agents/:agentId/capabilities
   * Returns scope mapped to tool registry descriptors.
   */
  router.get('/:agentId/capabilities', multisig, async (req, res) => {
    try {
      const data = await svc.getAgentCapabilities(req.params.agentId);
      res.json(data);
    } catch (err) { handleErr(res, err, 'GET /agents/:agentId/capabilities'); }
  });

  /**
   * PATCH /agents/:agentId/capabilities/:capId
   * Updates a capability (scope entry) — replaces scope array.
   * Body: { scope: string[] }
   */
  router.patch('/:agentId/capabilities/:capId', multisig, async (req, res) => {
    try {
      const { scope } = req.body;
      const updated = await svc.updateAgentCapabilities(req.params.agentId, { scope });
      res.json(updated);
    } catch (err) { handleErr(res, err, 'PATCH /agents/:agentId/capabilities/:capId'); }
  });

  /**
   * PATCH /agents/:agentId/payout-policy
   * Updates payout policy on agent userCore.
   * Body: { mode, withdrawAddress?, split? }
   */
  router.patch('/:agentId/payout-policy', multisig, async (req, res) => {
    try {
      const { mode, withdrawAddress, split } = req.body;
      const agentDoc = await deps.db?.userCore?.findByAgentId(req.params.agentId);
      if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: `Agent ${req.params.agentId} not found` } });
      const updated = await deps.db.userCore.updatePayoutPolicy(agentDoc._id, { mode, withdrawAddress, split });
      res.json(updated);
    } catch (err) { handleErr(res, err, 'PATCH /agents/:agentId/payout-policy'); }
  });

  /**
   * GET /agents/:agentId/earnings
   * Public — aggregated X402_INBOUND + DONATION earnings.
   */
  router.get('/:agentId/earnings', async (req, res) => {
    try {
      const data = await svc.getAgentEarnings(req.params.agentId);
      res.json(data);
    } catch (err) { handleErr(res, err, 'GET /agents/:agentId/earnings'); }
  });

  // ---------------------------------------------------------------------------
  // Delegation link management (agent owner only — requires multisig JWT)
  // ---------------------------------------------------------------------------

  /**
   * POST /agents/:agentId/delegations
   * Create a delegation link the agent owner can share.
   * Body: { label?, spendCapPoints?, expiresInHours? }
   */
  router.post('/:agentId/delegations', ownerSession, async (req, res) => {
    try {
      if (req.agentSession.agentId !== req.params.agentId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Session does not match this agent' } });
      }
      const { label, spendCapPoints, expiresInHours } = req.body;
      const result = await delegationSvc.create(req.params.agentId, { label, spendCapPoints, expiresInHours });
      res.status(201).json(result);
    } catch (err) { handleErr(res, err, 'POST /agents/:agentId/delegations'); }
  });

  /**
   * GET /agents/:agentId/delegations
   * List active delegations for an agent (owner view).
   */
  router.get('/:agentId/delegations', ownerSession, async (req, res) => {
    try {
      if (req.agentSession.agentId !== req.params.agentId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Session does not match this agent' } });
      }
      const delegations = await delegationSvc.list(req.params.agentId);
      res.json({ delegations });
    } catch (err) { handleErr(res, err, 'GET /agents/:agentId/delegations'); }
  });

  /**
   * DELETE /agents/:agentId/delegations/:delegationId
   * Revoke a delegation link.
   */
  router.delete('/:agentId/delegations/:delegationId', ownerSession, async (req, res) => {
    try {
      if (req.agentSession.agentId !== req.params.agentId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Session does not match this agent' } });
      }
      await delegationSvc.revoke(req.params.agentId, req.params.delegationId);
      res.json({ success: true });
    } catch (err) { handleErr(res, err, 'DELETE /agents/:agentId/delegations/:delegationId'); }
  });

  // ---------------------------------------------------------------------------
  // Workspace sync endpoints
  // ---------------------------------------------------------------------------

  /**
   * GET /agents/:agentId/workspace/sync-status
   * Returns how far behind the agent's starter workspace is from the current template.
   * Public — no auth required (revision numbers are not sensitive).
   */
  router.get('/:agentId/workspace/sync-status', async (req, res) => {
    if (!workspaceFactory) return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Workspace service not configured' } });
    try {
      const agentDoc = await deps.db?.userCore?.findByAgentId(req.params.agentId);
      if (!agentDoc?.starterWorkspaceSlug) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent has no starter workspace' } });
      }
      const status = await workspaceFactory.getSyncStatus(agentDoc.starterWorkspaceSlug);
      res.json(status);
    } catch (err) { handleErr(res, err, 'GET /agents/:agentId/workspace/sync-status'); }
  });

  /**
   * POST /agents/:agentId/workspace/merge-template
   * Pulls latest template changes into the agent's starter workspace.
   * Requires multisig JWT (agent owner action).
   */
  router.post('/:agentId/workspace/merge-template', multisig, async (req, res) => {
    if (!workspaceFactory) return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Workspace service not configured' } });
    try {
      const agentDoc = await deps.db?.userCore?.findByAgentId(req.params.agentId);
      if (!agentDoc?.starterWorkspaceSlug) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent has no starter workspace' } });
      }
      const result = await workspaceFactory.mergeTemplateUpdate(agentDoc.starterWorkspaceSlug, agentDoc);
      res.json(result);
    } catch (err) { handleErr(res, err, 'POST /agents/:agentId/workspace/merge-template'); }
  });

  // ---------------------------------------------------------------------------
  // Owner auth — challenge / verify / session
  // ---------------------------------------------------------------------------

  /**
   * POST /agents/:agentId/auth/challenge
   * Issues an EIP-712 typed-data challenge for the agent owner to sign.
   * Public — no auth required.
   */
  router.post('/:agentId/auth/challenge', async (req, res) => {
    try {
      const agentDoc = await deps.db?.userCore?.findByAgentId(req.params.agentId);
      if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
      const challenge = verifySvc.issueChallenge(agentDoc);
      res.json(challenge);
    } catch (err) { handleErr(res, err, 'POST /agents/:agentId/auth/challenge'); }
  });

  /**
   * POST /agents/:agentId/auth/verify
   * Verifies the signed challenge and issues a session JWT.
   * Body: { nonce: string, signature: string }
   * Public — returns { sessionJwt, ownerAddress } on success.
   */
  router.post('/:agentId/auth/verify', async (req, res) => {
    try {
      const { nonce, signature } = req.body;
      if (!nonce || !signature) {
        return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'nonce and signature are required' } });
      }
      const agentDoc = await deps.db?.userCore?.findByAgentId(req.params.agentId);
      if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
      const result = await verifySvc.verify(agentDoc, { nonce, signature });
      res.json(result);
    } catch (err) { handleErr(res, err, 'POST /agents/:agentId/auth/verify'); }
  });

  // ---------------------------------------------------------------------------
  // Public agent card
  // ---------------------------------------------------------------------------

  /**
   * GET /agents/:agentId/card
   * Public profile card — safe for embedding.
   */
  router.get('/:agentId/card', async (req, res) => {
    try {
      const agentDoc = await deps.db?.userCore?.findByAgentId(req.params.agentId);
      if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
      res.json({
        agentId: agentDoc.agentId,
        agentChainId: agentDoc.agentChainId,
        agentTokenId: agentDoc.agentTokenId,
        agentCollection: agentDoc.agentCollection,
        profile: agentDoc.profile || {},
        scope: agentDoc.scope || [],
        starterWorkspaceSlug: agentDoc.starterWorkspaceSlug || null,
      });
    } catch (err) { handleErr(res, err, 'GET /agents/:agentId/card'); }
  });

  /**
   * GET /agents/:agentId/me
   * Owner-only view — includes ownerAddress, delegation list, workspace slug.
   * Requires agentOwnerSession JWT.
   */
  router.get('/:agentId/me', ownerSession, async (req, res) => {
    try {
      if (req.agentSession.agentId !== req.params.agentId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Session does not match requested agent' } });
      }
      const { agentDoc, balance } = await svc.getAgentBalance(req.params.agentId);
      if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
      res.json({
        agentId: agentDoc.agentId,
        ownerAddress: req.agentSession.ownerAddress,
        balance,
        scope: agentDoc.scope || [],
        starterWorkspaceSlug: agentDoc.starterWorkspaceSlug || null,
        payoutPolicy: agentDoc.payoutPolicy || null,
      });
    } catch (err) { handleErr(res, err, 'GET /agents/:agentId/me'); }
  });

  return router;
}

/**
 * Admin template workspace router.
 * Mounted at /v1/data/template-workspace.
 * Provides publish (revision bump) and propagate (batch merge) operations.
 */
function createTemplateWorkspaceApi(deps = {}) {
  const router = express.Router();
  const logger = deps.logger || console;

  const workspaceFactory = (deps.db?.workspaces && deps.db?.spells)
    ? new WorkspaceFactory({ workspacesDb: deps.db.workspaces, spellsDb: deps.db.spells, userCoreDb: deps.db.userCore, storageService: deps.storageService, ipfsService: deps.ipfsService || new IpfsService(logger), logger })
    : null;

  const multisig = assertionJwt({ tier: 'multisig' });

  function handleErr(res, err, label) {
    logger.error(`[TemplateWorkspaceApi] ${label}: ${err.message}`);
    const statusMap = { NOT_FOUND: 404, INVALID_PARAMS: 400 };
    res.status(statusMap[err.code] || 500).json({ error: { code: err.code || 'INTERNAL_ERROR', message: err.message } });
  }

  /**
   * POST /template-workspace/publish
   * Increments the template revision counter, signalling a new version is available.
   * Body: { slug? } — defaults to env/DB-configured template if omitted.
   */
  router.post('/publish', multisig, async (req, res) => {
    if (!workspaceFactory) return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Workspace service not configured' } });
    try {
      const template = await workspaceFactory._loadTemplate();
      const newRevision = await deps.db.workspaces.incrementRevision(template.slug);
      logger.info(`[TemplateWorkspaceApi] Template ${template.slug} published at r${newRevision}`);
      res.json({ slug: template.slug, revision: newRevision });
    } catch (err) { handleErr(res, err, 'POST /template-workspace/publish'); }
  });

  /**
   * POST /template-workspace/propagate
   * Merges the current template into all agent workspaces that are behind.
   * Long-running — returns a summary when complete.
   */
  router.post('/propagate', multisig, async (req, res) => {
    if (!workspaceFactory) return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Workspace service not configured' } });
    try {
      const summary = await workspaceFactory.propagateToAll();
      res.json(summary);
    } catch (err) { handleErr(res, err, 'POST /template-workspace/propagate'); }
  });

  return router;
}

module.exports = { createTreasuryApi, createAgentsApi, createTemplateWorkspaceApi };
