'use strict';

const crypto = require('crypto');

/**
 * Session — a live RunPod pod kept warm across multiple jobs.
 *
 * Lifecycle:
 *   provisioning → ready → (busy ↔ idle) → dead
 *
 * The SessionManager owns the lifecycle; callers should not mutate
 * status directly. Call touch() after each successful job.
 */
class Session {
  constructor({
    accountId,
    deploymentHash,
    podId,
    ssh,
    service,
    hourlyUsd = null,
    gpuTypeId = null,
    cloudType = 'SECURE',
    logger = console,
  } = {}) {
    if (!accountId) throw new Error('Session requires accountId');
    if (!deploymentHash) throw new Error('Session requires deploymentHash');
    if (!podId) throw new Error('Session requires podId');
    if (!ssh) throw new Error('Session requires ssh');
    if (!service) throw new Error('Session requires service (RunPodPodService)');

    this.sessionId = crypto.randomBytes(8).toString('hex');
    this.accountId = accountId;
    this.deploymentHash = deploymentHash;
    this.podId = podId;
    this.ssh = ssh;
    this.service = service;
    this.hourlyUsd = hourlyUsd;
    this.gpuTypeId = gpuTypeId;
    this.cloudType = cloudType;
    this.logger = logger;

    this.status = 'ready';
    this.createdAt = Date.now();
    this.lastUsedAt = Date.now();
    this.jobCount = 0;
  }

  touch() {
    this.lastUsedAt = Date.now();
    this.jobCount += 1;
  }

  idleMs() {
    return Date.now() - this.lastUsedAt;
  }

  async terminate() {
    if (this.status === 'dead') return;
    this.status = 'dead';
    try {
      await this.service.terminateInstance(this.podId);
      this.logger.info(`[Session] ${this.sessionId} pod=${this.podId} terminated`);
    } catch (err) {
      this.logger.warn(`[Session] ${this.sessionId} terminate failed: ${err.message}`);
    }
    if (this.ssh && typeof this.ssh.close === 'function') {
      try { await this.ssh.close(); } catch (_) {}
    }
  }
}

module.exports = Session;
