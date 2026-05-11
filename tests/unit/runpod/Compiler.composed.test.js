'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const Compiler = require('../../../src/core/services/runpod/Compiler');
const { CompilerError } = Compiler;
const WorkflowTemplateRegistry = require('../../../src/core/services/runpod/WorkflowTemplateRegistry');
const { hashToolVersion } = require('../../../src/core/services/runpod/deploymentHash');
const makeTool = require('../../../src/core/tools/definitions/make');
const runmakeTool = require('../../../src/core/tools/definitions/runmake');

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const ctx = { masterAccountId: 'mau-1' };

// ── helpers ──────────────────────────────────────────────────────────────────

function makeToolVersionsDb(tools = []) {
    const store = new Map();
    for (const t of tools) {
        store.set(`${t.toolId}@${t.version}`, t);
    }
    return {
        async findByRef({ toolId, version }) {
            return store.get(`${toolId}@${version}`) ?? null;
        },
        async findByContentHash(hash) {
            for (const t of store.values()) {
                if (t.contentHash === hash) return t;
            }
            return null;
        },
    };
}

function makeCompiler(toolVersionsDb) {
    const registry = new WorkflowTemplateRegistry({ logger: silent });
    return new Compiler({
        workflowTemplates: registry,
        toolVersionsDb,
        logger: silent,
        randomSeed: () => 42,
    });
}

