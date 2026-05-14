const { BaseDB } = require('./BaseDB');

const COLLECTION_NAME = 'partners';

class PartnerDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
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
