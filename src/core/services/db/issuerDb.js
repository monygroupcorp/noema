const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

/**
 * @typedef {Object} IssuerRecord
 * @property {string} issuerId   - Matches JWT `iss` claim exactly (e.g. 'https://camelcabal.fun')
 * @property {string} name       - Human-readable name (e.g. 'CAMEL')
 * @property {string} jwksUrl    - JWKS endpoint URL
 * @property {'active'|'suspended'} status
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

class IssuerDB extends BaseDB {
  constructor(logger) {
    super('trusted_issuers');
    this.logger = logger || console;
  }

  async ensureIndexes() {
    const client = await getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    await col.createIndexes([
      { key: { issuerId: 1 }, unique: true, name: 'issuerId_unique_idx' },
      { key: { status: 1 }, name: 'status_idx', background: true },
    ]);
    this.logger.debug('[IssuerDB] Indexes ensured.');
  }

  async createIssuer({ issuerId, name, jwksUrl }) {
    const now = new Date();
    return this.insertOne({ issuerId, name, jwksUrl, status: 'active', createdAt: now, updatedAt: now });
  }

  async findByIssuerId(issuerId) {
    return this.findOne({ issuerId, status: 'active' });
  }

  async findByIssuerIdAny(issuerId) {
    return this.findOne({ issuerId });
  }

  async listIssuers() {
    return this.findMany({}, { sort: { createdAt: -1 } });
  }

  async updateIssuer(issuerId, fields) {
    return this.updateOne(
      { issuerId },
      { $set: { ...fields, updatedAt: new Date() } }
    );
  }
}

module.exports = IssuerDB;
