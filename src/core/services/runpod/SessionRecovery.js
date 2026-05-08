'use strict';

const Session = require('./Session');
const SshTransport = require('../remote/SshTransport');
const { getRunPodPodConfig } = require('../../../config/runpodPod');

/**
 * SessionRecovery — reconnects warm RunPod pods after a process restart.
 *
 * On startup, reads session records from the persistent store, probes each
 * pod for liveness (RunPod API status + SSH echo), and re-registers any
 * survivors back into the in-memory SessionManager.
 *
 * Design constraints:
 *   - Runs fire-and-forget in WorkflowExecutionService constructor so it
 *     never blocks startup. Early requests cold-start normally; recovered
 *     sessions become available once probing completes.
 *   - SSH probe is the same `exec('echo alive')` used by GenerationRunner.
 *   - Dead / unreachable pods are deleted from the store.
 *   - Sessions last used more than MAX_RECOVERY_AGE_MS ago are skipped —
 *     their idle-timeout would have fired anyway had the process stayed up.
 */

const MAX_RECOVERY_AGE_MS = 12 * 60 * 1000; // 12 min — slightly above the 10-min idle timeout
const SSH_PROBE_TIMEOUT_MS = 20 * 1000;

class SessionRecovery {
  constructor({ logger, config } = {}) {
    this.logger = logger || console;
    this.config = config || getRunPodPodConfig();
  }

  /**
   * Attempt to recover all persisted sessions.
   *
   * @param {import('./SessionManager')} sessionManager
   * @param {import('./RunPodPodService')} runPodPodService
   * @param {import('../db/runpodSessionsDb')} sessionStore
   * @returns {Promise<{ recovered: number, deleted: number, skipped: number }>}
   */
  async recover(sessionManager, runPodPodService, sessionStore) {
    const records = await sessionStore.findAll();
    if (!records.length) {
      this.logger.info('[SessionRecovery] No persisted sessions to recover.');
      return { recovered: 0, deleted: 0, skipped: 0 };
    }
    this.logger.info(`[SessionRecovery] Found ${records.length} persisted session(s). Probing…`);

    let recovered = 0, deleted = 0, skipped = 0;

    for (const record of records) {
      const sessionId = record._id;
      const ageMs = Date.now() - new Date(record.lastUsedAt).getTime();

      if (ageMs > MAX_RECOVERY_AGE_MS) {
        this.logger.info(`[SessionRecovery] Skipping stale session ${sessionId} (age=${Math.round(ageMs / 1000)}s > ${MAX_RECOVERY_AGE_MS / 1000}s)`);
        await sessionStore.delete(sessionId);
        deleted++;
        continue;
      }

      try {
        const status = await runPodPodService.getInstanceStatus(record.podId);

        if (status?.status !== 'running') {
          this.logger.info(`[SessionRecovery] Pod ${record.podId} is not running (status=${status?.status}) — deleting record`);
          await sessionStore.delete(sessionId);
          deleted++;
          continue;
        }

        const endpoint = runPodPodService.extractSshEndpoint(status);
        if (!endpoint.sshHost) {
          this.logger.warn(`[SessionRecovery] Pod ${record.podId} running but no public IP yet — skipping`);
          skipped++;
          continue;
        }

        const ssh = new SshTransport({
          host: endpoint.sshHost,
          port: endpoint.sshPort,
          username: endpoint.sshUser,
          privateKeyPath: this.config.sshKeyPath,
          logger: this.logger,
        });

        // Probe: if this throws, SSH is dead
        await Promise.race([
          ssh.exec('echo alive'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('SSH probe timeout')), SSH_PROBE_TIMEOUT_MS)),
        ]);

        const session = new Session({
          accountId: record.accountId,
          deploymentHash: record.deploymentHash,
          podId: record.podId,
          ssh,
          service: runPodPodService,
          hourlyUsd: record.hourlyUsd,
          gpuTypeId: record.gpuTypeId,
          cloudType: record.cloudType,
          logger: this.logger,
        });
        // Restore timing so idle-timeout sweep uses the original lastUsedAt
        session.createdAt = new Date(record.createdAt).getTime();
        session.lastUsedAt = new Date(record.lastUsedAt).getTime();
        session.jobCount = record.jobCount || 0;

        sessionManager.registerSession(session);
        this.logger.info(`[SessionRecovery] Recovered session=${sessionId} pod=${record.podId} account=${record.accountId}`);
        recovered++;
      } catch (err) {
        this.logger.warn(`[SessionRecovery] Failed to recover session ${sessionId} pod=${record.podId}: ${err.message} — deleting record`);
        await sessionStore.delete(sessionId);
        deleted++;
      }
    }

    this.logger.info(`[SessionRecovery] Complete — recovered=${recovered} deleted=${deleted} skipped=${skipped}`);
    return { recovered, deleted, skipped };
  }
}

