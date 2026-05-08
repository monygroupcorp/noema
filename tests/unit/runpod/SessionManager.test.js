'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const Session = require('../../../src/core/services/runpod/Session');
const SessionManager = require('../../../src/core/services/runpod/SessionManager');

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeSession(overrides = {}) {
    const terminated = [];
    const saved = [];
    const service = { terminateInstance: async (id) => terminated.push(id) };
    const ssh = { close: async () => {} };
    const session = new Session({
        accountId: overrides.accountId || 'mau-1',
        deploymentHash: overrides.deploymentHash || 'sha256:aaaa',
        podId: overrides.podId || 'pod-1',
        ssh, service, logger: silent,
    });
    return { session, terminated, saved };
}

function makeStore() {
    const saves = [];
    const deletes = [];
    return {
        saves,
        deletes,
        async save(session) { saves.push(session.sessionId); },
        async delete(id) { deletes.push(id); },
    };
}

describe('SessionManager — in-memory', () => {
    test('getSession returns null when empty', async () => {
        const mgr = new SessionManager({ logger: silent });
        assert.strictEqual(mgr.getSession('mau-1', 'sha256:aaaa'), null);
        await mgr.destroyAll();
    });

    test('registerSession + getSession round-trip', async () => {
        const mgr = new SessionManager({ logger: silent });
        const { session } = makeSession();
        mgr.registerSession(session);
        assert.strictEqual(mgr.getSession('mau-1', 'sha256:aaaa'), session);
        await mgr.destroyAll();
    });

    test('getSession returns null on hash mismatch and terminates pod', async () => {
        const mgr = new SessionManager({ logger: silent });
        const { session, terminated } = makeSession({ deploymentHash: 'sha256:aaaa' });
        mgr.registerSession(session);
        assert.strictEqual(mgr.getSession('mau-1', 'sha256:bbbb'), null);
        await new Promise(r => setImmediate(r));
        assert.ok(terminated.includes('pod-1'));
        await mgr.destroyAll();
    });

    test('idle sweep evicts sessions past idleTimeoutMs', async () => {
        const mgr = new SessionManager({ idleTimeoutMs: 50, logger: silent });
        const { session, terminated } = makeSession();
        mgr.registerSession(session);
        await new Promise(r => setTimeout(r, 120));
        mgr._sweep();
        assert.ok(terminated.length > 0, 'pod should be terminated');
        assert.strictEqual(mgr.activeCount, 0);
        await mgr.destroyAll();
    });

    test('evictSession by sessionId terminates the pod', async () => {
        const mgr = new SessionManager({ logger: silent });
        const { session, terminated } = makeSession({ podId: 'pod-evict' });
        mgr.registerSession(session);
        mgr.evictSession(session.sessionId);
        await new Promise(r => setImmediate(r));
        assert.ok(terminated.includes('pod-evict'));
        await mgr.destroyAll();
    });

    test('second registerSession for same account evicts the first', async () => {
        const mgr = new SessionManager({ logger: silent });
        const { session: s1, terminated: t1 } = makeSession({ podId: 'pod-A', accountId: 'mau-2' });
        const { session: s2 } = makeSession({ podId: 'pod-B', accountId: 'mau-2', deploymentHash: 'sha256:bbbb' });
        mgr.registerSession(s1);
        mgr.registerSession(s2);
        await new Promise(r => setImmediate(r));
        assert.ok(t1.includes('pod-A'));
        assert.strictEqual(mgr.getSession('mau-2', 'sha256:bbbb'), s2);
        await mgr.destroyAll();
    });
});

describe('SessionManager — persistence hooks', () => {
    test('registerSession calls sessionStore.save', async () => {
        const store = makeStore();
        const mgr = new SessionManager({ logger: silent, sessionStore: store });
        const { session } = makeSession();
        mgr.registerSession(session);
        await new Promise(r => setImmediate(r));
        assert.ok(store.saves.includes(session.sessionId), 'save should be called with session.sessionId');
        await mgr.destroyAll();
    });

    test('evictSession calls sessionStore.delete', async () => {
        const store = makeStore();
        const mgr = new SessionManager({ logger: silent, sessionStore: store });
        const { session } = makeSession({ podId: 'pod-del' });
        mgr.registerSession(session);
        mgr.evictSession(session.sessionId);
        await new Promise(r => setImmediate(r));
        assert.ok(store.deletes.includes(session.sessionId), 'delete should be called with session.sessionId');
        await mgr.destroyAll();
    });

    test('hash-mismatch eviction calls sessionStore.delete', async () => {
        const store = makeStore();
        const mgr = new SessionManager({ logger: silent, sessionStore: store });
        const { session } = makeSession({ deploymentHash: 'sha256:aaaa' });
        mgr.registerSession(session);
        mgr.getSession('mau-1', 'sha256:changed');
        await new Promise(r => setImmediate(r));
        assert.ok(store.deletes.includes(session.sessionId));
        await mgr.destroyAll();
    });

    test('store errors do not propagate to caller', async () => {
        const brokenStore = {
            async save() { throw new Error('DB exploded'); },
            async delete() { throw new Error('DB exploded'); },
        };
        const mgr = new SessionManager({ logger: silent, sessionStore: brokenStore });
        const { session } = makeSession();
        // neither of these should throw
        assert.doesNotThrow(() => mgr.registerSession(session));
        assert.doesNotThrow(() => mgr.evictSession(session.sessionId));
        await mgr.destroyAll();
    });
});
