// src/core/services/db/agentDelegationsDb.js

const { BaseDB, ObjectId } = require('./BaseDB');
const { PRIORITY, getCachedClient } = require('./utils/queue');
const crypto = require('crypto');

const COLLECTION_NAME = 'agent_delegations';

class AgentDelegationsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
  }

  async ensureIndexes() {
    try {
      const client = await getCachedClient();
      const collection = client.db(this.dbName).collection(this.collectionName);
      await collection.createIndexes([
        {
          key: { token: 1 },
          name: 'idx_delegation_token',
          unique: true,
          background: true,
        },
        {
          key: { agentAccountId: 1, revokedAt: 1, expiresAt: 1 },
          name: 'idx_delegation_agent_active',
          background: true,
        },
      ]);
      this.logger.debug('[AgentDelegationsDB] Indexes ensured.');
    } catch (err) {
      this.logger.error('[AgentDelegationsDB] Failed to ensure indexes:', err);
    }
  }

  /**
   * Generates a cryptographically random URL-safe token.
   * 24 bytes → 48 hex chars.
   */
  static generateToken() {
    return crypto.randomBytes(24).toString('hex');
  }

  /**
   * Creates a new delegation record.
   *
   * @param {{ agentId, agentAccountId, label?, spendCapPoints?, expiresAt? }} data
   * @returns {Promise<object>}
   */
  async create({ agentId, agentAccountId, label, spendCapPoints = null, expiresAt = null }) {
    const now = new Date();
    const doc = {
      agentId,
      agentAccountId: typeof agentAccountId === 'string' ? new ObjectId(agentAccountId) : agentAccountId,
      token: AgentDelegationsDB.generateToken(),
      label: label || null,
      spendCapPoints,
      pointsSpent: 0,
      usageCount: 0,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.insertOne(doc, false, PRIORITY.HIGH);
    return { ...doc, _id: result.insertedId };
  }

  /**
   * Finds a delegation by its opaque token. Returns null if not found.
   */
  async findByToken(token) {
    return this.findOne({ token }, PRIORITY.HIGH);
  }

  /**
   * Finds a delegation by its _id.
   */
  async findById(id) {
    const oid = typeof id === 'string' ? new ObjectId(id) : id;
    return this.findOne({ _id: oid }, PRIORITY.HIGH);
  }

  /**
   * Returns all non-revoked delegations for an agent account, newest first.
   * Includes expired ones so the owner can see the history.
   *
   * @param {ObjectId|string} agentAccountId
   */
  async findByAgentAccountId(agentAccountId) {
    const oid = typeof agentAccountId === 'string' ? new ObjectId(agentAccountId) : agentAccountId;
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);
    return collection
      .find({ agentAccountId: oid, revokedAt: null })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /**
   * Marks a delegation as revoked. Idempotent.
   *
   * @param {ObjectId|string} delegationId
   */
  async revoke(delegationId) {
    const oid = typeof delegationId === 'string' ? new ObjectId(delegationId) : delegationId;
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);
    await collection.updateOne(
      { _id: oid, revokedAt: null },
      { $set: { revokedAt: new Date(), updatedAt: new Date() } }
    );
  }

  /**
   * Atomically increments pointsSpent and usageCount.
   * Returns the updated document.
   * Throws if the cap would be exceeded.
   *
   * The cap constraint is enforced inside the query filter so the read and
   * write are a single atomic operation — concurrent calls cannot both pass
   * the cap check and then both increment (TOCTOU race condition).
   *
   * @param {ObjectId|string} delegationId
   * @param {number} points
   */
  async recordSpend(delegationId, points) {
    const oid = typeof delegationId === 'string' ? new ObjectId(delegationId) : delegationId;
    const client = await getCachedClient();
    const collection = client.db(this.dbName).collection(this.collectionName);

    // Atomic update: the filter rejects documents where the cap would be
    // exceeded.  When spendCapPoints is null there is no cap, so we include
    // both cases in the $expr via an $or.
    const result = await collection.findOneAndUpdate(
      {
        _id: oid,
        revokedAt: null,
        $or: [
          { spendCapPoints: null },
          { $expr: { $lte: [{ $add: ['$pointsSpent', points] }, '$spendCapPoints'] } },
        ],
      },
      {
        $inc: { pointsSpent: points, usageCount: 1 },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    if (result) return result;

    // The atomic update did not match — do a separate read to produce a
    // meaningful error code (not part of the critical path, races here are
    // harmless because we are only building an error message).
    const delegation = await collection.findOne({ _id: oid });
    if (!delegation) throw Object.assign(new Error('Delegation not found'), { code: 'NOT_FOUND' });
    if (delegation.revokedAt) throw Object.assign(new Error('Delegation revoked'), { code: 'REVOKED' });
    throw Object.assign(new Error('Delegation spend cap exceeded'), { code: 'CAP_EXCEEDED' });
  }
}

module.exports = AgentDelegationsDB;
