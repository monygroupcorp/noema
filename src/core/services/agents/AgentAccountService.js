// src/core/services/agents/AgentAccountService.js
//
// Business logic for treasury and agent sub-account lifecycle.
// All balance mutations go through economyService to stay on the credit ledger.

const { ObjectId } = require('mongodb');
const { createLogger } = require('../../../utils/logger');

const logger = createLogger('AgentAccountService');

// Prefix for agent sub-account IDs returned to issuers
const AGENT_ID_PREFIX = 'cmw_';

/** @param {string|ObjectId} id */
function toOid(id) {
  return typeof id === 'string' ? new ObjectId(id) : id;
}

/** Returns the current ISO week string, e.g. "2026-W19" */
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

class AgentAccountService {
  /**
   * @param {{ userCoreDb, economyService, creditLedgerDb, toolRegistry?, workspaceFactory?, logger? }} deps
   */
  constructor({ userCoreDb, economyService, creditLedgerDb, toolRegistry, workspaceFactory, logger: injectedLogger } = {}) {
    this.userCoreDb = userCoreDb;
    this.economyService = economyService;
    this.creditLedgerDb = creditLedgerDb;
    this.toolRegistry = toolRegistry;
    this.workspaceFactory = workspaceFactory || null;
    this.logger = injectedLogger || logger;
  }

  // ---------------------------------------------------------------------------
  // Treasury lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates a new treasury userCore document.
   *
   * @param {{ name: string, issuerSub: string, faucetPolicy?: object }} params
   * @returns {Promise<object>} Created treasury userCore doc
   */
  async createTreasury({ name, issuerSub, faucetPolicy } = {}) {
    if (!name) throw Object.assign(new Error('name is required'), { code: 'INVALID_PARAMS' });
    if (!issuerSub) throw Object.assign(new Error('issuerSub is required'), { code: 'INVALID_PARAMS' });

    const doc = await this.userCoreDb.createTypedAccount('treasury', {
      profile: { name },
      issuerSub,
      ...(faucetPolicy && { treasuryFaucetPolicy: faucetPolicy }),
    });

    this.logger.info(`[AgentAccountService] Treasury created: ${doc._id} (issuer: ${issuerSub})`);
    return doc;
  }

  /**
   * Credits points into a treasury's credit ledger balance.
   *
   * @param {string|ObjectId} treasuryId
   * @param {{ points: number, description?: string, idempotencyKey?: string }} params
   */
  async fundTreasury(treasuryId, { points, description, idempotencyKey } = {}) {
    const treasury = await this._requireAccount(treasuryId, 'treasury');

    if (!Number.isInteger(points) || points <= 0) {
      throw Object.assign(new Error('points must be a positive integer'), { code: 'INVALID_PARAMS' });
    }

    // Idempotency: if key supplied, check for existing credit entry
    if (idempotencyKey) {
      const existing = await this.creditLedgerDb.findOne({ 'related_items.idempotencyKey': idempotencyKey });
      if (existing) {
        this.logger.info(`[AgentAccountService] fundTreasury: idempotent replay for key ${idempotencyKey}`);
        return { entryId: existing._id, idempotent: true };
      }
    }

    const result = await this.economyService.creditPoints(treasury._id, {
      points,
      description: description || `Treasury fund deposit`,
      rewardType: 'TREASURY_FUND',
      relatedItems: { treasuryId: treasury._id.toString(), ...(idempotencyKey && { idempotencyKey }) },
    });

    this.logger.info(`[AgentAccountService] Treasury ${treasury._id} funded with ${points} pts`);
    return result;
  }

  /**
   * Returns a treasury document with its current credit balance.
   * Sensitive fields (faucetPolicy, memberCaps) are included — caller must gate access.
   *
   * @param {string|ObjectId} treasuryId
   * @returns {Promise<{ doc: object, balance: number }>}
   */
  async getTreasury(treasuryId) {
    const doc = await this._requireAccount(treasuryId, 'treasury');
    const balance = await this._sumBalance(doc._id);
    return { doc, balance };
  }