// Seed the runmake tool with its computed contentHash so DB lookups work
function runmakeWithHash() {
    return { ...runmakeTool, contentHash: hashToolVersion(runmakeTool) };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('Compiler — composed Tool compilation', () => {
    test('compiles a single-step composed tool into one deployment', async () => {
        const runmake = runmakeWithHash();
        const db = makeToolVersionsDb([runmake]);
        const compiler = makeCompiler(db);

        const deployments = await compiler.compile({
            tool: makeTool,
            inputs: { prompt: 'a cat', input_seed: 100 },
            accountContext: ctx,
        });

        assert.ok(Array.isArray(deployments), 'should return array');
        assert.strictEqual(deployments.length, 1, 'one deployment from one atomic step');
        assert.ok(deployments[0].hash.startsWith('sha256:'), 'hash should be sha256');
        assert.strictEqual(deployments[0].parentStep, 'gen', 'parentStep should be set');
        assert.strictEqual(deployments[0].spec.seed, 100, 'seed should propagate through');
    });

    test('exposedInput bindings pass outer inputs to child', async () => {
        const runmake = runmakeWithHash();
        const db = makeToolVersionsDb([runmake]);
        const compiler = makeCompiler(db);

        const [d] = await compiler.compile({
            tool: makeTool,
            inputs: { prompt: 'test prompt', input_seed: 77, width: 768 },
            accountContext: ctx,
        });

        const node22 = d.spec.workflow.comfyApiPayload['22'];
        assert.ok(node22, 'node 22 should exist');
        assert.strictEqual(node22.inputs.clip_l, 'test prompt', 'prompt should flow into clip_l');
    });

    test('static bindings use the literal value', async () => {
        const db = makeToolVersionsDb([runmakeWithHash()]);
        const compiler = makeCompiler(db);

        const toolWithStatic = {
            ...makeTool,
            composedSteps: [{
                ...makeTool.composedSteps[0],
                inputBindings: {
                    prompt: { kind: 'exposedInput', key: 'prompt' },
                    input_seed: { kind: 'static', value: 999 },
                },
            }],
        };

        const [d] = await compiler.compile({
            tool: toolWithStatic,
            inputs: { prompt: 'a dog' },
            accountContext: ctx,
        });

        assert.strictEqual(d.spec.seed, 999, 'static binding should set seed=999');
    });

    test('stepOutput bindings are skipped at compile time (unknown until runtime)', async () => {
        const db = makeToolVersionsDb([runmakeWithHash()]);
        const compiler = makeCompiler(db);

        const toolWithStepOutput = {
            ...makeTool,
            composedSteps: [{
                ...makeTool.composedSteps[0],
                inputBindings: {
                    prompt: { kind: 'exposedInput', key: 'prompt' },
                    width: { kind: 'stepOutput', stepId: 'prior', outputKey: 'width' },
                },
            }],
        };

        // Should not throw — stepOutput bindings are silently omitted
        const deployments = await compiler.compile({
            tool: toolWithStepOutput,
            inputs: { prompt: 'a cat', input_seed: 42 },
            accountContext: ctx,
        });
        assert.ok(deployments.length > 0, 'should produce deployments despite stepOutput binding');
    });

    test('expression bindings throw EXPRESSION_NOT_SUPPORTED', async () => {
        const db = makeToolVersionsDb([runmakeWithHash()]);
        const compiler = makeCompiler(db);

        const toolWithExpr = {
            ...makeTool,
            composedSteps: [{
                ...makeTool.composedSteps[0],
                inputBindings: {
                    prompt: { kind: 'expression', expr: 'prompt.toUpperCase()' },
                },
            }],
        };

        await assert.rejects(
            () => compiler.compile({ tool: toolWithExpr, inputs: { prompt: 'hi' }, accountContext: ctx }),
            (err) => {
                assert.ok(err instanceof CompilerError, 'should be CompilerError');
                assert.strictEqual(err.code, 'EXPRESSION_NOT_SUPPORTED');
                return true;
            }
        );
    });

    test('child tool not found in toolVersionsDb throws CHILD_TOOL_NOT_FOUND', async () => {
        const db = makeToolVersionsDb([]); // empty — no tools registered
        const compiler = makeCompiler(db);

        await assert.rejects(
            () => compiler.compile({ tool: makeTool, inputs: { prompt: 'hi' }, accountContext: ctx }),
            (err) => {
                assert.ok(err instanceof CompilerError);
                assert.strictEqual(err.code, 'CHILD_TOOL_NOT_FOUND');
                return true;
            }
        );
    });

    test('Merkle hash mismatch throws HASH_MISMATCH', async () => {
        const runmake = runmakeWithHash();
        const db = makeToolVersionsDb([runmake]);
        const compiler = makeCompiler(db);

        const tampered = {
            ...makeTool,
            composedSteps: [{
                ...makeTool.composedSteps[0],
                childToolRef: {
                    ...makeTool.composedSteps[0].childToolRef,
                    contentHash: 'sha256:' + 'f'.repeat(64), // wrong hash
                },
            }],
        };

        await assert.rejects(
            () => compiler.compile({ tool: tampered, inputs: { prompt: 'hi' }, accountContext: ctx }),
            (err) => {
                assert.ok(err instanceof CompilerError);
                assert.strictEqual(err.code, 'HASH_MISMATCH');
                return true;
            }
        );
    });

    test('cycle detection throws CYCLE_DETECTED', async () => {
        // Build a tool A whose only step references itself (A → A)
        const cycleHash = 'sha256:' + 'a'.repeat(64);
        const cycleTool = {
            toolId: 'cycle-tool',
            version: '1.0.0',
            service: null,
            spec: null,
            contentHash: cycleHash,
            inputSchema: {},
            outputSchema: {},
            composedSteps: [{
                ordine: 0,
                stepId: 'self',
                childToolRef: { toolId: 'cycle-tool', version: '1.0.0', contentHash: cycleHash },
                inputBindings: {},
            }],
            exposedInputs: [],
            exposedOutputs: [],
        };

        const db = makeToolVersionsDb([cycleTool]);
        const compiler = makeCompiler(db);

        await assert.rejects(
            () => compiler.compile({ tool: cycleTool, inputs: {}, accountContext: ctx }),
            (err) => {
                assert.ok(err instanceof CompilerError);
                assert.strictEqual(err.code, 'CYCLE_DETECTED');
                return true;
            }
        );
    });

    test('missing toolVersionsDb throws NO_TOOL_VERSIONS_DB', async () => {
        const compiler = makeCompiler(null); // no DB

        await assert.rejects(
            () => compiler.compile({ tool: makeTool, inputs: { prompt: 'hi' }, accountContext: ctx }),
            (err) => {
                assert.ok(err instanceof CompilerError);
                assert.strictEqual(err.code, 'NO_TOOL_VERSIONS_DB');
                return true;
            }
        );
    });

    test('steps are compiled in ordine order', async () => {
        // Two steps: ordine 1 first in array, ordine 0 second — should execute ordine 0 first
        const runmake = runmakeWithHash();
        const runmakeHash = runmake.contentHash;
        const db = makeToolVersionsDb([runmake]);
        const compiler = makeCompiler(db);

        const toolWithTwoSteps = {
            ...makeTool,
            composedSteps: [
                {
                    ordine: 1,
                    stepId: 'second',
                    childToolRef: { toolId: 'runmake', version: '2.0.0', contentHash: runmakeHash },
                    inputBindings: { prompt: { kind: 'static', value: 'second prompt' } },
                },
                {
                    ordine: 0,
                    stepId: 'first',
                    childToolRef: { toolId: 'runmake', version: '2.0.0', contentHash: runmakeHash },
                    inputBindings: { prompt: { kind: 'static', value: 'first prompt' } },
                },
            ],
        };

        const deployments = await compiler.compile({
            tool: toolWithTwoSteps,
            inputs: {},
            accountContext: ctx,
        });

        assert.strictEqual(deployments.length, 2);
        assert.strictEqual(deployments[0].parentStep, 'first', 'ordine 0 should come first');
        assert.strictEqual(deployments[1].parentStep, 'second', 'ordine 1 should come second');
    });

    test('hashToolVersion is deterministic for runmake', () => {
        const h1 = hashToolVersion(runmakeTool);
        const h2 = hashToolVersion(runmakeTool);
        assert.strictEqual(h1, h2, 'hashToolVersion must be deterministic');
        assert.ok(h1.startsWith('sha256:'), 'should be sha256 prefixed');
    });

    test('makeTool childToolRef.contentHash matches live runmake hash', () => {
        const liveHash = hashToolVersion(runmakeTool);
        const pinned = makeTool.composedSteps[0].childToolRef.contentHash;
        assert.strictEqual(pinned, liveHash,
            'make.js Merkle pin must match the current runmake.js definition');
    });
});
