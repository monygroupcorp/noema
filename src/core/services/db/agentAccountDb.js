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
 * @typedef {Object} SpendingCap
 * @property {string} amount
 * @property {string} currency
 * @property {string} period
 */

/**
 * @typedef {Object} AgentAccountRecord
 * @property {string} agentAccountId   - 'cmw_' + 6-char hex (generated on create)
 * @property {string} treasuryId       - FK → TreasuryDB
 * @property {string} agentId          - ERC-8004 uint as string
 * @property {string} tokenId          - CAMEL NFT token ID as string
 * @property {string} ownerAddress     - Lowercase ETH address at time of assertion
 * @property {string} noemaAccountId   - ObjectId string → userCore._id
 * @property {string} workspaceSlug    - Slug of cloned agent workspace
 * @property {string[]} scope
 * @property {SpendingCap} spendingCap
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
    noemaAccountId,
    workspaceSlug,
    scope,
    spendingCap,
    sessionIssuedAt,
    sessionExpiresAt,
  }) {
    const agentAccountId = await this._generateAgentAccountId();
    const now = new Date();
    return this.insertOne({
      agentAccountId,
      treasuryId,
      agentId,
      tokenId,
      ownerAddress,
      noemaAccountId,
      workspaceSlug,
      scope,
      spendingCap,
      balance: 0,
      payoutPolicy: { mode: 'self-fund' },
      status: 'active',
      sessionIssuedAt,
      sessionExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
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

  async addBalance(agentAccountId, points) {
    return this.updateOne(
      { agentAccountId },
      { $inc: { balance: points }, $set: { updatedAt: new Date() } }
    );
  }

  async debitBalance(agentAccountId, points) {
    return this.updateOne(
      { agentAccountId },
      { $inc: { balance: -points }, $set: { updatedAt: new Date() } }
    );
  }

  async setPayoutPolicy(agentAccountId, policy) {
    return this.updateOne(
      { agentAccountId },
      { $set: { payoutPolicy: policy, updatedAt: new Date() } }
    );
  }

  async revoke(agentAccountId) {
    return this.updateOne(
      { agentAccountId },
      { $set: { status: 'revoked', updatedAt: new Date() } }
    );
  }
}

module.exports = AgentAccountDB;
