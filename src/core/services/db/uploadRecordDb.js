/**
 * Upload Record Database
 *
 * Tracks presigned R2 upload records earmarked for partner spell runs.
 * Each record associates an uploadId with a partnerId, IP hash, and origin domain.
 * Records expire after 24 hours and can only be used once (status: pending → used).
 */

const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

const COLLECTION_NAME = 'upload_records';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * @typedef {Object} UploadRecord
 * @property {string} uploadId       - UUID for the presigned upload
 * @property {string} partnerId      - Partner who requested the upload
 * @property {string} originDomain   - Domain the request came from
 * @property {string} ipHash         - SHA-256 hash of the requester's IP
 * @property {string|null} usedInRunId - RunId that consumed this upload, or null
 * @property {'pending'|'used'|'expired'} status - Lifecycle state
 * @property {Date} presignedAt      - When the presigned URL was issued
 * @property {Date} expiresAt        - When this record expires (presignedAt + 24h)
 * @property {Date} createdAt
 */

class UploadRecordDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
  }

  /**
   * Ensure indexes exist for this collection.
   * - uploadId: unique (prevents double-use race)
   * - partnerId + createdAt: partner rate-limit queries
   * - status + expiresAt: expiry cleanup + pending lookup
   */
  async ensureIndexes() {
    const client = await getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    await col.createIndexes([
      { key: { uploadId: 1 }, unique: true, name: 'uploadId_unique_idx' },
      { key: { partnerId: 1, createdAt: -1 }, name: 'partnerId_createdAt_idx', background: true },
      { key: { status: 1, expiresAt: 1 }, name: 'status_expiresAt_idx', background: true },
    ]);
    this.logger.debug('[UploadRecordDB] Indexes ensured.');
  }

  /**
   * Create a new upload record with pending status and 24h TTL.
   * @param {{ uploadId: string, partnerId: string, originDomain: string, ipHash: string }} params
   * @returns {Promise<import('mongodb').InsertOneResult>}
   */
  async createUploadRecord({ uploadId, partnerId, originDomain, ipHash }) {
    const now = new Date();
    return this.insertOne({
      uploadId,
      partnerId,
      originDomain,
      ipHash,
      usedInRunId: null,
      status: 'pending',
      presignedAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS),
      createdAt: now,
    });
  }

  /**
   * Find an upload record by uploadId. Returns any non-expired record
   * (pending or used) so callers can inspect the current state.
   * @param {string} uploadId
   * @returns {Promise<UploadRecord|null>}
   */
  async findUploadRecord(uploadId) {
    return this.findOne({
      uploadId,
      expiresAt: { $gt: new Date() },
    });
  }

  /**
   * Mark a pending upload as used, linking it to a run.
   * @param {string} uploadId
   * @param {string} runId
   * @returns {Promise<import('mongodb').UpdateResult>}
   */
  async markUsed(uploadId, runId) {
    return this.updateOne(
      { uploadId, status: 'pending' },
      { $set: { status: 'used', usedInRunId: runId, updatedAt: new Date() } }
    );
  }

  /**
   * Count upload records created by a partner within a rolling time window.
   * Used for partner-level rate limiting.
   * @param {string} partnerId
   * @param {number} windowMs - Window size in milliseconds (default: 1 hour)
   * @returns {Promise<number>}
   */
  async countRecentByPartner(partnerId, windowMs = 60 * 60 * 1000) {
    const since = new Date(Date.now() - windowMs);
    const client = await require('./utils/queue').getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    return col.countDocuments({ partnerId, createdAt: { $gte: since } });
  }

  /**
   * Count uploads that have been used in runs for a partner within a rolling time window.
   * @param {string} partnerId
   * @param {number} windowMs - Window size in milliseconds (default: 1 hour)
   * @returns {Promise<number>}
   */
  async countRecentRunsByPartner(partnerId, windowMs = 60 * 60 * 1000) {
    const since = new Date(Date.now() - windowMs);
    const client = await require('./utils/queue').getCachedClient();
    const col = client.db(this.dbName).collection(this.collectionName);
    return col.countDocuments({ partnerId, status: 'used', updatedAt: { $gte: since } });
  }
}

module.exports = UploadRecordDB;
