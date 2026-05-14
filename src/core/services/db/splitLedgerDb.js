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

class SplitLedgerDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
  }

  /**
   * Ensure indexes exist for this collection.
   * - runId: unique (one credit entry per run)
   * - partnerId + status + createdAt: partner ledger queries + pagination
   * - status: background settlement queries
   */
  async ensureIndexes() {
    await dbQueue.enqueue(async () => {
      const client = await getCachedClient();
      const col = client.db(this.dbName).collection(this.collectionName);
      await col.createIndexes([
        { key: { runId: 1 }, unique: true, name: 'runId_unique_idx' },
        { key: { partnerId: 1, status: 1, createdAt: -1 }, name: 'partnerId_status_createdAt_idx', background: true },
        { key: { status: 1 }, name: 'status_idx', background: true },
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