  // ---------------------------------------------------------------------------
  // Agent sub-account lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Creates an agent sub-account under a treasury, applies the starter grant.
   *
   * @param {string|ObjectId} treasuryId
   * @param {{ agentId: string, chainId: number, adapter: string, registry: string, tokenId: number, ownerAddress: string, collection: string, scope?: string[] }} agentParams
   * @returns {Promise<{ agentDoc: object, agentAccountId: string, starterGrantApplied: number }>}
   */
  async createAgentSubAccount(treasuryId, agentParams = {}) {
    const { agentId, chainId, adapter, registry, tokenId, tokenUri, ownerAddress, collection, scope = [] } = agentParams;

    if (!agentId) throw Object.assign(new Error('agentId is required'), { code: 'INVALID_PARAMS' });

    const treasury = await this._requireAccount(treasuryId, 'treasury');

    // Prevent duplicates
    const existing = await this.userCoreDb.findByAgentId(agentId);
    if (existing) {
      throw Object.assign(new Error(`Agent ${agentId} already registered`), { code: 'AGENT_EXISTS', agentAccountId: `${AGENT_ID_PREFIX}${existing._id.toString('hex')}` });
    }

    const agentDoc = await this.userCoreDb.createTypedAccount('agent', {
      agentId,
      agentChainId: chainId,
      agentAdapter: adapter,
      agentRegistry: registry,
      agentTokenId: tokenId,
      agentOwnerAddress: ownerAddress,
      agentCollection: collection,
      masterTreasuryId: toOid(treasuryId),
      scope,
    });

    const agentAccountId = `${AGENT_ID_PREFIX}${agentDoc._id.toString()}`;

    // Apply starter grant from treasury faucet policy
    let starterGrantApplied = 0;
    const policy = treasury.treasuryFaucetPolicy;
    if (policy?.starterGrantPoints > 0) {
      const treasuryBalance = await this._sumBalance(treasury._id);
      if (treasuryBalance >= policy.starterGrantPoints) {
        try {
          await this.economyService.transferPoints(treasury._id, agentDoc._id, policy.starterGrantPoints, {
            description: 'Agent starter grant from treasury',
            rewardType: 'STARTER_GRANT',
            relatedItems: { treasuryId: treasury._id.toString(), agentId },
            idempotencyKey: `starter-grant:${agentDoc._id}`,
          });
          starterGrantApplied = policy.starterGrantPoints;
          this.logger.info(`[AgentAccountService] Applied starter grant of ${policy.starterGrantPoints} pts to agent ${agentDoc._id}`);
        } catch (grantErr) {
          this.logger.warn(`[AgentAccountService] Starter grant failed for agent ${agentDoc._id}: ${grantErr.message}`);
        }
      } else {
        this.logger.warn(`[AgentAccountService] Treasury ${treasury._id} insufficient for starter grant (has ${treasuryBalance}, needs ${policy.starterGrantPoints})`);
      }
    }

    // Provision starter workspace (non-fatal — agent is usable even without it)
    let starterWorkspaceSlug = null;
    if (this.workspaceFactory) {
      try {
        const wf = await this.workspaceFactory.provisionAgentWorkspace({ agentDoc, tokenUri });
        starterWorkspaceSlug = wf.slug;
      } catch (wfErr) {
        this.logger.warn(`[AgentAccountService] Workspace provisioning failed for agent ${agentId}: ${wfErr.message}`);
      }
    }

    this.logger.info(`[AgentAccountService] Agent sub-account created: ${agentAccountId} under treasury ${treasury._id}`);
    return { agentDoc, agentAccountId, starterGrantApplied, starterWorkspaceSlug };
  }

  /**
   * Tops up an agent's balance from its treasury.
   *
   * @param {string|ObjectId} treasuryId
   * @param {string} agentId - ERC-8004 agentId
   * @param {{ points: number, idempotencyKey?: string }} params
   */
  async topUpAgent(treasuryId, agentId, { points, idempotencyKey } = {}) {
    const treasury = await this._requireAccount(treasuryId, 'treasury');
    const agentDoc = await this._requireAgent(agentId, treasury._id);

    if (!Number.isInteger(points) || points <= 0) {
      throw Object.assign(new Error('points must be a positive integer'), { code: 'INVALID_PARAMS' });
    }

    await this.economyService.transferPoints(treasury._id, agentDoc._id, points, {
      description: 'Treasury top-up to agent',
      rewardType: 'TREASURY_TOPUP',
      relatedItems: { treasuryId: treasury._id.toString(), agentId, ...(idempotencyKey && { idempotencyKey }) },
      idempotencyKey,
    });

    const balance = await this._sumBalance(agentDoc._id);
    this.logger.info(`[AgentAccountService] Agent ${agentId} topped up by ${points} pts (new balance: ${balance})`);
    return { agentId, balance };
  }

  /**
   * Returns an agent doc with balance and last 10 SPEND_DEBIT entries.
   * Safe for public exposure — does not include treasury fields.
   *
   * @param {string} agentId
   * @returns {Promise<{ agentDoc: object, balance: number, recentDebits: Array }>}
   */
  async getAgentBalance(agentId) {
    const agentDoc = await this.userCoreDb.findByAgentId(agentId);
    if (!agentDoc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });

    const balance = await this._sumBalance(agentDoc._id);

