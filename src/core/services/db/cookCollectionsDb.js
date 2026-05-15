const { BaseDB } = require('./BaseDB');
const { v4: uuidv4 } = require('uuid');

class CookCollectionsDB extends BaseDB {
  constructor(logger) {
    // Use new consolidated collection name. Keep legacy class name for backward compatibility.
    super('collections');
    this.logger = logger || console;
    // Align DB name with other services (noema by default)
    this.dbName = 'noema' || process.env.MONGO_DB_NAME || 'station';
  }

  /**
   * Create a new collection doc.
   */
  async createCollection({ name, description = '', userId, config = {} }) {
    const doc = {
      collectionId: uuidv4(),
      name,
      description,
      userId,
      config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.insertOne(doc);
    return doc;
  }

  async findByUser(userId) {
    return this.findMany({ userId }, { projection: { _id: 0 } });
  }

  async findById(collectionId) {
    return this.findOne({ collectionId }, { projection: { _id: 0 } });
  }

  async updateCollection(collectionId, update, unsetFields = {}) {
    update.updatedAt = new Date();
    const updateOp = { $set: update };
    if (Object.keys(unsetFields).length > 0) {
      updateOp.$unset = unsetFields;
    }
    return this.updateOne({ collectionId }, updateOp);
  }

  async deleteCollection(collectionId, userId) {
    const query = { collectionId };
    if (userId) query.userId = userId;
    await this.deleteOne(query);
  }

  /**
   * Set the rev-share BPS for a collection.
   * @param {string} collectionId
   * @param {number} bps  — e.g. 500 = 5%
   */
  async setRevShareBps(collectionId, bps) {
    if (typeof bps !== 'number' || bps < 0 || bps > 10000) {
      throw new Error('revShareBps must be a number 0–10000');
    }
    const result = await this.updateCollection(collectionId, { 'config.revShareBps': bps });
    if (result?.matchedCount === 0) {
      throw new Error(`Collection not found: ${collectionId}`);
    }
  }
}

module.exports = CookCollectionsDB;
