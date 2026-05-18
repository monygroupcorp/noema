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
 * @property {string} treasuryId     - Unique treasury key (e.g. 'camel-1')
 * @property {string} issuerName     - Human-readable issuer name (e.g. 'camel')
 * @property {string} issuerDomain   - Issuer domain (e.g. 'camelcabal.fun')
 * @property {number} balance        - Point balance (integer)
 * @property {FaucetPolicy} faucetPolicy
 * @property {'active'|'suspended'} status
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
    ]);
    this.logger.debug('[TreasuryDB] Indexes ensured.');
  }

  async createTreasury({ treasuryId, issuerName, issuerDomain, faucetPolicy, balance = 0 }) {
    const now = new Date();
    return this.insertOne({
      treasuryId,
      issuerName,
      issuerDomain,
      faucetPolicy,
      balance,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
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
    return this.updateOne(
      { treasuryId },
      { $inc: { balance: -points }, $set: { updatedAt: new Date() } }
    );
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

  async listAll() {
    return this.findMany({}, { sort: { createdAt: -1 } });
  }
}

module.exports = TreasuryDB;