module.exports = SessionRecovery;

if (require.main === module) {
  (async () => {
    const failures = [];
    const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    function makeSessionMgr() {
      const registered = [];
      return {
        sessions: registered,
        registerSession(s) { registered.push(s); },
      };
    }

    function makeStore(records) {
      const deleted = [];
      return {
        deleted,
        async findAll() { return records; },
        async delete(id) { deleted.push(id); },
      };
    }

    const now = Date.now();

    // A. Stale records (age > 12 min) are deleted, not recovered
    {
      const store = makeStore([{
        _id: 'sess-stale',
        accountId: 'acc1',
        deploymentHash: 'sha256:abc',
        podId: 'pod-stale',
        lastUsedAt: new Date(now - 15 * 60 * 1000),
        createdAt: new Date(now - 30 * 60 * 1000),
        jobCount: 2,
      }]);
      const mgr = makeSessionMgr();
      const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: '/fake/key' } });
      const result = await recovery.recover(mgr, {}, store);
      if (result.deleted !== 1) failures.push(`A: expected deleted=1, got ${result.deleted}`);
      if (store.deleted[0] !== 'sess-stale') failures.push('A: wrong record deleted');
      if (mgr.sessions.length !== 0) failures.push('A: should not have recovered stale session');
      console.log(`  A stale: deleted=${result.deleted} recovered=${result.recovered}`);
    }

    // B. Pod not running → deleted
    {
      const store = makeStore([{
        _id: 'sess-dead',
        accountId: 'acc2',
        deploymentHash: 'sha256:abc',
        podId: 'pod-dead',
        lastUsedAt: new Date(now - 1 * 60 * 1000),
        createdAt: new Date(now - 5 * 60 * 1000),
        jobCount: 1,
      }]);
      const mgr = makeSessionMgr();
      const fakePodService = {
        async getInstanceStatus() { return { status: 'exited' }; },
        extractSshEndpoint() { return { sshHost: null }; },
      };
      const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: '/fake/key' } });
      const result = await recovery.recover(mgr, fakePodService, store);
      if (result.deleted !== 1) failures.push(`B: expected deleted=1, got ${result.deleted}`);
      if (mgr.sessions.length !== 0) failures.push('B: should not recover dead pod');
      console.log(`  B dead-pod: deleted=${result.deleted} recovered=${result.recovered}`);
    }

    // C. SSH probe fails → deleted
    {
      const store = makeStore([{
        _id: 'sess-sshfail',
        accountId: 'acc3',
        deploymentHash: 'sha256:abc',
        podId: 'pod-sshfail',
        lastUsedAt: new Date(now - 2 * 60 * 1000),
        createdAt: new Date(now - 5 * 60 * 1000),
        jobCount: 3,
      }]);
      const mgr = makeSessionMgr();
      const fakePodService = {
        async getInstanceStatus() { return { status: 'running' }; },
        extractSshEndpoint() { return { sshHost: '1.2.3.4', sshPort: 22, sshUser: 'root' }; },
      };
      // Patch SshTransport used by recovery — we'll catch the "key not found" error, which is expected
      const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: '/nonexistent/key' } });
      const result = await recovery.recover(mgr, fakePodService, store);
      if (result.deleted !== 1) failures.push(`C: expected deleted=1, got ${result.deleted}`);
      if (mgr.sessions.length !== 0) failures.push('C: should not recover when SSH fails');
      console.log(`  C ssh-fail: deleted=${result.deleted} recovered=${result.recovered}`);
    }

    // D. Empty store → no-op
    {
      const store = makeStore([]);
      const mgr = makeSessionMgr();
      const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: '/fake/key' } });
      const result = await recovery.recover(mgr, {}, store);
      if (result.recovered !== 0 || result.deleted !== 0) failures.push(`D: empty store should be no-op, got ${JSON.stringify(result)}`);
      console.log(`  D empty: recovered=${result.recovered} deleted=${result.deleted}`);
    }

    if (failures.length) { console.error('FAIL:', failures.join('; ')); process.exit(1); }
    console.log('PASS: SessionRecovery');
  })().catch(err => { console.error('FAIL:', err.stack || err); process.exit(1); });
}
