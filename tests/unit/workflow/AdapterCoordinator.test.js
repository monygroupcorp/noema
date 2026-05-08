'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const AdapterCoordinator = require('../../../src/core/services/workflow/adapters/AdapterCoordinator');

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// --- helpers ---

const fractalTool = {
    toolId: 'runmake',
    service: 'runpod',
    spec: { imageId: 'runpod/pytorch', workflowTemplate: 'flux-schnell' },
};
const legacyTool = { toolId: 'dall-e', service: 'openai' };

function makeGenMgr() {
    const updates = [];
    return {
        updates,
        async createGenerationRecord() { return { generationId: new ObjectId() }; },
        async updateGenerationRecord(id, payload) { updates.push({ id, payload }); },
    };
}

function makePoller() {
    const calls = [];
    return { calls, async startPolling(...args) { calls.push(args); } };
}

function makeRegistry(startJobResult) {
    return {
        get: () => ({
            startJob: async () => (typeof startJobResult === 'function' ? startJobResult() : startJobResult),
        }),
    };
}

function makeContext(accountId = new ObjectId().toString()) {
    return {
        spell: { _id: 'spell1', toObject() { return {}; } },
        stepIndex: 0,
        pipelineContext: {},
        originalContext: {
            masterAccountId: accountId,
            platform: 'telegram',
            castId: 'cast1',
        },
    };
}

// Save and restore env vars around each test
const ENV_KEYS = ['NOEMAPLANE_COMPILER_ENABLED', 'NOEMAPLANE_COMPILER_TOOLS', 'NOEMAPLANE_COMPILER_ALLOWLIST'];
let savedEnv = {};

beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

// --- feature flag gate ---

describe('AdapterCoordinator — feature flag gate', () => {
    test('fractal tool without flag enabled throws a clear error', async () => {
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'r1', isNewSession: false }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
        });
        await assert.rejects(
            () => coordinator.executeWithAdapter(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }),
            /not enabled/i
        );
    });

    test('fractal tool with NOEMAPLANE_COMPILER_ENABLED=1 succeeds', async () => {
        process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
        let captured;
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: {
                get: () => ({
                    startJob: async (args) => { captured = args; return { runId: 'r2', isNewSession: false }; },
                }),
            },
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
        });
        await coordinator.executeWithAdapter(fractalTool, { prompt: 'cat' }, makeContext(), { eventId: new ObjectId().toString() });
        assert.ok(captured?.tool, 'fractal path should pass { tool } to startJob');
        assert.ok(captured?.accountContext, 'fractal path should pass accountContext');
    });

    test('fractal tool enabled for specific account via allowlist', async () => {
        const accountId = new ObjectId().toString();
        process.env.NOEMAPLANE_COMPILER_TOOLS = 'runmake';
        process.env.NOEMAPLANE_COMPILER_ALLOWLIST = accountId;
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'r3', isNewSession: false }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
        });
        await assert.doesNotReject(
            () => coordinator.executeWithAdapter(fractalTool, {}, makeContext(accountId), { eventId: new ObjectId().toString() })
        );
    });

    test('legacy tool bypasses flag check regardless of env', async () => {
        // No env vars set — flag is off
        let captured;
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: {
                get: () => ({
                    startJob: async (args) => { captured = args; return { runId: 'r4' }; },
                }),
            },
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
        });
        await assert.doesNotReject(
            () => coordinator.executeWithAdapter(legacyTool, { size: '1024x1024' }, makeContext(), { eventId: new ObjectId().toString() })
        );
        assert.ok(!captured?.tool, 'legacy path must NOT pass { tool } to startJob');
    });
});

// --- cold-start notifications ---

describe('AdapterCoordinator — cold-start notifications', () => {
    test('cold start sends ❄️ liveStatus via workflowNotifier', async () => {
        process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
        const notifications = [];
        const notifier = {
            async notifyStepProgress(ctx, genId, tool, opts) { notifications.push(opts); },
        };
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'cold-run', isNewSession: true }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
            workflowNotifier: notifier,
        });
        await coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null);
        assert.strictEqual(notifications.length, 1);
        assert.ok(notifications[0].liveStatus.includes('❄️'));
        assert.ok(notifications[0].progress < 0.2, 'cold start should have low progress value');
    });

    test('warm start sends ⚡ liveStatus via workflowNotifier', async () => {
        process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
        const notifications = [];
        const notifier = {
            async notifyStepProgress(ctx, genId, tool, opts) { notifications.push(opts); },
        };
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'warm-run', isNewSession: false }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
            workflowNotifier: notifier,
        });
        await coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null);
        assert.strictEqual(notifications.length, 1);
        assert.ok(notifications[0].liveStatus.includes('⚡'));
    });

    test('notifier failure does not abort job creation', async () => {
        process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
        const brokenNotifier = {
            async notifyStepProgress() { throw new Error('ws died'); },
        };
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'r5', isNewSession: true }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
            workflowNotifier: brokenNotifier,
        });
        await assert.doesNotReject(
            () => coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null)
        );
    });

    test('omitting workflowNotifier is safe', async () => {
        process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'r6', isNewSession: true }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: makePoller(),
        });
        await assert.doesNotReject(
            () => coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null)
        );
    });
});

// --- polling is started ---

describe('AdapterCoordinator — polling wiring', () => {
    test('createAsyncJob starts polling with the generation id and run id', async () => {
        process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
        const poller = makePoller();
        const coordinator = new AdapterCoordinator({
            logger: silent,
            adapterRegistry: makeRegistry({ runId: 'poll-run', isNewSession: false }),
            generationRecordManager: makeGenMgr(),
            asyncJobPoller: poller,
        });
        const result = await coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null);
        assert.ok(result.generationId);
        assert.strictEqual(result.runId, 'poll-run');
        assert.strictEqual(result.status, 'processing');
        assert.strictEqual(poller.calls.length, 1);
        assert.strictEqual(poller.calls[0][1], 'poll-run'); // runId passed to poller
    });
});
