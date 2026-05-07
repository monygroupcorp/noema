'use strict';

const Session = require('./Session');

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — break-even vs cold-start cost
const SWEEP_INTERVAL_MS = 60 * 1000;             // check every minute

/**
 * SessionManager — in-memory registry of live RunPod sessions.
 *
 * One session per account. If a new session is registered for an account
 * that already has one with a different deploymentHash, the old session is
 * evicted and its pod terminated.
 *
 * Idle sessions (no job within idleTimeoutMs) are evicted by a periodic sweep.
 *
 * Phase 1: in-memory only; sessions are lost on process restart.
 * Phase 2+: persist to DB so restarts can reclaim live pods.
 */
class SessionManager {
  constructor({ idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, logger = console } = {}) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.logger = logger;
    /** @type {Map<string, Session>} accountId → Session */
    this._sessions = new Map();
    this._sweepInterval = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS).unref();
  }

  /**
   * Returns the active session for an account if it exists and matches the
   * deploymentHash. Returns null if no session, session is dead, or hash mismatch
   * (which means the tool/models changed — caller should register a new session).
   */
  getSession(accountId, deploymentHash) {
    const session = this._sessions.get(accountId);
    if (!session) return null;
    if (session.status === 'dead') { this._sessions.delete(accountId); return null; }
    if (session.deploymentHash !== deploymentHash) {
      this.logger.info(`[SessionManager] deploymentHash changed for ${accountId} — evicting old session`);
      this._evict(session);
      return null;
    }
    return session;
  }

  /**
   * Register a newly-provisioned session. Evicts any existing session for
   * the same account first.
   */
  registerSession(session) {
    if (!(session instanceof Session)) throw new Error('registerSession requires a Session instance');
    const existing = this._sessions.get(session.accountId);
    if (existing && existing.sessionId !== session.sessionId) {
      this._evict(existing);
    }
    this._sessions.set(session.accountId, session);
    this.logger.info(`[SessionManager] registered session=${session.sessionId} account=${session.accountId} pod=${session.podId} hash=${session.deploymentHash.slice(7, 19)}…`);
    return session;
  }

  /**
   * Evict a session immediately — terminates its pod.
   */
  evictSession(sessionId) {
    for (const [accountId, session] of this._sessions) {
      if (session.sessionId === sessionId) {
        this._evict(session);
        this._sessions.delete(accountId);
        return;
      }
    }
  }

  /**
   * Terminate all sessions — call on process shutdown.
   */
  async destroyAll() {
    clearInterval(this._sweepInterval);
    await Promise.all(
      Array.from(this._sessions.values()).map(s => this._evict(s))
    );
    this._sessions.clear();
  }

  get activeCount() { return this._sessions.size; }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _evict(session) {
    this.logger.info(`[SessionManager] evicting session=${session.sessionId} pod=${session.podId} idleMs=${session.idleMs()} jobs=${session.jobCount}`);
    return session.terminate();
  }

  _sweep() {
    const now = Date.now();
    for (const [accountId, session] of this._sessions) {
      if (session.status === 'dead') {
        this._sessions.delete(accountId);
        continue;
      }
      if (now - session.lastUsedAt > this.idleTimeoutMs) {
        this.logger.info(`[SessionManager] idle timeout for ${accountId} (${Math.round(session.idleMs() / 1000)}s idle)`);
        this._evict(session);
        this._sessions.delete(accountId);
      }
    }
  }
}

module.exports = SessionManager;

if (require.main === module) {
  (async () => {
    const failures = [];
    const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    function makeSession(overrides = {}) {
      const terminated = [];
      const service = { terminateInstance: async (id) => terminated.push(id) };
      const ssh = { close: async () => {} };
      return {
        session: new Session({
          accountId: overrides.accountId || 'mau-1',
          deploymentHash: overrides.deploymentHash || 'sha256:aaaa',
          podId: overrides.podId || 'pod-1',
          ssh, service, logger: silent,
        }),
        terminated,
      };
    }

    // A. getSession returns null when empty
    {
      const mgr = new SessionManager({ idleTimeoutMs: 500, logger: silent });
      if (mgr.getSession('mau-1', 'sha256:aaaa') !== null) failures.push('A: expected null on empty');
      await mgr.destroyAll();
    }

    // B. registerSession + getSession round-trip
    {
      const mgr = new SessionManager({ idleTimeoutMs: 500, logger: silent });
      const { session } = makeSession();
      mgr.registerSession(session);
      const got = mgr.getSession('mau-1', 'sha256:aaaa');
      if (got !== session) failures.push('B: getSession did not return registered session');
      await mgr.destroyAll();
    }

    // C. hash mismatch evicts old session
    {
      const mgr = new SessionManager({ idleTimeoutMs: 500, logger: silent });
      const { session, terminated } = makeSession({ deploymentHash: 'sha256:aaaa' });
      mgr.registerSession(session);
      const got = mgr.getSession('mau-1', 'sha256:bbbb');
      if (got !== null) failures.push('C: expected null on hash mismatch');
      // Give terminate a tick to fire
      await new Promise(r => setImmediate(r));
      if (!terminated.includes('pod-1')) failures.push('C: old pod not terminated on hash mismatch');
      await mgr.destroyAll();
    }

    // D. idle sweep evicts stale sessions
    {
      const mgr = new SessionManager({ idleTimeoutMs: 50, logger: silent });
      const { session, terminated } = makeSession();
      mgr.registerSession(session);
      await new Promise(r => setTimeout(r, 120)); // wait past idle timeout
      mgr._sweep(); // force sweep
      if (terminated.length === 0) failures.push('D: idle session not terminated after timeout');
      if (mgr.activeCount !== 0) failures.push(`D: activeCount should be 0, got ${mgr.activeCount}`);
      await mgr.destroyAll();
    }

    // E. evictSession by sessionId terminates pod
    {
      const mgr = new SessionManager({ idleTimeoutMs: 5000, logger: silent });
      const { session, terminated } = makeSession({ podId: 'pod-evict' });
      mgr.registerSession(session);
      mgr.evictSession(session.sessionId);
      await new Promise(r => setImmediate(r));
      if (!terminated.includes('pod-evict')) failures.push('E: evictSession did not terminate pod');
      await mgr.destroyAll();
    }

    // F. second registerSession for same account evicts first
    {
      const mgr = new SessionManager({ idleTimeoutMs: 5000, logger: silent });
      const { session: s1, terminated: t1 } = makeSession({ podId: 'pod-A', accountId: 'mau-2' });
      const { session: s2 } = makeSession({ podId: 'pod-B', accountId: 'mau-2', deploymentHash: 'sha256:bbbb' });
      mgr.registerSession(s1);
      mgr.registerSession(s2);
      await new Promise(r => setImmediate(r));
      if (!t1.includes('pod-A')) failures.push('F: first session not evicted on second registerSession');
      if (mgr.getSession('mau-2', 'sha256:bbbb') !== s2) failures.push('F: second session not reachable');
      await mgr.destroyAll();
    }

    if (failures.length) { console.error('FAIL:', failures.join('; ')); process.exit(1); }
    console.log('PASS: SessionManager');
    console.log('  A empty returns null');
    console.log('  B register + get round-trip');
    console.log('  C hash mismatch evicts old session');
    console.log('  D idle sweep terminates stale sessions');
    console.log('  E evictSession by sessionId');
    console.log('  F second register evicts first');
  })().catch(err => { console.error('FAIL:', err.stack); process.exit(1); });
}
