'use strict';

const { BaseDB } = require('./BaseDB');
const { getCachedClient } = require('./utils/queue');

const COLLECTION_NAME = 'runpodSessions';

/**
 * RunpodSessionsDB — persists warm RunPod session metadata.
 *
 * Documents use the Session.sessionId (random hex) as _id so that the
 * in-memory Session and the DB record share the same identifier.
 *
 * Fields stored per session:
 *   _id          — Session.sessionId (string)
 *   accountId    — masterAccountId string
 *   deploymentHash — Compiler.compile() hash; identifies the tool+model combo
 *   podId        — RunPod pod ID (used to re-establish SSH on recovery)
 *   hourlyUsd    — billing rate at provision time
 *   gpuTypeId    — GPU SKU
 *   cloudType    — 'SECURE' | 'COMMUNITY'
 *   createdAt    — ISO timestamp
 *   lastUsedAt   — ISO timestamp; updated on save so recovery can skip very stale records
 *   jobCount     — number of successful jobs run on this session
 */
class RunpodSessionsDB extends BaseDB {
  constructor(logger) {
    super(COLLECTION_NAME);
    this.logger = logger || console;
  }

  /**
   * Upsert a session record. Called by SessionManager.registerSession() and touch().
   * @param {import('../runpod/Session')} session
   */
  async save(session) {
    const doc = {
      _id: session.sessionId,
      accountId: session.accountId,
      deploymentHash: session.deploymentHash,
      podId: session.podId,
      hourlyUsd: session.hourlyUsd ?? null,
      gpuTypeId: session.gpuTypeId ?? null,
      cloudType: session.cloudType,
      createdAt: new Date(session.createdAt),
      lastUsedAt: new Date(session.lastUsedAt),
      jobCount: session.jobCount,
    };
    try {
      await this.updateOne(
        { _id: session.sessionId },
        { $set: doc },
        { upsert: true }
      );
    } catch (err) {
      this.logger.warn(`[RunpodSessionsDB] save failed for session ${session.sessionId}: ${err.message}`);
    }
  }

  /**
   * Delete a session record. Called when a session is evicted.
   * @param {string} sessionId
   */
  async delete(sessionId) {
    try {
      await this.deleteOne({ _id: sessionId });
    } catch (err) {
      this.logger.warn(`[RunpodSessionsDB] delete failed for session ${sessionId}: ${err.message}`);
    }
  }

  /**
   * Returns all stored session records. Used by SessionRecovery on startup.
   * @returns {Promise<Object[]>}
   */
  async findAll() {
    try {
      return await this.findMany({});
    } catch (err) {
      this.logger.warn(`[RunpodSessionsDB] findAll failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Remove sessions older than maxAgeMs (default 24 h).
   * Called during recovery to clean up orphaned records from crashed workers.
   * @param {number} [maxAgeMs]
   */
  /**
   * Create indexes idempotently. Called once on startup by services/index.js.
   * - accountId: primary lookup for warm-session reuse
   * - lastUsedAt: range scan for deleteStale / SessionRecovery age filter
   * - podId: unique constraint — each pod should map to at most one session
   */
  async ensureIndexes() {
    try {
      const client = await getCachedClient();
      const col = client.db(this.dbName).collection(this.collectionName);
      await col.createIndexes([
        { key: { accountId: 1 },    name: 'accountId',    background: true },
        { key: { lastUsedAt: 1 },   name: 'lastUsedAt',   background: true },
        { key: { podId: 1 },        name: 'podId_unique', unique: true, background: true },
      ]);
      this.logger.debug('[RunpodSessionsDB] Indexes ensured.');
    } catch (err) {
      this.logger.error('[RunpodSessionsDB] Failed to ensure indexes:', err.message);
    }
  }

  async deleteStale(maxAgeMs = 24 * 60 * 60 * 1000) {
    const cutoff = new Date(Date.now() - maxAgeMs);
    try {
      return await this.deleteMany({ lastUsedAt: { $lt: cutoff } });
    } catch (err) {
      this.logger.warn(`[RunpodSessionsDB] deleteStale failed: ${err.message}`);
    }
  }
}

module.exports = RunpodSessionsDB;
