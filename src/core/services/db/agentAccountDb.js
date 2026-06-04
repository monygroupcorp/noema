/**
 * Agent Account Database
 *
 * Manages CAMEL agent runtime account records (ERC-8004 onboarding).
 * Each account links an on-chain CAMEL NFT agent to a Noema workspace
 * and a treasury for point-based spending.
 */

const crypto = require('crypto');
const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

/**
 * @typedef {Object} PayoutPolicy
 * @property {'self-fund'|'withdraw'|'split'} mode
 * @property {string} [withdrawAddress] - ETH address for withdraw/split mode
 */

/**
 * @typedef {Object} AgentAccountRecord
 * @property {string} agentAccountId   - 'cmw_' + 6-char hex (generated on create)
 * @property {string} treasuryId       - FK → TreasuryDB
 * @property {string} agentId          - ERC-8004 registration ID as string (from JWT sub)
 * @property {string} tokenId          - CAMEL NFT token ID as string
 * @property {string} ownerAddress     - Lowercase ETH address at time of assertion (owner_at_assertion)
 * @property {number|null} agentChainId - EVM chain ID from JWT sub (null if sub unparseable)
 * @property {string|null} agentAdapter - Adapter contract address (lowercase) from JWT sub.
 *   Stored without agentCollection so OnChainVerifier selects Mode B (adapter.ownerOf), which
 *   returns the human wallet even when the adapter contract holds the underlying NFT.
 * @property {string} noemaAccountId   - ObjectId string → userCore._id
 * @property {string} workspaceSlug    - Slug of cloned agent workspace
 * @property {string[]} scope
 * @property {number} balance          - Points (integer), starts at 0
 * @property {PayoutPolicy} payoutPolicy
 * @property {'active'|'revoked'|'suspended'} status
 * @property {Date} sessionIssuedAt
 * @property {Date} sessionExpiresAt
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

class AgentAccountDB extends BaseDB {
  constructor(logger) {
    super('agentAccounts');
    this.logger = logger || console;
  }

  async ensureIndexes() {
    const client = await getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    await col.createIndexes([
      { key: { agentAccountId: 1 }, unique: true, name: 'agentAccountId_unique_idx' },
      { key: { agentId: 1 }, unique: true, name: 'agentId_unique_idx' },
      { key: { treasuryId: 1, status: 1 }, name: 'treasuryId_status_idx', background: true },
      { key: { noemaAccountId: 1 }, name: 'noemaAccountId_idx', background: true },
    ]);
    this.logger.debug('[AgentAccountDB] Indexes ensured.');
  }

  /**
   * Generate a unique agentAccountId with collision detection.
   * Format: 'cmw_' + 6 hex chars = 10 chars total.
   */
  async _generateAgentAccountId() {
    let agentAccountId;
    let attempts = 0;
    do {
      agentAccountId = 'cmw_' + crypto.randomBytes(3).toString('hex');
      const existing = await this.findOne({ agentAccountId });
      if (!existing) break;
      attempts++;
      if (attempts > 10) throw new Error('[AgentAccountDB] Failed to generate unique agentAccountId after 10 attempts');
    } while (true);
    return agentAccountId;
  }

  async createAgentAccount({
    treasuryId,
    agentId,
    tokenId,
    ownerAddress,
    agentChainId,
    agentAdapter,
    noemaAccountId,
    workspaceSlug,
    scope,
    sessionIssuedAt,
    sessionExpiresAt,
  }) {
    const agentAccountId = await this._generateAgentAccountId();
    const revokeToken = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const result = await this.insertOne({
      agentAccountId,
      treasuryId,
      agentId,
      tokenId,
      ownerAddress: ownerAddress?.toLowerCase(),
      ...(agentChainId != null && { agentChainId }),
      ...(agentAdapter && { agentAdapter }),
      noemaAccountId,
      workspaceSlug,
      scope,
      balance: 0,
      payoutPolicy: { mode: 'self-fund' },
      revokeToken,
      status: 'active',
      sessionIssuedAt,
      sessionExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
    return { agentAccountId, revokeToken, insertedId: result.insertedId };
  }

  async findByAgentAccountId(agentAccountId) {
    return this.findOne({ agentAccountId });
  }

  async findByAgentId(agentId) {
    return this.findOne({ agentId });
  }

  async findByNoemaAccountId(noemaAccountId) {
    return this.findOne({ noemaAccountId });
  }

  async findActiveByTreasuryId(treasuryId) {
    return this.findMany({ treasuryId, status: 'active' });
  }

  async countByTreasuryId(treasuryId) {
    return this.count({ treasuryId, status: 'active' });
  }

  async findByCollection(collectionAddress) {
    return this.findMany({ agentAdapter: collectionAddress.toLowerCase(), status: 'active' });
  }

  async addBalance(agentAccountId, points) {
    return this.updateOne(
      { agentAccountId },
      { $inc: { balance: points }, $set: { updatedAt: new Date() } }
    );
  }

  // Atomic balance guard: returns false if balance < points (no write occurs).
  async debitBalance(agentAccountId, points) {
    const result = await this.updateOne(
      { agentAccountId, balance: { $gte: points } },
      { $inc: { balance: -points }, $set: { updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
  }

  async setPayoutPolicy(agentAccountId, policy) {
    return this.updateOne(
      { agentAccountId },
      { $set: { payoutPolicy: policy, updatedAt: new Date() } }
    );
  }

  async revoke(agentAccountId) {
    const now = new Date();
    return this.updateOne(
      { agentAccountId },
      { $set: { status: 'revoked', revokedAt: now, updatedAt: now } }
    );
  }

  async setStatus(agentAccountId, status) {
    return this.updateOne(
      { agentAccountId },
      { $set: { status, updatedAt: new Date() } }
    );
  }
}

module.exports = AgentAccountDB;