    let recentDebits = [];
    try {
      recentDebits = await this.creditLedgerDb.findMany(
        { master_account_id: agentDoc._id, type: 'SPEND_DEBIT' },
        { sort: { createdAt: -1 }, limit: 10 }
      );
    } catch (err) {
      this.logger.warn(`[AgentAccountService] Could not fetch recent debits for ${agentId}: ${err.message}`);
    }

    return { agentDoc, balance, recentDebits };
  }

  /**
   * Aggregates X402_INBOUND + DONATION credit entries for an agent.
   * Public endpoint — only shows earnings totals, not balance or spend.
   *
   * @param {string} agentId
   */
  async getAgentEarnings(agentId) {
    const agentDoc = await this.userCoreDb.findByAgentId(agentId);
    if (!agentDoc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });

    let entries = [];
    try {
      entries = await this.creditLedgerDb.findMany(
        { master_account_id: agentDoc._id, type: 'REWARD_CREDIT', reward_type: { $in: ['X402_INBOUND', 'DONATION'] } },
        { sort: { createdAt: -1 }, limit: 100 }
      );
    } catch (err) {
      this.logger.warn(`[AgentAccountService] Could not fetch earnings for ${agentId}: ${err.message}`);
    }

    const totals = entries.reduce((acc, e) => {
      const rt = e.reward_type || e.rewardType || 'OTHER';
      acc[rt] = (acc[rt] || 0) + (e.points_credited || e.points || 0);
      return acc;
    }, {});

    return { agentId, totals, entries };
  }

  /**
   * Credits a donation to an agent's balance.
   *
   * @param {string} agentId
   * @param {{ points: number, donorNote?: string }} params
   */
  async donateToAgent(agentId, { points, donorNote } = {}) {
    const agentDoc = await this.userCoreDb.findByAgentId(agentId);
    if (!agentDoc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });

    if (!Number.isInteger(points) || points <= 0) {
      throw Object.assign(new Error('points must be a positive integer'), { code: 'INVALID_PARAMS' });
    }

    const result = await this.economyService.creditPoints(agentDoc._id, {
      points,
      description: donorNote ? `Donation: ${donorNote}` : 'Donation',
      rewardType: 'DONATION',
      relatedItems: { agentId },
    });

    return result;
  }

  /**
   * Returns an agent's capability scope mapped to tool registry descriptors.
   *
   * @param {string} agentId
   */
  async getAgentCapabilities(agentId) {
    const agentDoc = await this.userCoreDb.findByAgentId(agentId);
    if (!agentDoc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });

    const scope = agentDoc.scope || [];

    let tools = [];
    if (this.toolRegistry && scope.length > 0) {
      try {
        const allTools = await this.toolRegistry.getAll();
        tools = allTools.filter(t => scope.includes(t.toolId) || scope.includes('*'));
      } catch (err) {
        this.logger.warn(`[AgentAccountService] Could not fetch tool registry for ${agentId}: ${err.message}`);
      }
    }

    return { agentId, scope, tools };
  }

  /**
   * Updates an agent's capability scope (replaces scope array).
   */
  async updateAgentCapabilities(agentId, { scope } = {}) {
    const agentDoc = await this.userCoreDb.findByAgentId(agentId);
    if (!agentDoc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });

    return this.userCoreDb.updateUserCore(agentDoc._id, { $set: { scope } });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  async _requireAccount(id, expectedType) {
    const doc = await this.userCoreDb.findUserCoreById(id);
    if (!doc) throw Object.assign(new Error(`Account ${id} not found`), { code: 'NOT_FOUND' });
    if (doc.accountType !== expectedType) {
      throw Object.assign(new Error(`Account ${id} is not a ${expectedType} account`), { code: 'WRONG_ACCOUNT_TYPE' });
    }
    return doc;
  }

  async _requireAgent(agentId, treasuryOid) {
    const doc = await this.userCoreDb.findByAgentId(agentId);
    if (!doc) throw Object.assign(new Error(`Agent ${agentId} not found`), { code: 'NOT_FOUND' });
    if (doc.masterTreasuryId?.toString() !== treasuryOid.toString()) {
      throw Object.assign(new Error(`Agent ${agentId} does not belong to this treasury`), { code: 'WRONG_TREASURY' });
    }
    return doc;
  }

  async _sumBalance(accountId) {
    try {
      const deposits = await this.creditLedgerDb.findActiveDepositsForUser(toOid(accountId));
      return deposits.reduce((sum, d) => sum + (d.points_remaining || 0), 0);
    } catch (err) {
      this.logger.warn(`[AgentAccountService] Could not sum balance for ${accountId}: ${err.message}`);
      return 0;
    }
  }
}

module.exports = { AgentAccountService, isoWeek };
