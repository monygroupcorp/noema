/**
 * Spell Composition test suite
 *
 * Tests the "spells of spells" feature end-to-end using the Node.js built-in
 * test runner and pure in-process mocks — no DB or network required.
 *
 * Coverage:
 *   1.  SpellService — createSubCast() / appendGenerationIds()
 *   2.  StepExecutor — spell-call step routing + guards
 *   3.  StepContinuator — _finalizeSubCast()
 *   4.  Integration — full parent → sub-spell → parent continuation chain
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');

const { SpellService } = require('../../../src/core/services/store/spells/SpellService');
const StepExecutor = require('../../../src/core/services/workflow/execution/StepExecutor');
const StepContinuator = require('../../../src/core/services/workflow/continuation/StepContinuator');

// ─── Shared IDs ───────────────────────────────────────────────────────────────

const IDS = {
  parentCast:   '649d000000000000000000a1',
  subCast:      '649d000000000000000000a2',
  syntheticGen: '649d000000000000000000a3',
  subGen1:      '649d000000000000000000a4',
  parentSpell:  '649d000000000000000000b1',
  subSpell:     '649d000000000000000000b2',
  account:      '649d000000000000000000c1',
};

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeParentSpell(overrides = {}) {
  return {
    _id: new ObjectId(IDS.parentSpell),
    slug: 'parent-spell',
    name: 'Parent Spell',
    steps: [
      {
        id: 'step-0',
        stepId: 'step-0',
        toolIdentifier: 'primitive-tool',
        parameterMappings: {},
        outputMappings: {},
      },
      {
        id: 'step-1',
        stepId: 'step-1',
        spellRef: 'sub-spell',
        toolIdentifier: 'sub-spell', // display name, ignored for routing
        parameterMappings: {
          subInput: { type: 'nodeOutput', nodeId: 'step-0', outputKey: 'text' },
        },
        outputMappings: { finalImage: 'output_image' },
      },
    ],
    exposedInputs: [],
    ...overrides,
  };
}

function makeSubSpell(overrides = {}) {
  return {
    _id: new ObjectId(IDS.subSpell),
    slug: 'sub-spell',
    name: 'Sub Spell',
    steps: [
      {
        id: 'sub-step-0',
        stepId: 'sub-step-0',
        toolIdentifier: 'image-tool',
        parameterMappings: { input_prompt: { type: 'static', value: 'default' } },
        outputMappings: {},
      },
    ],
    exposedInputs: [{ nodeId: 'sub-step-0', paramKey: 'subInput' }],
    ...overrides,
  };
}

function makeOriginalContext(overrides = {}) {
  return {
    masterAccountId: IDS.account,
    platform: 'telegram',
    parameterOverrides: {},
    castId: IDS.parentCast,
    telegramContext: { chatId: 'chat-1', messageId: 'msg-1', userId: 'user-1' },
    ...overrides,
  };
}

function makeCastsDb(stored = {}) {
  const updates = [];
  const creates = [];
  return {
    findOne: async () => stored.cast || null,
    createCast: async (p) => { creates.push(p); return { _id: new ObjectId(IDS.subCast), ...p }; },
    updateOne: async (q, u) => { updates.push({ q, u }); },
    _updates: updates,
    _creates: creates,
  };
}

// ─── 1. SpellService new methods ──────────────────────────────────────────────

describe('SpellService — createSubCast / appendGenerationIds', () => {

  test('createSubCast stores isSubCast + parent refs in metadata', async () => {
    const db = makeCastsDb();
    const svc = new SpellService({ castsDb: db });

    const result = await svc.createSubCast({
      spellId: IDS.subSpell,
      initiatorAccountId: IDS.account,
      parentCastId: IDS.parentCast,
      syntheticGenId: IDS.syntheticGen,
    });

    assert.equal(db._creates.length, 1);
    const created = db._creates[0];
    assert.equal(created.spellId, IDS.subSpell);
    assert.equal(created.metadata.isSubCast, true);
    assert.equal(created.metadata.parentCastId, IDS.parentCast);
    assert.equal(created.metadata.syntheticGenId, IDS.syntheticGen);
    assert.ok(result._id, 'should return doc with _id');
  });

  test('createSubCast throws without spellId', async () => {
    const svc = new SpellService({ castsDb: makeCastsDb() });
    await assert.rejects(() => svc.createSubCast({ initiatorAccountId: IDS.account }));
  });

  test('appendGenerationIds uses $addToSet $each', async () => {
    const db = makeCastsDb();
    const svc = new SpellService({ castsDb: db });

    await svc.appendGenerationIds(IDS.parentCast, [IDS.subGen1]);

    assert.equal(db._updates.length, 1);
    const update = db._updates[0].u;
    assert.ok(update.$addToSet, '$addToSet required');
    assert.ok(Array.isArray(update.$addToSet.stepGenerationIds.$each), '$each should be array');
    assert.equal(update.$addToSet.stepGenerationIds.$each.length, 1);
    assert.ok(update.$addToSet.stepGenerationIds.$each[0] instanceof ObjectId);
  });

  test('appendGenerationIds is no-op for empty array', async () => {
    const db = makeCastsDb();
    const svc = new SpellService({ castsDb: db });

    await svc.appendGenerationIds(IDS.parentCast, []);

    assert.equal(db._updates.length, 0, 'should not issue any DB update');
  });

  test('appendGenerationIds is idempotent across multiple calls', async () => {
    const db = makeCastsDb();
    const svc = new SpellService({ castsDb: db });

    await svc.appendGenerationIds(IDS.parentCast, [IDS.subGen1]);
    await svc.appendGenerationIds(IDS.parentCast, [IDS.subGen1]);

    assert.equal(db._updates.length, 2, 'two separate updates');
    // Both use $addToSet — idempotency is enforced by MongoDB, not the application layer
    for (const { u } of db._updates) {
      assert.ok(u.$addToSet.stepGenerationIds.$each, '$each present on both');
    }
  });
});

// ─── 2. StepExecutor — spell-call step routing ────────────────────────────────

describe('StepExecutor — spell-call step routing', () => {

  function makeStepExecutor({ spellsDbFindBySlug, castManagerCreateSubCast, createGenRecord, executeStepOverride } = {}) {
    const genRecords = [];
    const subCasts = [];
    const dispatchedSteps = [];

    const executor = new StepExecutor({
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      toolRegistry: { findByDisplayName: () => null, getToolById: () => null },
      workflowsService: { prepareToolRunPayload: async () => ({ inputs: {}, loraResolutionData: null }) },
      internalApiClient: null,
      adapterRegistry: { get: () => null },
      generationRecordManager: {
        createGenerationRecord: async (p) => {
          if (createGenRecord) return createGenRecord(p);
          const id = new ObjectId().toString();
          genRecords.push({ id, params: p });
          return { generationId: id };
        },
      },
      adapterCoordinator: null,
      workflowNotifier: null,
      spellsDb: {
        findBySlug: async (slug) => spellsDbFindBySlug ? spellsDbFindBySlug(slug) : null,
      },
      castManager: {
        createSubCast: async (p) => {
          if (castManagerCreateSubCast) return castManagerCreateSubCast(p);
          subCasts.push(p);
          return { _id: new ObjectId(IDS.subCast) };
        },
      },
    });

    // Override recursive executeStep to capture dispatch without real execution
    if (executeStepOverride !== false) {
      const original = executor.executeStep.bind(executor);
      executor.executeStep = async function (spell, stepIndex, pipelineCtx, origCtx) {
        // If this is a spell-call step, let it route through _executeSpellCallStep normally
        // For all other recursive calls (sub-spell step 0), capture and stop
        const step = spell?.steps?.[stepIndex];
        if (step && !step.spellRef) {
          dispatchedSteps.push({ spell, stepIndex, pipelineCtx, origCtx });
          return { status: 'processing' };
        }
        return original(spell, stepIndex, pipelineCtx, origCtx);
      };
    }

    return { executor, genRecords, subCasts, dispatchedSteps };
  }

  test('routes to _executeSpellCallStep when step.spellRef is set', async () => {
    const { executor, dispatchedSteps } = makeStepExecutor({
      spellsDbFindBySlug: async () => makeSubSpell(),
    });

    const parentSpell = makeParentSpell();
    const origCtx = makeOriginalContext();
    const pipelineCtx = { castId: IDS.parentCast, 'step-0_text': 'hello world' };

    const result = await executor.executeStep(parentSpell, 1, pipelineCtx, origCtx);

    assert.equal(result.status, 'processing');
    assert.ok(result.syntheticGenId, 'syntheticGenId returned');
    // Sub-spell step 0 was dispatched
    assert.equal(dispatchedSteps.length, 1);
    assert.equal(dispatchedSteps[0].stepIndex, 0);
    assert.equal(dispatchedSteps[0].spell.slug, 'sub-spell');
  });

  test('throws SPELL_NOT_FOUND when sub-spell does not exist', async () => {
    const { executor } = makeStepExecutor({ spellsDbFindBySlug: async () => null });

    const spell = makeParentSpell();
    const err = await assert.rejects(
      () => executor.executeStep(spell, 1, { castId: IDS.parentCast }, makeOriginalContext()),
      (e) => { assert.equal(e.code, 'SPELL_NOT_FOUND'); return true; }
    );
  });

  test('throws CIRCULAR_SPELL_REF when sub-spell slug is already active', async () => {
    const { executor } = makeStepExecutor({ spellsDbFindBySlug: async () => makeSubSpell() });

    const spell = makeParentSpell();
    const origCtx = makeOriginalContext({ activeSpellSlugs: ['sub-spell'] });

    await assert.rejects(
      () => executor.executeStep(spell, 1, { castId: IDS.parentCast }, origCtx),
      (e) => { assert.equal(e.code, 'CIRCULAR_SPELL_REF'); return true; }
    );
  });

  test('throws MAX_DEPTH_EXCEEDED when nesting is too deep', async () => {
    const { executor } = makeStepExecutor({ spellsDbFindBySlug: async () => makeSubSpell() });

    const spell = makeParentSpell();
    const origCtx = makeOriginalContext({
      activeSpellSlugs: ['spell-a', 'spell-b', 'spell-c', 'spell-d', 'spell-e'],
    });

    await assert.rejects(
      () => executor.executeStep(spell, 1, { castId: IDS.parentCast }, origCtx),
      (e) => { assert.equal(e.code, 'MAX_DEPTH_EXCEEDED'); return true; }
    );
  });

  test('sub-spell slug is added to activeSpellSlugs in sub-context', async () => {
    const { executor, dispatchedSteps } = makeStepExecutor({
      spellsDbFindBySlug: async () => makeSubSpell(),
    });

    const origCtx = makeOriginalContext({ activeSpellSlugs: ['parent-spell'] });
    await executor.executeStep(makeParentSpell(), 1, { castId: IDS.parentCast }, origCtx);

    const subCtx = dispatchedSteps[0].origCtx;
    assert.ok(subCtx.activeSpellSlugs.includes('sub-spell'), 'sub-spell added to activeSet');
    assert.ok(subCtx.activeSpellSlugs.includes('parent-spell'), 'parent still present');
  });

  test('sub-context carries isSubSpell, parentCastId, syntheticGenId', async () => {
    const { executor, dispatchedSteps } = makeStepExecutor({
      spellsDbFindBySlug: async () => makeSubSpell(),
    });

    await executor.executeStep(makeParentSpell(), 1, { castId: IDS.parentCast }, makeOriginalContext());

    const subCtx = dispatchedSteps[0].origCtx;
    assert.equal(subCtx.isSubSpell, true);
    assert.equal(subCtx.parentCastId, IDS.parentCast);
    assert.ok(subCtx.syntheticGenId, 'syntheticGenId present in sub-context');
  });

  test('synthetic gen metadata carries parent spell and step index', async () => {
    const capturedParams = [];
    const { executor } = makeStepExecutor({
      spellsDbFindBySlug: async () => makeSubSpell(),
      createGenRecord: async (p) => {
        capturedParams.push(p);
        return { generationId: new ObjectId().toString() };
      },
    });

    const parentSpell = makeParentSpell();
    await executor.executeStep(parentSpell, 1, { castId: IDS.parentCast }, makeOriginalContext());

    assert.equal(capturedParams.length, 1);
    const meta = capturedParams[0].metadata;
    assert.equal(meta.isSubSpellBoundary, true);
    assert.equal(meta.spell.slug, 'parent-spell', 'parent spell in metadata');
    assert.equal(meta.stepIndex, 1, 'parent step index in metadata');
    assert.equal(meta.castId, IDS.parentCast, 'parent castId in metadata');
    assert.equal(meta.subSpellSlug, 'sub-spell');
    assert.deepEqual(meta.subSpellOutputMappings, { finalImage: 'output_image' });
  });

  test('sub-spell inputs are resolved from pipelineContext via parameterMappings', async () => {
    const { executor, dispatchedSteps } = makeStepExecutor({
      spellsDbFindBySlug: async () => makeSubSpell(),
    });

    // pipelineContext has step-0 output keyed as nodeId_outputKey
    const pipelineCtx = { castId: IDS.parentCast, 'step-0_text': 'resolved prompt text' };
    await executor.executeStep(makeParentSpell(), 1, pipelineCtx, makeOriginalContext());

    // Sub-spell should receive resolved input
    const subPipelineCtx = dispatchedSteps[0].pipelineCtx;
    assert.equal(subPipelineCtx.subInput, 'resolved prompt text', 'nodeOutput resolved correctly');
  });

  test('missing spellsDb throws a clear error', async () => {
    const executor = new StepExecutor({
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      toolRegistry: { findByDisplayName: () => null, getToolById: () => null },
      workflowsService: {},
      internalApiClient: null,
      adapterRegistry: { get: () => null },
      generationRecordManager: { createGenerationRecord: async () => ({ generationId: 'x' }) },
      adapterCoordinator: null,
      workflowNotifier: null,
      // spellsDb deliberately omitted
      castManager: { createSubCast: async () => ({ _id: new ObjectId() }) },
    });

    const spell = makeParentSpell();
    await assert.rejects(
      () => executor.executeStep(spell, 1, { castId: IDS.parentCast }, makeOriginalContext()),
      /spellsDb required/
    );
  });
});

// ─── 3. StepContinuator — _finalizeSubCast ────────────────────────────────────

describe('StepContinuator — _finalizeSubCast', () => {

  function makeContinuator({ syntheticGenStored, emitted = [] } = {}) {
    const appended = [];
    const updated = [];

    const castManager = {
      appendGenerationIds: async (parentCastId, ids) => { appended.push({ parentCastId, ids }); },
    };

    const generationRecordManager = {
      getGenerationRecord: async (id) => syntheticGenStored || {
        _id: id,
        metadata: { subSpellOutputMappings: { finalImage: 'output_image' } },
      },
      updateGenerationRecord: async (id, payload) => { updated.push({ id, payload }); },
    };

    // Capture notificationEvents.emit by monkey-patching the module
    const notificationEvents = require('../../../src/core/events/notificationEvents');
    const originalEmit = notificationEvents.emit.bind(notificationEvents);
    notificationEvents.emit = (event, data) => {
      emitted.push({ event, data });
      return true;
    };

    const continuator = new StepContinuator({
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      castManager,
      generationRecordManager,
      costAggregator: { aggregateCosts: async () => ({ totalCostUsd: 0, totalPointsSpent: 0 }) },
      stepExecutor: null,
    });

    return { continuator, appended, updated, emitted, restore: () => { notificationEvents.emit = originalEmit; } };
  }

  test('appends sub-cast gen IDs to parent cast', async () => {
    const { continuator, appended, restore } = makeContinuator();
    try {
      const origCtx = { isSubSpell: true, syntheticGenId: IDS.syntheticGen, parentCastId: IDS.parentCast };
      const completedGen = { outputs: { finalImage: 'https://img.example.com/1.png' }, text: null, result: null };

      await continuator._finalizeSubCast(IDS.subCast, [IDS.subGen1], completedGen, origCtx);

      assert.equal(appended.length, 1);
      assert.equal(appended[0].parentCastId, IDS.parentCast);
      assert.deepEqual(appended[0].ids, [IDS.subGen1]);
    } finally { restore(); }
  });

  test('applies explicit output mappings from syntheticGen metadata', async () => {
    const { continuator, updated, restore } = makeContinuator({
      syntheticGenStored: {
        _id: IDS.syntheticGen,
        metadata: { subSpellOutputMappings: { finalImage: 'output_image' } },
      },
    });
    try {
      const origCtx = { isSubSpell: true, syntheticGenId: IDS.syntheticGen, parentCastId: IDS.parentCast };
      const completedGen = { outputs: { finalImage: 'https://img.example.com/1.png', extra: 'ignored' }, text: null, result: null };

      await continuator._finalizeSubCast(IDS.subCast, [IDS.subGen1], completedGen, origCtx);

      const updatePayload = updated[0].payload;
      assert.equal(updatePayload.status, 'completed');
      assert.equal(updatePayload.outputs.output_image, 'https://img.example.com/1.png', 'key remapped');
      assert.equal(updatePayload.outputs.extra, undefined, 'unmapped key excluded');
    } finally { restore(); }
  });

  test('passes through all outputs when no explicit mappings defined', async () => {
    const { continuator, updated, restore } = makeContinuator({
      syntheticGenStored: { _id: IDS.syntheticGen, metadata: { subSpellOutputMappings: {} } },
    });
    try {
      const origCtx = { isSubSpell: true, syntheticGenId: IDS.syntheticGen, parentCastId: IDS.parentCast };
      const completedGen = { outputs: { imageUrl: 'https://img.example.com/2.png', text: 'caption' }, text: null, result: null };

      await continuator._finalizeSubCast(IDS.subCast, [IDS.subGen1], completedGen, origCtx);

      const out = updated[0].payload.outputs;
      assert.equal(out.imageUrl, 'https://img.example.com/2.png');
      assert.equal(out.text, 'caption');
    } finally { restore(); }
  });

  test('resolves synthetic gen to completed', async () => {
    const { continuator, updated, restore } = makeContinuator();
    try {
      const origCtx = { isSubSpell: true, syntheticGenId: IDS.syntheticGen, parentCastId: IDS.parentCast };
      await continuator._finalizeSubCast(IDS.subCast, [IDS.subGen1], { outputs: {}, text: 'hi', result: null }, origCtx);

      assert.equal(updated.length, 1);
      assert.equal(updated[0].id, IDS.syntheticGen);
      assert.equal(updated[0].payload.status, 'completed');
    } finally { restore(); }
  });

  test('emits generationUpdated event after resolving synthetic gen', async () => {
    const emitted = [];
    const { continuator, restore } = makeContinuator({ emitted });
    try {
      const origCtx = { isSubSpell: true, syntheticGenId: IDS.syntheticGen, parentCastId: IDS.parentCast };
      await continuator._finalizeSubCast(IDS.subCast, [IDS.subGen1], { outputs: {}, text: null, result: null }, origCtx);

      const genUpdated = emitted.filter(e => e.event === 'generationUpdated');
      assert.equal(genUpdated.length, 1, 'generationUpdated emitted once');
    } finally { restore(); }
  });

  test('skips appendGenerationIds when parentCastId is absent', async () => {
    const { continuator, appended, restore } = makeContinuator();
    try {
      const origCtx = { isSubSpell: true, syntheticGenId: IDS.syntheticGen, parentCastId: null };
      await continuator._finalizeSubCast(IDS.subCast, [IDS.subGen1], { outputs: {}, text: null, result: null }, origCtx);

      assert.equal(appended.length, 0, 'no append when no parent cast');
    } finally { restore(); }
  });
});

// ─── 4. Integration — full parent → sub-spell → parent chain ─────────────────

describe('Integration — parent spell suspended and resumed via sub-spell', () => {

  test('parent spell continues after sub-spell finalises', async () => {
    const parentSpell = makeParentSpell();
    const subSpell = makeSubSpell();

    // Track which executeStep calls happen
    const dispatched = [];

    // Synthetic gen returned after _finalizeSubCast resolves it
    let syntheticGenRecord = null;

    const genStore = new Map();

    const generationRecordManager = {
      createGenerationRecord: async (p) => {
        const id = new ObjectId().toString();
        const record = { _id: id, ...p };
        genStore.set(id, record);
        if (p.metadata?.isSubSpellBoundary) syntheticGenRecord = record;
        return { generationId: id };
      },
      getGenerationRecord: async (id) => genStore.get(id) || null,
      updateGenerationRecord: async (id, payload) => {
        const existing = genStore.get(id) || {};
        genStore.set(id, { ...existing, ...payload });
      },
    };

    const castManager = {
      appendGenerationIds: async () => {},
      getCast: async () => ({ status: 'running', stepGenerationIds: [] }),
      checkForDuplicateGeneration: async () => ({ alreadyProcessed: false, nextStepAlreadyExecuted: false }),
      checkCastStatus: async () => false,
      finalizeCast: async () => {},
      updateCastWithGeneration: async () => {},
      updateCastStatusToFailed: async () => {},
      createSubCast: async () => ({ _id: new ObjectId(IDS.subCast) }),
    };

    const notificationEvents = require('../../../src/core/events/notificationEvents');
    const emitted = [];
    const originalEmit = notificationEvents.emit.bind(notificationEvents);
    notificationEvents.emit = (event, data) => { emitted.push({ event, data }); return true; };

    try {
      // Build StepContinuator with a StepExecutor whose executeStep we intercept
      const stepExecutor = new StepExecutor({
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        toolRegistry: { findByDisplayName: () => null, getToolById: () => null },
        workflowsService: { prepareToolRunPayload: async () => ({ inputs: {}, loraResolutionData: null }) },
        internalApiClient: null,
        adapterRegistry: { get: () => null },
        generationRecordManager,
        adapterCoordinator: null,
        workflowNotifier: null,
        spellsDb: { findBySlug: async (slug) => slug === 'sub-spell' ? subSpell : null },
        castManager,
      });

      // Intercept primitive-tool steps (not spellRef steps — those need real routing)
      const originalExecuteStep = stepExecutor.executeStep.bind(stepExecutor);
      stepExecutor.executeStep = async function (spell, stepIndex, pCtx, oCtx) {
        const step = spell?.steps?.[stepIndex];
        if (step && !step.spellRef) {
          dispatched.push({ spell: spell.slug, stepIndex, pCtx, oCtx });
          return { status: 'processing' };
        }
        return originalExecuteStep(spell, stepIndex, pCtx, oCtx);
      };

      const continuator = new StepContinuator({
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        castManager,
        generationRecordManager,
        costAggregator: { aggregateCosts: async () => ({ totalCostUsd: 0.001, totalPointsSpent: 5 }) },
        stepExecutor,
      });

      // ── Phase 1: parent spell step 0 (regular tool) completes ─────────────
      // StepContinuator.continue() processes it and dispatches step 1 (the spell-call step)

      const parentStep0Gen = {
        _id: new ObjectId().toString(),
        status: 'completed',
        outputs: { text: 'generated text from step 0' },
        responsePayload: { text: 'generated text from step 0' },
        text: 'generated text from step 0',
        result: null,
        costUsd: 0.001,
        metadata: {
          isSpell: true,
          spell: parentSpell,
          stepIndex: 0,
          castId: IDS.parentCast,
          pipelineContext: { castId: IDS.parentCast },
          originalContext: makeOriginalContext(),
          notificationContext: { type: 'spell_step_completion', stepIndex: 0 },
          stepGenerationIds: [],
        },
      };

      await continuator.continue(parentStep0Gen);

      // Step 1 (spellRef) should have been dispatched → synthetic gen created
      assert.ok(syntheticGenRecord, 'synthetic gen record was created');
      assert.equal(syntheticGenRecord.metadata.isSubSpellBoundary, true);
      assert.equal(syntheticGenRecord.metadata.spell.slug, 'parent-spell');
      assert.equal(syntheticGenRecord.metadata.stepIndex, 1);

      // Sub-spell step 0 was dispatched (intercepted)
      const subDispatches = dispatched.filter(d => d.spell === 'sub-spell');
      assert.equal(subDispatches.length, 1, 'sub-spell step 0 dispatched once');
      assert.equal(subDispatches[0].oCtx.isSubSpell, true);
      assert.equal(subDispatches[0].oCtx.parentCastId, IDS.parentCast);

      // ── Phase 2: sub-spell last step completes ────────────────────────────
      // This triggers _finalizeSubCast → resolves synthetic gen → emits generationUpdated

      const subStep0Gen = {
        _id: new ObjectId().toString(),
        status: 'completed',
        outputs: { finalImage: 'https://img.example.com/out.png' },
        responsePayload: { finalImage: 'https://img.example.com/out.png' },
        text: null,
        result: null,
        costUsd: 0,
        metadata: {
          isSpell: true,
          spell: subSpell,
          stepIndex: 0,
          castId: IDS.subCast,
          pipelineContext: { castId: IDS.subCast },
          originalContext: {
            ...makeOriginalContext(),
            isSubSpell: true,
            syntheticGenId: syntheticGenRecord._id,
            parentCastId: IDS.parentCast,
            castId: IDS.subCast,
          },
          notificationContext: {},
          stepGenerationIds: [],
        },
      };

      await continuator.continue(subStep0Gen);

      // Synthetic gen should now be 'completed'
      const resolvedSyntheticGen = genStore.get(syntheticGenRecord._id);
      assert.equal(resolvedSyntheticGen.status, 'completed', 'synthetic gen resolved to completed');
      assert.ok(resolvedSyntheticGen.outputs, 'outputs present on resolved synthetic gen');

      // generationUpdated should have been emitted to wake parent continuation
      const wakeEvent = emitted.find(e => e.event === 'generationUpdated');
      assert.ok(wakeEvent, 'generationUpdated emitted after sub-spell finalization');

      // ── Phase 3: parent spell continues from synthetic gen ────────────────
      // Simulate what continueExecution does when it receives the resolved synthetic gen

      const resolvedGen = genStore.get(syntheticGenRecord._id);
      await continuator.continue(resolvedGen);

      // Parent spell step 2 doesn't exist → spell should finalize
      // (makeParentSpell has 2 steps; step 1 was the spellRef; so after step 1 completes, it's the last step)
      const spellCompletion = emitted.find(e => e.event === 'spellCompletion');
      assert.ok(spellCompletion, 'parent spell emitted spellCompletion after sub-spell resolved');

    } finally {
      notificationEvents.emit = originalEmit;
    }
  });
});
