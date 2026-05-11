'use strict';

const { ChainEngineBaseDB } = require('./ChainEngineBaseDB');
const { getCachedClient } = require('../utils/queue');

/**
 * ToolVersionsDB — immutable, content-addressed snapshots of Tool definitions.
 *
 * Primary key: contentHash (sha256:<hex>), computed by hashToolVersion().
 * Secondary unique index: (toolId, version) — one snapshot per version.
 *
 * Records are written once and never mutated. A new version of a tool
 * produces a new record with a new contentHash and a new version string.
 */
class ToolVersionsDB extends ChainEngineBaseDB {
  constructor(logger) {
    super('toolVersions');
    this.logger = logger || console;
  }

  /**
   * Upsert a tool version snapshot. Idempotent — same contentHash = no-op.
   * @param {Object} toolVersion
   */
  async save(toolVersion) {
    const doc = {
      _id: toolVersion.contentHash,
      toolId: toolVersion.toolId,
      version: toolVersion.version,
      contentHash: toolVersion.contentHash,
      inputSchema: toolVersion.inputSchema || {},
      outputSchema: toolVersion.outputSchema || {},
      service: toolVersion.service || null,
      spec: toolVersion.spec || null,
      composedSteps: toolVersion.composedSteps || [],
      exposedInputs: toolVersion.exposedInputs || [],
      exposedOutputs: toolVersion.exposedOutputs || [],
      status: toolVersion.status || 'published',
      draftedFrom: toolVersion.draftedFrom || null,
      createdAt: toolVersion.createdAt ? new Date(toolVersion.createdAt) : new Date(),
      publishedAt: toolVersion.publishedAt ? new Date(toolVersion.publishedAt) : null,
    };
    try {
      await this.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    } catch (err) {
      this.logger.warn(`[ToolVersionsDB] save failed for ${toolVersion.toolId}@${toolVersion.version}: ${err.message}`);
    }
  }

  /**
   * Look up a snapshot by its exact contentHash. This is the Merkle pin lookup —
   * used by the Compiler to verify that the child tool loaded matches the pin.
   * @param {string} contentHash
   * @returns {Promise<Object|null>}
   */
  async findByContentHash(contentHash) {
    try {
      return await this.findOne({ _id: contentHash });
    } catch (err) {
      this.logger.warn(`[ToolVersionsDB] findByContentHash failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Look up a snapshot by (toolId, version) pair.
   * Used when the caller has the version pin but needs the full record.
   * @param {{ toolId: string, version: string }} ref
   * @returns {Promise<Object|null>}
   */
  async findByRef({ toolId, version }) {
    try {
      return await this.findOne({ toolId, version });
    } catch (err) {
      this.logger.warn(`[ToolVersionsDB] findByRef failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Latest published snapshot for a given toolId (semver descending).
   * @param {string} toolId
   * @returns {Promise<Object|null>}
   */
  async findLatest(toolId) {
    try {
      const results = await this.findMany({ toolId, status: 'published' });
      if (!results.length) return null;
      results.sort((a, b) => (b.version > a.version ? 1 : -1));
      return results[0];
    } catch (err) {
      this.logger.warn(`[ToolVersionsDB] findLatest failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Create indexes idempotently. Called once on startup.
   * - (toolId, version): unique — one snapshot per version
   * - (toolId, status): fast listing of published versions
   */
  async ensureIndexes() {
    try {
      const client = await getCachedClient();
      const col = client.db(this.dbName).collection(this.collectionName);
      await col.createIndexes([
        { key: { toolId: 1, version: 1 }, name: 'toolId_version', unique: true, sparse: false, background: true },
        { key: { toolId: 1, status: 1 }, name: 'toolId_status', background: true },
      ]);
      this.logger.debug('[ToolVersionsDB] Indexes ensured.');
    } catch (err) {
      this.logger.error('[ToolVersionsDB] Failed to ensure indexes:', err.message);
    }
  }
}

module.exports = ToolVersionsDB;
