'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const AsyncJobPoller = require('../../../src/core/services/workflow/adapters/AsyncJobPoller');

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeGenMgr() {
    const updates = [];
    return { updates, async updateGenerationRecord(id, payload) { updates.push({ id, payload }); } };
}

function makeAdapter(responses) {
    let call = 0;
    const calls = [];
    return {
        calls,
        async pollJob(runId) {
            const res = responses[call] ?? responses[responses.length - 1];
            calls.push({ call, runId, res });
            call++;
            return res;
        },
    };
}

describe('AsyncJobPoller', () => {
    test('completes on first succeeded poll', async () => {
        const genMgr = makeGenMgr();
        const adapter = makeAdapter([{ status: 'succeeded', type: 'files', data: { outputs: [] } }]);
        const poller = new AsyncJobPoller({ logger: silent, generationRecordManager: genMgr });

        await poller.startPolling('gen-1', 'run-1', adapter, { maxAttempts: 5, pollInterval: 10 });
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(adapter.calls.length, 1, 'should poll exactly once before completing');
        assert.strictEqual(genMgr.updates.length, 1);
        assert.strictEqual(genMgr.updates[0].payload.status, 'completed');
    });

    test('attempts counter increments once per poll — no double-increment', async () => {
        // If the double-increment bug were present, maxAttempts=4 with processing responses
        // would effectively allow only 2 polls before timing out.
        // With the fix, we should get 4 actual poll calls before timeout.
        const genMgr = makeGenMgr();
        const adapter = makeAdapter([{ status: 'processing', type: 'files', data: null }]);
        const poller = new AsyncJobPoller({ logger: silent, generationRecordManager: genMgr });

        await poller.startPolling('gen-2', 'run-2', adapter, { maxAttempts: 4, pollInterval: 10 });
        await new Promise(r => setTimeout(r, 200));

        assert.strictEqual(adapter.calls.length, 4, `expected 4 poll calls, got ${adapter.calls.length}`);
        assert.strictEqual(genMgr.updates[0]?.payload.status, 'failed', 'should mark failed on timeout');
    });

    test('failed poll result marks generation as failed', async () => {
        const genMgr = makeGenMgr();
        const adapter = makeAdapter([{ status: 'failed', type: 'files', data: null }]);
        const poller = new AsyncJobPoller({ logger: silent, generationRecordManager: genMgr });

        await poller.startPolling('gen-3', 'run-3', adapter, { maxAttempts: 5, pollInterval: 10 });
        await new Promise(r => setTimeout(r, 50));

        assert.strictEqual(genMgr.updates[0]?.payload.status, 'failed');
    });

    test('normalizeOutput is applied to the final data', async () => {
        const genMgr = makeGenMgr();
        const adapter = makeAdapter([{
            status: 'succeeded', type: 'text', data: { text: 'raw' },
        }]);
        const normalize = ({ data }) => ({ text: [data.text.toUpperCase()] });
        const poller = new AsyncJobPoller({ logger: silent, generationRecordManager: genMgr });

        await poller.startPolling('gen-4', 'run-4', adapter, { maxAttempts: 5, pollInterval: 10, normalizeOutput: normalize });
        await new Promise(r => setTimeout(r, 50));

        const saved = genMgr.updates[0]?.payload.responsePayload?.[0]?.data;
        assert.deepStrictEqual(saved, { text: ['RAW'] });
    });

    test('adapter throwing causes generation to be marked failed', async () => {
        const genMgr = makeGenMgr();
        const brokenAdapter = { async pollJob() { throw new Error('network gone'); } };
        const poller = new AsyncJobPoller({ logger: silent, generationRecordManager: genMgr });

        await poller.startPolling('gen-5', 'run-5', brokenAdapter, { maxAttempts: 5, pollInterval: 10 });
        await new Promise(r => setTimeout(r, 50));

        assert.ok(genMgr.updates[0]?.payload.status === 'failed');
        assert.ok(genMgr.updates[0]?.payload.deliveryError?.includes('network gone'));
    });
});
