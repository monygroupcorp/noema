/**
 * Partner Database
 *
 * Manages API partner records for the StationThis partner program.
 * Partners are third-party sites that embed StationThis tools and
 * receive a revenue share (splitBps) on generations.
 */

const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

/**
 * @typedef {Object} PartnerRecord
 * @property {string} partnerId - Unique partner key (e.g. 'pk_live_abc123')
 * @property {string} name - Human-readable partner name
 * @property {string[]} allowedDomains - Domains allowed to use this partner key
 * @property {number} splitBps - Revenue share in basis points (e.g. 500 = 5%)
 * @property {string} status - 'active' | 'suspended' | 'inactive'
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

class PartnerDB extends BaseDB {
  constructor(logger) {
    super('partners');
    this.logger = logger || console;
  }

  /**
   * Ensure indexes exist
   */
  async ensureIndexes() {
    const client = await getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    await col.createIndexes([
      { key: { partnerId: 1 }, unique: true, name: 'partnerId_unique_idx' },
      { key: { allowedDomains: 1, status: 1 }, name: 'allowedDomains_status_idx', background: true },
      { key: { status: 1, createdAt: -1 }, name: 'status_createdAt_idx', background: true },
    ]);
    this.logger.debug('[PartnerDB] Indexes ensured.');
  }

  async createPartner(partnerData) {
    const now = new Date();
    return this.insertOne({
      ...partnerData,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  async findPartnerById(partnerId) {
    return this.findOne({ partnerId, status: 'active' });
  }

  async findPartnerByDomain(domain) {
    return this.findOne({ allowedDomains: domain, status: 'active' });
  }

  async listPartners() {
    return this.findMany({}, { sort: { createdAt: -1 } });
  }

  async updatePartner(partnerId, fields) {
    return this.updateOne(
      { partnerId },
      { $set: { ...fields, updatedAt: new Date() } }
    );
  }
}

module.exports = PartnerDB;
