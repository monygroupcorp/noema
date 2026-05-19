/**
 * Faucet Drips Database
 *
 * Records each treasury→agent point drip event from the agentFaucetWorker.
 * Each document captures the scoring inputs, amount dripped, and credit
 * ledger linkage for auditability and monthly cap enforcement.
 *
 * Status lifecycle: (no pending state) → 'credited' | 'failed' | 'skipped'
 */

const crypto = require('crypto');
const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

/**
 * @typedef {Object} ScoringInputs
 * @property {number} sessionRecencyDays - Days since sessionIssuedAt, capped at 30
 * @property {number} score              - Computed weight (float)
 */

/**
 * @typedef {Object} FaucetDripRecord
 * @property {string} faucetDripId       - 'drip_' + 8 hex chars
 * @property {string} treasuryId         - FK → treasuries
 * @property {string} agentAccountId     - FK → agentAccounts
 * @property {string} noemaAccountId     - Denormalized string (ObjectId string)
 * @property {number} amount             - Integer points dripped
 * @property {Date}   periodStart        - 30 days before periodEnd
 * @property {Date}   periodEnd          - Time of drip run
 * @property {ScoringInputs} scoringInputs
 * @property {string|null} creditLedgerEntryId - String ObjectId from creditLedger, or null
 * @property {'credited'|'failed'|'skipped'} status
 * @property {string|null} failureReason
 * @property {Date}   createdAt
 */

class FaucetDripsDB extends BaseDB {
  constructor(logger) {
    super('faucet_drips');
    this.logger = logger || console;
  }

  async ensureIndexes() {
    const client = await getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    await col.createIndexes([
      { key: { faucetDripId: 1 }, unique: true, name: 'faucetDripId_unique_idx' },
      { key: { agentAccountId: 1, periodEnd: -1 }, name: 'agentAccountId_periodEnd_idx', background: true },
      { key: { treasuryId: 1, periodEnd: -1 }, name: 'treasuryId_periodEnd_idx', background: true },
      { key: { status: 1, createdAt: -1 }, name: 'status_createdAt_idx', background: true },
    ]);
    this.logger.debug('[FaucetDripsDB] Indexes ensured.');
  }

  /**
   * Insert a new drip record. Generates a unique faucetDripId and stamps createdAt.
   * @param {Omit<FaucetDripRecord, 'faucetDripId'|'createdAt'>} record
   * @returns {Promise<{ faucetDripId: string, insertedId: import('mongodb').ObjectId }>}
   */
  async createDrip(record) {
    const faucetDripId = 'drip_' + crypto.randomBytes(4).toString('hex');
    const result = await this.insertOne({
      faucetDripId,
      ...record,
      createdAt: new Date(),
    });
    return { faucetDripId, insertedId: result.insertedId };
  }

  /**
   * Find credited drips for an agent since a given date.
   * Used for monthly cap enforcement.
   * @param {string} agentAccountId
   * @param {Date} since
   * @returns {Promise<FaucetDripRecord[]>}
   */
  async findByAgentAndPeriod(agentAccountId, since) {
    return this.findMany(
      { agentAccountId, periodEnd: { $gte: since }, status: 'credited' },
    );
  }

  /**
   * Find drips for a treasury, most recent first.
   * @param {string} treasuryId
   * @param {number} [limit=50]
   * @returns {Promise<FaucetDripRecord[]>}
   */
  async findByTreasuryId(treasuryId, limit = 50) {
    return this.findMany(
      { treasuryId },
      { sort: { createdAt: -1 }, limit },
    );
  }
}

module.exports = FaucetDripsDB;
