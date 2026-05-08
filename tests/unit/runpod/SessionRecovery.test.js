'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const SessionRecovery = require('../../../src/core/services/runpod/SessionRecovery');
const SessionManager = require('../../../src/core/services/runpod/SessionManager');

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const FAKE_KEY = '/nonexistent/ssh-key'; // forces SshTransport constructor to throw → SSH fails

const now = Date.now();

function makeStore(records) {
    const deleted = [];
    return {
        deleted,
        async findAll() { return records; },
        async delete(id) { deleted.push(id); },
    };
}

function makeFakePodService({ running = true, sshHost = '1.2.3.4' } = {}) {
    return {
        async getInstanceStatus() {
            return { status: running ? 'running' : 'exited', publicIp: sshHost };
        },
        extractSshEndpoint() {
            return sshHost
                ? { sshHost, sshPort: 22, sshUser: 'root' }
                : { sshHost: null, sshPort: null, sshUser: null };
        },
    };
}

function makeSessionMgr() {
    const registered = [];
    return { registered, registerSession(s) { registered.push(s); } };
}

describe('SessionRecovery', () => {
    test('empty store is a no-op', async () => {
        const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: FAKE_KEY } });
        const result = await recovery.recover(makeSessionMgr(), {}, makeStore([]));
        assert.deepStrictEqual(result, { recovered: 0, deleted: 0, skipped: 0 });
    });

    test('stale records (age > 12 min) are deleted without probing', async () => {
        const store = makeStore([{
            _id: 'sess-stale',
            accountId: 'acc1',
            deploymentHash: 'sha256:abc',
            podId: 'pod-stale',
            lastUsedAt: new Date(now - 13 * 60 * 1000),
            createdAt: new Date(now - 30 * 60 * 1000),
            jobCount: 2,
        }]);
        const mgr = makeSessionMgr();
        const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: FAKE_KEY } });
        const result = await recovery.recover(mgr, {}, store);
        assert.strictEqual(result.deleted, 1);
        assert.strictEqual(result.recovered, 0);
        assert.ok(store.deleted.includes('sess-stale'));
        assert.strictEqual(mgr.registered.length, 0);
    });

    test('pod not running → record deleted', async () => {
        const store = makeStore([{
            _id: 'sess-dead',
            accountId: 'acc2',
            deploymentHash: 'sha256:abc',
            podId: 'pod-dead',
            lastUsedAt: new Date(now - 60 * 1000),
            createdAt: new Date(now - 5 * 60 * 1000),
            jobCount: 1,
        }]);
        const mgr = makeSessionMgr();
        const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: FAKE_KEY } });
        const result = await recovery.recover(mgr, makeFakePodService({ running: false }), store);
        assert.strictEqual(result.deleted, 1);
        assert.strictEqual(result.recovered, 0);
        assert.ok(store.deleted.includes('sess-dead'));
    });

    test('pod running but no public IP → skipped (not deleted)', async () => {
        const store = makeStore([{
            _id: 'sess-noip',
            accountId: 'acc3',
            deploymentHash: 'sha256:abc',
            podId: 'pod-noip',
            lastUsedAt: new Date(now - 60 * 1000),
            createdAt: new Date(now - 5 * 60 * 1000),
            jobCount: 0,
        }]);
        const mgr = makeSessionMgr();
        const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: FAKE_KEY } });
        const result = await recovery.recover(mgr, makeFakePodService({ running: true, sshHost: null }), store);
        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.deleted, 0);
        assert.strictEqual(result.recovered, 0);
        assert.strictEqual(store.deleted.length, 0);
    });

    test('SSH probe failure → record deleted', async () => {
        // FAKE_KEY doesn't exist → SshTransport constructor throws → recovery catches → deletes
        const store = makeStore([{
            _id: 'sess-sshfail',
            accountId: 'acc4',
            deploymentHash: 'sha256:abc',
            podId: 'pod-sshfail',
            lastUsedAt: new Date(now - 2 * 60 * 1000),
            createdAt: new Date(now - 5 * 60 * 1000),
            jobCount: 3,
        }]);
        const mgr = makeSessionMgr();
        const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: FAKE_KEY } });
        const result = await recovery.recover(mgr, makeFakePodService({ running: true }), store);
        assert.strictEqual(result.deleted, 1);
        assert.strictEqual(result.recovered, 0);
        assert.ok(store.deleted.includes('sess-sshfail'));
    });

    test('counts across mixed-result records are independent', async () => {
        const store = makeStore([
            // stale → deleted
            {
                _id: 'sess-stale2', accountId: 'acc5', deploymentHash: 'sha256:x', podId: 'p1',
                lastUsedAt: new Date(now - 20 * 60 * 1000), createdAt: new Date(now - 30 * 60 * 1000), jobCount: 0,
            },
            // dead pod → deleted
            {
                _id: 'sess-dead2', accountId: 'acc6', deploymentHash: 'sha256:y', podId: 'p2',
                lastUsedAt: new Date(now - 1 * 60 * 1000), createdAt: new Date(now - 5 * 60 * 1000), jobCount: 1,
            },
        ]);
        const mgr = makeSessionMgr();
        const recovery = new SessionRecovery({ logger: silent, config: { sshKeyPath: FAKE_KEY } });
        // Use a pod service that returns "exited" so both running checks fail for the second record
        const service = {
            async getInstanceStatus(podId) {
                return { status: podId === 'p2' ? 'exited' : 'running' };
            },
            extractSshEndpoint() { return { sshHost: '1.2.3.4', sshPort: 22, sshUser: 'root' }; },
        };
        const result = await recovery.recover(mgr, service, store);
        assert.strictEqual(result.deleted, 2);
        assert.strictEqual(result.recovered, 0);
    });
});
