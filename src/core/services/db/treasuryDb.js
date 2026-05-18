/**
 * Treasury Database
 *
 * Manages CAMEL agent runtime treasury records. Each treasury is backed
 * by a trusted issuer (e.g. 'camelcabal.fun') and holds a point balance
 * that funds agent provisioning via the faucet policy.
 */

const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

/**
 * @typedef {Object} FaucetPolicy
 * @property {number} starterGrant   - Points allocated on first provisioning
 * @property {number} monthlyMax     - Points ceiling per agent per month
 * @property {'on'|'off'|'hybrid'} subsidyMode
 * @property {'weekly'|'biweekly'|'monthly'} refillCadence
 */

/**
 * @typedef {Object} TreasuryRecord
 * @property {string} treasuryId              - Unique treasury key (e.g. 'camel-1')
 * @property {string} issuerName              - Human-readable issuer name (e.g. 'camel')
 * @property {string} issuerDomain            - Issuer domain (e.g. 'camelcabal.fun')
 * @property {number} balance                 - Point balance (integer)
 * @property {FaucetPolicy} faucetPolicy
 * @property {'active'|'suspended'} status
 * @property {string} [partnerId]             - Optional: linked partner API key for usage tracking
 * @property {string} [starterWorkspaceSlug]  - Workspace template slug for this issuer (falls back to DEFAULT_STARTER_WORKSPACE_SLUG env var)
 * @property {Date|null} [lastDripAt]         - Timestamp of last faucet drip run; undefined on legacy records (treated as null)
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

class TreasuryDB extends BaseDB {
  constructor(logger) {
    super('treasuries');
    this.logger = logger || console;
  }

  async ensureIndexes() {
    const client = await getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    await col.createIndexes([
      { key: { treasuryId: 1 }, unique: true, name: 'treasuryId_unique_idx' },
      { key: { issuerDomain: 1, status: 1 }, name: 'issuerDomain_status_idx', background: true },
      { key: { partnerId: 1 }, name: 'partnerId_idx', background: true, sparse: true },
    ]);
    this.logger.debug('[TreasuryDB] Indexes ensured.');
  }

  async createTreasury({ treasuryId, issuerName, issuerDomain, faucetPolicy, balance = 0, partnerId, starterWorkspaceSlug }) {
    const now = new Date();
    return this.insertOne({
      treasuryId,
      issuerName,
      issuerDomain,
      faucetPolicy,
      balance,
      ...(partnerId ? { partnerId } : {}),
      ...(starterWorkspaceSlug ? { starterWorkspaceSlug } : {}),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateStarterWorkspaceSlug(treasuryId, starterWorkspaceSlug) {
    return this.updateOne(
      { treasuryId },
      { $set: { starterWorkspaceSlug, updatedAt: new Date() } }
    );
  }

  async findByTreasuryId(treasuryId) {
    return this.findOne({ treasuryId });
  }

  async findByIssuerDomain(issuerDomain) {
    return this.findOne({ issuerDomain });
  }

  async addBalance(treasuryId, points) {
    return this.updateOne(
      { treasuryId },
      { $inc: { balance: points }, $set: { updatedAt: new Date() } }
    );
  }

  async debitBalance(treasuryId, points) {
    // Caller is responsible for verifying sufficient balance before calling
    const result = await this.updateOne(
      { treasuryId, balance: { $gte: points } },
      { $inc: { balance: -points }, $set: { updatedAt: new Date() } }
    );
    return result.matchedCount > 0; // false = insufficient balance (atomic check)
  }

  async updateFaucetPolicy(treasuryId, policy) {
    return this.updateOne(
      { treasuryId },
      { $set: { faucetPolicy: policy, updatedAt: new Date() } }
    );
  }

  async setStatus(treasuryId, status) {
    return this.updateOne(
      { treasuryId },
      { $set: { status, updatedAt: new Date() } }
    );
  }

  async updatePartnerId(treasuryId, partnerId) {
    return this.updateOne({ treasuryId }, { $set: { partnerId, updatedAt: new Date() } });
  }

  async listAll() {
    return this.findMany({}, { sort: { createdAt: -1 } });
  }

  /**
   * Find all active treasuries, sorted by createdAt ascending.
   * Used by the faucet worker to sweep all fundable treasuries.
   * @returns {Promise<TreasuryRecord[]>}
   */
  async findActiveTreasuries() {
    return this.findMany({ status: 'active' }, { sort: { createdAt: 1 } });
  }

  /**
   * Set the lastDripAt timestamp after a faucet sweep.
   * @param {string} treasuryId
   * @param {Date} date
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async updateLastDripAt(treasuryId, date) {
    return this.updateOne(
      { treasuryId },
      { $set: { lastDripAt: date, updatedAt: new Date() } }
    );
  }
}

module.exports = TreasuryDB;
