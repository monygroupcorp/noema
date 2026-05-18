/**
 * Split Ledger Database
 *
 * Records the partner's revenue share credit for each completed spell run.
 * Each entry tracks the gross payment amount and the partner's cut (partnerAmount)
 * calculated from their splitBps at the time of the run.
 *
 * Status lifecycle: pending → credited
 */

const { BaseDB } = require('./BaseDB');
const { dbQueue, getCachedClient } = require('./utils/queue');

const COLLECTION_NAME = 'split_ledger';

/**
 * @typedef {Object} SplitLedgerEntry
 * @property {string} partnerId       - Partner identifier (e.g. 'pk_live_abc123')
 * @property {string} runId           - Unique run ID that generated this credit (unique index)
 * @property {string} spellSlug       - Slug of the spell that was executed
 * @property {string|null} uploadId   - Associated upload record ID, or null if no upload
 * @property {string} grossAmount     - Total payment amount (as string, USDC base units)
 * @property {string} partnerAmount   - Partner's cut (as string, USDC base units)
 * @property {string} asset           - ERC-20 token contract address for the payment
 * @property {string} network         - CAIP-2 network identifier (e.g. 'eip155:8453')
 * @property {'pending'|'credited'} status - Lifecycle state
 * @property {Date|null} settledAt    - When the credit was settled, or null if pending
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {Object} AgentOwnerUnclaimedEntry
 * @property {'agent_owner_unclaimed'} type
 * @property {string} runId
 * @property {string} spellSlug
 * @property {string} agentId
 * @property {string} ownerAddress    - ETH wallet address of the agent owner
 * @property {number} pointsAmount    - Points owed (not USDC)
 * @property {'pending'|'credited'} status
 * @property {Date} [creditedAt]      - Set when dragnet credits the owner; absent until then
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

class SplitLedgerDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
  }

  /**
   * Ensure indexes exist for this collection.
   * - runId + type: unique compound (standard entries have no type field; unclaimed entries
   *   have type: 'agent_owner_unclaimed' — allows both to share the same runId)
   * - partnerId + status + createdAt: partner ledger queries + pagination
   * - status: background settlement queries
   * - type + status + createdAt: dragnet sweep for agent_owner_unclaimed entries
   */
  async ensureIndexes() {
    await dbQueue.enqueue(async () => {
      const client = await getCachedClient();
      const col = client.db(this.dbName).collection(this.collectionName);
      await col.createIndexes([
        { key: { runId: 1, type: 1 }, unique: true, name: 'runId_type_unique_idx' },
        { key: { partnerId: 1, status: 1, createdAt: -1 }, name: 'partnerId_status_createdAt_idx', background: true },
        { key: { status: 1 }, name: 'status_idx', background: true },
        { key: { type: 1, status: 1, createdAt: 1 }, name: 'type_status_createdAt_idx', background: true },
      ]);
    });
    this.logger.debug('[SplitLedgerDB] Indexes ensured.');
  }

  /**
   * Create a new split ledger entry with pending status.
   * @param {{ partnerId: string, runId: string, spellSlug: string, uploadId: string|null,
   *           grossAmount: string, partnerAmount: string, asset: string, network: string }} params
   * @returns {Promise<import('mongodb').InsertOneResult>}
   */
  async createEntry({ partnerId, runId, spellSlug, uploadId, grossAmount, partnerAmount, asset, network }) {
    const now = new Date();
    return this.insertOne({
      partnerId,
      runId,
      spellSlug,
      uploadId: uploadId || null,
      grossAmount,
      partnerAmount,
      asset,
      network,
      status: 'pending',
      settledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Transition a pending entry to credited status.
   * @param {string} runId
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async markCredited(runId) {
    return this.updateOne(
      { runId, status: 'pending' },
      { $set: { status: 'credited', settledAt: new Date(), updatedAt: new Date() } }
    );
  }

  /**
   * Create an unclaimed agent-owner entry (owner has no Noema account at time of run).
   * @param {{ runId: string, spellSlug: string, agentId: string, ownerAddress: string, pointsAmount: number }} params
   * @returns {Promise<import('mongodb').InsertOneResult>}
   */
  async createUnclaimedAgentOwnerEntry({ runId, spellSlug, agentId, ownerAddress, pointsAmount }) {
    const now = new Date();
    // creditedAt intentionally omitted — BaseDB.validateData strips nulls.
    // The dragnet sets it via $set when the owner onboards.
    return this.insertOne({
      type: 'agent_owner_unclaimed',
      runId,
      spellSlug,
      agentId,
      ownerAddress,
      pointsAmount,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Return pending unclaimed agent-owner entries for dragnet.
   * @param {number} limit
   * @returns {Promise<AgentOwnerUnclaimedEntry[]>}
   */
  async findUnclaimed(limit = 100) {
    return this.findMany(
      { type: 'agent_owner_unclaimed', status: 'pending' },
      { sort: { createdAt: 1 }, limit }
    );
  }

  /**
   * Mark an unclaimed agent-owner entry as credited (dragnet sweep).
   * @param {string} runId
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async markAgentOwnerCredited(runId) {
    return this.updateOne(
      { runId, type: 'agent_owner_unclaimed', status: 'pending' },
      { $set: { status: 'credited', creditedAt: new Date(), updatedAt: new Date() } }
    );
  }

  /**
   * Find a standard ledger entry by runId (excludes agent_owner_unclaimed entries).
   * @param {string} runId
   * @returns {Promise<SplitLedgerEntry|null>}
   */
  async findByRunId(runId) {
    return this.findOne({ runId, type: { $exists: false } });
  }

  /**
   * Store the castId on a ledger entry after spell dispatch succeeds.
   * @param {string} runId
   * @param {string} castId
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async setCastId(runId, castId) {
    return this.updateOne(
      { runId, type: { $exists: false } },
      { $set: { castId, updatedAt: new Date() } }
    );
  }

  /**
   * Find all ledger entries for a partner, sorted by most recent.
   * @param {string} partnerId
   * @param {number} limit
   * @returns {Promise<SplitLedgerEntry[]>}
   */
  async findByPartnerId(partnerId, limit = 50) {
    return this.findMany({ partnerId }, { sort: { createdAt: -1 }, limit });
  }

  /**
   * Sum all credited partnerAmount values for a partner.
   * Uses BaseDB.aggregate() which routes through dbQueue.
   * @param {string} partnerId
   * @returns {Promise<number>} Total credited amount in USDC base units
   */
  async partnerTotal(partnerId) {
    const result = await this.aggregate([
      { $match: { partnerId, status: 'credited' } },
      { $group: { _id: null, total: { $sum: { $toInt: '$partnerAmount' } } } },
    ]);
    return result.length > 0 ? result[0].total : 0;
  }
}

module.exports = SplitLedgerDB;
