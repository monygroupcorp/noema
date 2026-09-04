import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExecuteFlow } from '../../../src/flow/flows/ExecuteFlow.js'
import type { ExecuteFlowDeps } from '../../../src/flow/flows/ExecuteFlow.js'
import type { FlowContext, PrimitiveEvent, Step, Resolution } from '../../../src/flow/types.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import { MODUS_DATASET_CAPTION, MODUS_DATASET_DECOMPOSE } from '../../../src/crystal/seeds/modi.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'mod-1', nomen: 'Test Tool', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc',
    aditus: {
      prompt: { type: 'text', required: true, description: 'The prompt' },
      seed: { type: 'int', required: false, description: 'Random seed' },
    },
    exitus: { url: { type: 'image' } },
    canonica: true, ministerium: 'runpod',
    natum: new Date(), mutatum: new Date(),
    ...overrides,
  }
}

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-1', modusId: 'mod-1', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: ['sig-1'], aditus: { prompt: 'test' },
    status: 'nascens', inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ExecuteFlowDeps> = {}): ExecuteFlowDeps {
  const modus = makeModus()
  return {
    modorum: {
      find: async () => modus,
      register: async () => {},
      update: async () => { throw new Error('not implemented') },
      list: async () => [
        makeModus({ id: 'mod-image-1', nomen: 'Flux Schnell' }),
        makeModus({ id: 'mod-image-2', nomen: 'Flux Dev' }),
        makeModus({ id: 'mod-sound-1', nomen: 'MusicGen' }),
      ],
    },
    signorum: {
      balance: async () => 10_000n,
      issue: async () => { throw new Error('not implemented') },
      lock: async () => {},
      release: async () => {},
      history: async () => [],
      settle: async () => {},
      sessionBudget: async () => { throw new Error('not implemented') },
      reserve: async () => { throw new Error('not implemented') },
      findByTestis: async () => { throw new Error('not implemented') },
      ownsAny: async () => { throw new Error('not implemented') },
      transfer: async () => { throw new Error('not implemented') },
      createMany: async () => { throw new Error('not implemented') },
    },
    actorum: {
      create: async (a) => ({ ...a, inceptum: new Date() }),
      update: async (id, patch) => ({ ...makeActum({ id }), ...patch }),
      findById: async (_id) => null,
      findByExternusJobId: async (_id) => null,
      findExpired: async () => [],
      findByCallbackNonce: async () => null,
      findByNullifier: async () => null,
      findInFlight: async () => [],
      findByCompositum: async () => [],
    },
    completor: {
      complete: async (actum, exitus) => ({
        ...actum,
        status: 'completus' as const,
        exitus: exitus.exitus,
        completum: new Date(),
        impetus: exitus.impetus,
      }),
      fail: async (actum, error) => ({
        ...actum,
        status: 'fractus' as const,
        error,
      }),
    },
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => ({ kind: 'sync' as const, exitus: { exitus: { url: 'https://example.com/img.png' }, impetus: 100n } }),
      }),
    },
    inceptor: {
      initiate: async () => makeActum(),
    },
    ...overrides,
  }
}

function makeCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    intent: 'execute',
    state: {},
    identity: { animaId: 'anima-1' },
    platform: 'telegram',
    platformUserId: 'user-1',
    platformChatId: 'chat-1',
    ...overrides,
  }
}

function assertStep(result: Step | Resolution): asserts result is Step {
  assert.ok('primitives' in result, `Expected Step, got Resolution: ${JSON.stringify(result)}`)
}

function assertResolution(result: Step | Resolution): asserts result is Resolution {
  assert.ok('kind' in result, `Expected Resolution, got Step`)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('enter with no prior state returns SELECT_MODE Select primitive', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  const step = await flow.enter(ctx)

  assert.equal(step.primitives.length, 1)
  const p = step.primitives[0]
  assert.equal(p.kind, 'Select')
  if (p.kind === 'Select') {
    assert.ok(p.options.some(o => o.id === 'create'))
    assert.ok(p.options.some(o => o.id === 'effect'))
  }
})

test('enter with modusId pre-set in state returns CONFIGURE Form primitive', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx({ state: { modusId: 'mod-1', step: 'CONFIGURE', aditus: {}, browsePageIndex: 0 } })
  const step = await flow.enter(ctx)

  assert.equal(step.primitives.length, 1)
  assert.equal(step.primitives[0].kind, 'Form')
})

test("SELECT_MODE + select 'create' returns SELECT_CATEGORY with create categories", async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)

  const result = await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  assertStep(result)

  assert.equal(result.primitives.length, 1)
  const p = result.primitives[0]
  assert.equal(p.kind, 'Select')
  if (p.kind === 'Select') {
    assert.ok(p.options.some(o => o.id === 'image'))
    assert.ok(p.options.some(o => o.id === 'sound'))
    assert.ok(p.options.some(o => o.id === 'text'))
    assert.ok(p.options.some(o => o.id === 'movie'))
  }
})

test("SELECT_MODE + select 'effect' returns SELECT_CATEGORY with effect categories", async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)

  const result = await flow.handle(ctx, { kind: 'select', selectedId: 'effect' })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Select')
  if (p.kind === 'Select') {
    assert.ok(p.options.some(o => o.id === 'image'))
    assert.ok(p.options.some(o => o.id === 'caption'))
    assert.ok(p.options.some(o => o.id === 'video'))
    assert.ok(p.options.some(o => o.id === 'sound'))
  }
})

test("SELECT_CATEGORY + select 'image' returns BROWSE_TOOLS Paginate", async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  const result = await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  assertStep(result)

  assert.equal(result.primitives[0].kind, 'Paginate')
})

test('BROWSE_TOOLS + paginate select returns CONFIGURE Form (required fields only)', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })

  const result = await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Form')
  if (p.kind === 'Form') {
    // Should have 'prompt' (required) field — 'seed' (optional) may or may not be included
    assert.ok(p.fields.some(f => f.key === 'prompt'))
    assert.ok(p.fields.some(f => f.required === true))
  }
})

test('BROWSE_TOOLS + paginate next increments page, re-emits Paginate', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })

  const result = await flow.handle(ctx, { kind: 'paginate', action: 'next' })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Paginate')
  if (p.kind === 'Paginate') {
    assert.ok(p.page >= 1, 'page should have incremented')
  }
})

test('BROWSE_TOOLS + paginate prev decrements page', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  // first go to page 1
  await flow.handle(ctx, { kind: 'paginate', action: 'next' })
  // now go back
  const result = await flow.handle(ctx, { kind: 'paginate', action: 'prev' })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Paginate')
  if (p.kind === 'Paginate') {
    assert.ok(p.page === 0, 'page should have decremented back to 0')
  }
})

test('CONFIGURE + form, balance sufficient, sync cursor returns RESULT Result primitive', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })

  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertStep(result)

  assert.equal(result.primitives[0].kind, 'Result')
})

test('CONFIGURE + form, balance sufficient, async cursor returns AWAITING_COMPLETION Stream with pendingActumId set', async () => {
  const deps = makeDeps({
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => ({ kind: 'async' as const, externusJobId: 'job-123' }),
      }),
    },
    actorum: {
      create: async (a) => ({ ...a, inceptum: new Date() }),
      update: async (id, patch) => ({ ...makeActum({ id }), ...patch, externusJobId: (patch as { externusJobId?: string }).externusJobId }),
      findById: async (_id) => null,
      findByExternusJobId: async (_id) => null,
      findExpired: async () => [],
      findByCallbackNonce: async () => null,
      findByNullifier: async () => null,
      findInFlight: async () => [],
      findByCompositum: async () => [],
    },
  })
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })

  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Stream')
  if (p.kind === 'Stream') {
    assert.equal(p.status, 'running')
  }
  assert.ok(ctx.pendingActumId, 'pendingActumId should be set on ctx')
})

test('CONFIGURE + form, balance insufficient returns Detail step with top-up actions', async () => {
  const deps = makeDeps({
    signorum: {
      balance: async () => 0n,  // zero balance
      issue: async () => { throw new Error('not implemented') },
      lock: async () => {},
      release: async () => {},
      history: async () => [],
      settle: async () => {},
      sessionBudget: async () => { throw new Error('not implemented') },
      reserve: async () => { throw new Error('not implemented') },
      findByTestis: async () => { throw new Error('not implemented') },
      ownsAny: async () => { throw new Error('not implemented') },
      transfer: async () => { throw new Error('not implemented') },
      createMany: async () => { throw new Error('not implemented') },
    },
  })
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })

  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Detail')
  if (p.kind === 'Detail') {
    assert.ok(p.label.includes('Insufficient') || p.label.includes('balance'), 'label should mention balance')
    const actionIds = p.actions.map(a => a.id)
    assert.ok(actionIds.includes('connect_wallet'), 'should have connect_wallet action')
    assert.ok(actionIds.includes('buy_credits'), 'should have buy_credits action')
    assert.ok(actionIds.includes('cancel'), 'should have cancel action')
  }
})

test('AWAITING_COMPLETION + prompt event returns empty step (no waiting banner)', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx({
    state: {
      step: 'AWAITING_COMPLETION',
      modusId: 'mod-1',
      aditus: { prompt: 'a cat' },
      actumId: 'actum-1',
      browsePageIndex: 0,
    },
    pendingActumId: 'actum-1',
  })

  const result = await flow.handle(ctx, { kind: 'prompt', text: 'unrelated' })
  assertStep(result)
  assert.deepEqual(result.primitives, [])
})

test('AWAITING_COMPLETION + action event still returns the Working… prompt', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx({
    state: {
      step: 'AWAITING_COMPLETION',
      modusId: 'mod-1',
      aditus: { prompt: 'a cat' },
      actumId: 'actum-1',
      browsePageIndex: 0,
    },
    pendingActumId: 'actum-1',
  })

  const result = await flow.handle(ctx, { kind: 'action', actionId: 'whatever' })
  assertStep(result)
  assert.equal(result.primitives.length, 1)
  assert.equal(result.primitives[0].kind, 'Prompt')
})

test('handleCompletion with complete result returns RESULT Result primitive', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx({
    state: {
      step: 'AWAITING_COMPLETION',
      modusId: 'mod-1',
      aditus: { prompt: 'a cat' },
      actumId: 'actum-1',
      browsePageIndex: 0,
    },
    pendingActumId: 'actum-1',
  })

  const result = await flow.handleCompletion(ctx, { kind: 'complete', exitus: { url: 'https://example.com/img.png' } })
  assertStep(result)

  assert.equal(result.primitives[0].kind, 'Result')
  assert.equal(ctx.pendingActumId, undefined, 'pendingActumId should be cleared')
})

test('handleCompletion with failed result returns error step or Resolution', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx({
    state: {
      step: 'AWAITING_COMPLETION',
      modusId: 'mod-1',
      aditus: { prompt: 'a cat' },
      actumId: 'actum-1',
      browsePageIndex: 0,
    },
    pendingActumId: 'actum-1',
  })

  const result = await flow.handleCompletion(ctx, { kind: 'failed', error: 'GPU OOM' })

  // Either a Step with error content or a complete Resolution
  assert.equal(ctx.pendingActumId, undefined, 'pendingActumId should be cleared')
  const isStep = 'primitives' in result
  const isRes = 'kind' in result && !isStep
  assert.ok(isStep || isRes, 'should return Step or Resolution')
})

test("RESULT + action 'run_again' resets to SELECT_MODE", async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })

  const result = await flow.handle(ctx, { kind: 'action', actionId: 'run_again' })
  assertStep(result)

  // Should show SELECT_MODE or CONFIGURE again
  const p = result.primitives[0]
  assert.ok(p.kind === 'Select' || p.kind === 'Form', `expected Select or Form, got ${p.kind}`)
})

test("RESULT + action 'rate' returns complete Resolution", async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })

  const result = await flow.handle(ctx, { kind: 'action', actionId: 'rate' })
  assertResolution(result)

  assert.equal(result.kind, 'complete')
})

// ---------------------------------------------------------------------------
// Result primitive — new tests for Phase 7a
// ---------------------------------------------------------------------------

test('sync completion emits a Result primitive (not Detail)', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertStep(result)
  assert.equal(result.primitives[0].kind, 'Result')
  assert.notEqual(result.primitives[0].kind, 'Detail')
})

test('Result primitive has expected action ids', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertStep(result)
  const p = result.primitives[0]
  assert.equal(p.kind, 'Result')
  if (p.kind === 'Result') {
    const ids = p.actions.map(a => a.id)
    assert.ok(ids.includes('rate_beautiful'), 'should have rate_beautiful')
    assert.ok(ids.includes('rate_funny'), 'should have rate_funny')
    assert.ok(ids.includes('rate_negative'), 'should have rate_negative')
    assert.ok(ids.includes('info'), 'should have info')
    assert.ok(ids.includes('tweak'), 'should have tweak')
    assert.ok(ids.includes('rerun'), 'should have rerun')
  }
})

test('Result primitive has actumId set to the actum id', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertStep(result)
  const p = result.primitives[0]
  assert.equal(p.kind, 'Result')
  if (p.kind === 'Result') {
    // The actum id comes from makeDeps() → inceptor.initiate → makeActum() → id: 'actum-1'
    assert.equal(p.actumId, 'actum-1')
  }
})

test('Media URL detection: imageUrl key → type image', () => {
  const flow = new ExecuteFlow(makeDeps())
  const step = (flow as unknown as { _buildResultStep(r: Record<string, unknown>, id: string): import('../../../src/flow/types.js').Step })
    ._buildResultStep({ imageUrl: 'https://example.com/img.png' }, 'a1')
  const p = step.primitives[0]
  assert.equal(p.kind, 'Result')
  if (p.kind === 'Result') {
    assert.ok(p.media && p.media.length > 0, 'should have media')
    assert.equal(p.media![0].type, 'image')
    assert.equal(p.media![0].url, 'https://example.com/img.png')
  }
})

test('Media URL detection: videoUrl key → type video', () => {
  const flow = new ExecuteFlow(makeDeps())
  const step = (flow as unknown as { _buildResultStep(r: Record<string, unknown>, id: string): import('../../../src/flow/types.js').Step })
    ._buildResultStep({ videoUrl: 'https://example.com/vid.mp4' }, 'a1')
  const p = step.primitives[0]
  assert.equal(p.kind, 'Result')
  if (p.kind === 'Result') {
    assert.ok(p.media && p.media.length > 0, 'should have media')
    assert.equal(p.media![0].type, 'video')
  }
})

test('Text content: non-URL result keys appear in textContent', () => {
  const flow = new ExecuteFlow(makeDeps())
  const step = (flow as unknown as { _buildResultStep(r: Record<string, unknown>, id: string): import('../../../src/flow/types.js').Step })
    ._buildResultStep({ caption: 'A cat on a mat', score: '0.9' }, 'a1')
  const p = step.primitives[0]
  assert.equal(p.kind, 'Result')
  if (p.kind === 'Result') {
    assert.ok(p.textContent, 'should have textContent')
    assert.ok(p.textContent!.includes('caption'), 'textContent should include key name')
    assert.ok(p.textContent!.includes('A cat on a mat'), 'textContent should include value')
  }
})

// ---------------------------------------------------------------------------
// Conversational reply tests
// ---------------------------------------------------------------------------

test('enter with modusId and messages in aditus skips configure and submits immediately', async () => {
  const deps = makeDeps()
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx({
    state: {
      modusId: 'mod-1',
      aditus: { messages: [{ role: 'user', content: 'hello chatgpt' }] },
      step: 'CONFIGURE',
      browsePageIndex: 0,
    },
  })

  const step = await flow.enter(ctx)

  // Should have submitted directly and returned a Result (sync cursor) not a Form
  assert.equal(step.primitives.length, 1)
  const p = step.primitives[0]
  assert.ok(
    p.kind === 'Result' || p.kind === 'Stream',
    `expected Result or Stream (got ${p.kind}) — enter with messages should skip configure`,
  )
})

test('RESULT state + prompt event continues text conversation', async () => {
  const deps = makeDeps({
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => ({
          kind: 'sync' as const,
          exitus: { exitus: { response: 'Hello from GPT!' }, impetus: 100n },
        }),
      }),
    },
  })
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  // Get to RESULT state
  await flow.handle(ctx, { kind: 'form', values: { prompt: 'say hello' } })

  // Flow should now be in RESULT state with priorMessages in state
  const state = ctx.state as { step: string; priorMessages?: unknown[] }
  assert.equal(state.step, 'RESULT')
  assert.ok(Array.isArray(state.priorMessages), 'state.priorMessages should be set after text result')

  // Now send a prompt event — should continue the conversation
  const result = await flow.handle(ctx, { kind: 'prompt', text: 'follow up question' })

  // Should be Stream or Result (re-submitted), NOT SELECT_MODE Select primitive
  assertStep(result)
  const p = result.primitives[0]
  assert.ok(
    p.kind === 'Result' || p.kind === 'Stream',
    `expected Result or Stream on continuation, got ${p.kind}`,
  )
})

test('RESULT state + prompt event without priorMessages restarts to SELECT_MODE', async () => {
  // Image result: cursor returns imageUrl — no priorMessages set
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  // Default makeDeps cursor returns { url: 'https://example.com/img.png' } — media result
  await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })

  const state = ctx.state as { step: string; priorMessages?: unknown[] }
  assert.equal(state.step, 'RESULT')
  // priorMessages should NOT be set for image/media result
  assert.ok(!state.priorMessages || state.priorMessages.length === 0, 'priorMessages should be absent for media result')

  // Prompt event in RESULT without priorMessages → restart to SELECT_MODE
  const result = await flow.handle(ctx, { kind: 'prompt', text: 'new request' })
  assertStep(result)
  const p = result.primitives[0]
  assert.equal(p.kind, 'Select', `expected SELECT_MODE Select on restart, got ${p.kind}`)
  if (p.kind === 'Select') {
    assert.ok(p.options.some(o => o.id === 'create'), 'SELECT_MODE should have create option')
    assert.ok(p.options.some(o => o.id === 'effect'), 'SELECT_MODE should have effect option')
  }
})

test('text result: state.priorMessages builds history for first turn', async () => {
  const deps = makeDeps({
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => ({
          kind: 'sync' as const,
          exitus: { exitus: { response: 'Hello from GPT!' }, impetus: 100n },
        }),
      }),
    },
  })
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })

  await flow.handle(ctx, { kind: 'form', values: { prompt: 'say hello' } })

  const state = ctx.state as { priorMessages?: Array<{ role: string; content: string }> }
  assert.ok(Array.isArray(state.priorMessages), 'state.priorMessages should be set')
  assert.equal(state.priorMessages!.length, 2, 'priorMessages should have user+assistant turns')
  assert.equal(state.priorMessages![0].role, 'user')
  assert.equal(state.priorMessages![0].content, 'say hello')
  assert.equal(state.priorMessages![1].role, 'assistant')
  assert.ok(state.priorMessages![1].content.includes('Hello from GPT!'))
})

test('text result continuation: state.priorMessages appends to existing history', async () => {
  const deps = makeDeps({
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => ({
          kind: 'sync' as const,
          exitus: { exitus: { response: 'Turn 2 reply' }, impetus: 100n },
        }),
      }),
    },
  })
  const flow = new ExecuteFlow(deps)
  const priorHistory = [
    { role: 'user' as const, content: 'first message' },
    { role: 'assistant' as const, content: 'first reply' },
  ]
  const ctx = makeCtx({
    state: {
      modusId: 'mod-1',
      aditus: { messages: [...priorHistory, { role: 'user', content: 'second message' }] },
      step: 'CONFIGURE',
      browsePageIndex: 0,
    },
  })

  const step = await flow.enter(ctx)
  assertStep(step)

  const p = step.primitives[0]
  assert.ok(p.kind === 'Result' || p.kind === 'Stream', `expected Result or Stream, got ${p.kind}`)

  // Check state.priorMessages (not primitive fields)
  const state = ctx.state as { priorMessages?: Array<{ role: string; content: string }> }
  assert.ok(Array.isArray(state.priorMessages))
  // Should have: first user, first assistant, second user, second assistant
  assert.equal(state.priorMessages!.length, 4)
  assert.equal(state.priorMessages![3].role, 'assistant')
  assert.ok(state.priorMessages![3].content.includes('Turn 2 reply'))
})

test('Result primitive does NOT expose replyable/modusId/priorMessages fields', async () => {
  const deps = makeDeps({
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => ({
          kind: 'sync' as const,
          exitus: { exitus: { response: 'Hello from GPT!' }, impetus: 100n },
        }),
      }),
    },
  })
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })

  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'say hello' } })
  assertStep(result)

  const p = result.primitives[0]
  assert.equal(p.kind, 'Result')
  if (p.kind === 'Result') {
    assert.equal((p as unknown as { replyable?: unknown }).replyable, undefined, 'replyable should not be on Result primitive')
    assert.equal((p as unknown as { modusId?: unknown }).modusId, undefined, 'modusId should not be on Result primitive')
    assert.equal((p as unknown as { priorMessages?: unknown }).priorMessages, undefined, 'priorMessages should not be on Result primitive')
  }
})

test('state.step transitions through full sync flow', async () => {
  const flow = new ExecuteFlow(makeDeps())
  const ctx = makeCtx()
  await flow.enter(ctx)

  let state = ctx.state as { step: string }
  assert.equal(state.step, 'SELECT_MODE')

  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  assert.equal((ctx.state as { step: string }).step, 'SELECT_CATEGORY')

  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  assert.equal((ctx.state as { step: string }).step, 'BROWSE_TOOLS')

  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })
  assert.equal((ctx.state as { step: string }).step, 'CONFIGURE')

  await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assert.equal((ctx.state as { step: string }).step, 'RESULT')
})

// ---------------------------------------------------------------------------
// Flow card (TASK-004) — cold/hot entry, edit markers, execute gating
// ---------------------------------------------------------------------------

// A fixture with one required (prompt) + one optional with a default (steps).
function makeCardModus(overrides: Partial<Modus> = {}): Modus {
  return makeModus({
    aditus: {
      prompt: { type: 'text', required: true, description: 'The prompt' },
      steps: { type: 'int', required: false, default: 20, description: 'Steps' },
    },
    ...overrides,
  })
}

// A two-required fixture (prompt + negative) for gap-fill walking.
function makeTwoRequiredModus(): Modus {
  return makeModus({
    aditus: {
      prompt: { type: 'text', required: true, description: 'The prompt' },
      negative: { type: 'text', required: true, description: 'Negative prompt' },
    },
  })
}

// An image-Porta fixture (image required, prompt optional) for entry-image mapping.
function makeImageModus(): Modus {
  return makeModus({
    aditus: {
      image: { type: 'image', required: true, description: 'Source image' },
      strength: { type: 'float', required: false, default: 0.8, description: 'Strength' },
    },
  })
}

function depsFor(modus: Modus): ExecuteFlowDeps {
  return makeDeps({
    modorum: {
      find: async () => modus,
      register: async () => {},
      update: async () => { throw new Error('not implemented') },
      list: async () => [],
    },
  })
}

test('cold entry (empty aditus) → Form card listing all fields, no Execute action', async () => {
  const flow = new ExecuteFlow(depsFor(makeCardModus()))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, browsePageIndex: 0 } })
  const step = await flow.enter(ctx)
  const p = step.primitives[0]
  assert.equal(p.kind, 'Form')
  if (p.kind === 'Form') {
    // lists ALL aditus fields
    assert.ok(p.fields.some(f => f.key === 'prompt'))
    assert.ok(p.fields.some(f => f.key === 'steps'))
    // carries values (card mode), and a required field (prompt) is unfilled
    assert.ok(p.values !== undefined, 'card carries values')
    assert.equal(p.values!.prompt, undefined, 'required prompt is unfilled')
  }
})

test('cold entry then fill the required field → card now exposes Execute', async () => {
  const flow = new ExecuteFlow(depsFor(makeCardModus()))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, browsePageIndex: 0 } })
  await flow.enter(ctx)

  // Edit the prompt field, then reply with a value.
  await flow.handle(ctx, { kind: 'action', actionId: 'edit_prompt' })
  const step = await flow.handle(ctx, { kind: 'prompt', text: 'a cat' })
  assertStep(step)
  const p = step.primitives[0]
  assert.equal(p.kind, 'Form')
  if (p.kind === 'Form') {
    assert.equal(p.values!.prompt, 'a cat', 'prompt filled')
    // all required now satisfied → renderer would show Execute (values present + required filled)
    const allRequiredFilled = p.fields.filter(f => f.required).every(f => p.values![f.key] !== undefined)
    assert.ok(allRequiredFilled, 'all required filled → Execute available')
  }
})

test('edit a specific optional field → sets that field, not the prompt field', async () => {
  const flow = new ExecuteFlow(depsFor(makeCardModus()))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, browsePageIndex: 0 } })
  await flow.enter(ctx)

  await flow.handle(ctx, { kind: 'action', actionId: 'edit_steps' })
  await flow.handle(ctx, { kind: 'prompt', text: '8' })

  const state = ctx.state as { aditus: Record<string, unknown> }
  assert.equal(state.aditus.steps, 8, 'steps filled (coerced to int) — not prompt')
  assert.equal(state.aditus.prompt, undefined, 'prompt untouched')
})

test('hot entry, all required present → fast-path submit, no card (regression guard)', async () => {
  const flow = new ExecuteFlow(depsFor(makeCardModus()))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: { prompt: 'a cat' }, browsePageIndex: 0 } })
  const step = await flow.enter(ctx)
  const p = step.primitives[0]
  assert.ok(p.kind === 'Result' || p.kind === 'Stream', `expected submit (Result/Stream), got ${p.kind}`)
})

test('hot entry, a required field missing → gap-fill prompt (no card), then submit', async () => {
  const flow = new ExecuteFlow(depsFor(makeTwoRequiredModus()))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: { prompt: 'a cat' }, browsePageIndex: 0 } })
  const step = await flow.enter(ctx)
  const p = step.primitives[0]
  assert.equal(p.kind, 'Form')
  if (p.kind === 'Form') {
    assert.equal(p.values, undefined, 'gap-fill path renders single prompt (no card values)')
  }

  // Reply with the missing field → auto-submit (gap-fill walks all required)
  const result = await flow.handle(ctx, { kind: 'prompt', text: 'blurry' })
  assertStep(result)
  const p2 = result.primitives[0]
  assert.ok(p2.kind === 'Result' || p2.kind === 'Stream', `expected submit, got ${p2.kind}`)
})

test('execute gating: a:execute with a required field empty does NOT submit (validation rejects)', async () => {
  const flow = new ExecuteFlow(depsFor(makeCardModus()))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, browsePageIndex: 0 } })
  await flow.enter(ctx)

  await assert.rejects(
    () => flow.handle(ctx, { kind: 'action', actionId: 'execute' }),
    /required field/,
    'execute with an empty required field must reject (no submit)',
  )
})

test('entry image maps onto the image Porta → counts as filled, not re-requested', async () => {
  const flow = new ExecuteFlow(depsFor(makeImageModus()))
  // Only the image is required; it arrives via the envelope → should fast-path submit.
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, entryImageUrl: 'https://img/x.png', browsePageIndex: 0 } })
  const step = await flow.enter(ctx)
  const p = step.primitives[0]
  assert.ok(p.kind === 'Result' || p.kind === 'Stream', `image filled → submit, got ${p.kind}`)
  const state = ctx.state as { aditus: Record<string, unknown> }
  assert.equal(state.aditus.image, 'https://img/x.png', 'image Porta pre-filled from entryImageUrl')
})

test('entry image with another missing required → gap-fill asks only for the other field', async () => {
  const modus = makeModus({
    aditus: {
      image: { type: 'image', required: true, description: 'Source image' },
      prompt: { type: 'text', required: true, description: 'The prompt' },
    },
  })
  const flow = new ExecuteFlow(depsFor(modus))
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, entryImageUrl: 'https://img/x.png', browsePageIndex: 0 } })
  const step = await flow.enter(ctx)
  const p = step.primitives[0]
  assert.equal(p.kind, 'Form')
  const state = ctx.state as { aditus: Record<string, unknown> }
  assert.equal(state.aditus.image, 'https://img/x.png', 'image already filled')
  // A prompt reply fills the remaining required field → submit
  const result = await flow.handle(ctx, { kind: 'prompt', text: 'make it cyberpunk' })
  assertStep(result)
  const p2 = result.primitives[0]
  assert.ok(p2.kind === 'Result' || p2.kind === 'Stream', `expected submit after prompt, got ${p2.kind}`)
})

test('entry image with no image Porta is ignored', async () => {
  const flow = new ExecuteFlow(depsFor(makeCardModus()))  // no image Porta
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: {}, entryImageUrl: 'https://img/x.png', browsePageIndex: 0 } })
  const step = await flow.enter(ctx)
  const state = ctx.state as { aditus: Record<string, unknown> }
  assert.equal(Object.keys(state.aditus).length, 0, 'no image Porta → entry image ignored')
  assert.equal(step.primitives[0].kind, 'Form', 'falls into the cold card')
})

test('Mod • → Add: state.pinnedModels flows through _submit to inceptor.initiate', async () => {
  // Proves the dispatch→spec bridge's flow leg: pinned models carried from entry state
  // into the initiate call (sibling of shareTokenHint), so they land on the Actum.
  let captured: { pinnedModels?: unknown } | undefined
  const deps = makeDeps({
    inceptor: { initiate: async (input) => { captured = input as { pinnedModels?: unknown }; return makeActum() } },
  })
  const flow = new ExecuteFlow(deps)
  const pinned = [{ role: 'lora', id: 'intella.milady', dest: 'models/loras/milady.safetensors' }]
  // Pre-filled /make shortcut: modusId + non-empty aditus → validate + submit directly.
  const ctx = makeCtx({ state: { modusId: 'mod-1', aditus: { prompt: 'a cat' }, pinnedModels: pinned } })
  await flow.enter(ctx)
  assert.deepEqual(captured?.pinnedModels, pinned, 'pinned models reach initiate')
})

// ---------------------------------------------------------------------------
// Port routing — the declaration is what an entering run is held to
// ---------------------------------------------------------------------------
//
// The seed test (`tests/unit/crystal/seeds/modi.test.ts`) asserts which ports the
// caption and decompose modi DECLARE. That is a statement about the seed file. The
// block below asserts the property a run depends on: the declaration is what decides
// which values reach the cursor.
//
// These drive the REAL seed modi (imported, never re-declared as a fixture) through
// `ExecuteFlow`'s two entry routes, and read back the aditus the cursor is handed:
//
//   • a declared port arrives with its value intact
//   • an undeclared key never arrives — `validateAditus` strips it before dispatch
//     (the shipped semantics: strip, not refuse)
//
// The expected port sets below are written out as LITERALS on purpose. Deriving them
// from `modus.aditus` would make the assertion read its own input: removing a port
// from the seed would shrink both sides and the test would stay green while the route
// changed. Pinned literally, the seed and the route have to agree.

const CAPTION_PORTS_AT_CURSOR = ['captionPrompt', 'captionset', 'dataset', 'maxNewTokens', 'name']
const DECOMPOSE_PORTS_AT_CURSOR = ['captionset', 'dataset', 'model', 'provider', 'redo', 'trigger']

/** Deps bound to one real modus, capturing the aditus that reaches `cursor.run`. */
function routingDepsFor(modus: Modus): { deps: ExecuteFlowDeps; atCursor: () => Record<string, unknown> | undefined } {
  let seen: Record<string, unknown> | undefined
  const deps = makeDeps({
    modorum: {
      find: async () => modus,
      register: async () => {},
      update: async () => { throw new Error('not implemented') },
      list: async () => [],
    },
    inceptor: {
      // Carry the dispatched aditus onto the Actum, exactly as the real inceptor does,
      // so what the cursor reads is what the route actually delivered.
      initiate: async (inceptio) => makeActum({ modusId: inceptio.modusId, aditus: inceptio.aditus }),
    },
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async (actum) => {
          seen = actum.aditus
          return { kind: 'sync' as const, exitus: { exitus: { ok: 'done' }, impetus: 100n } }
        },
      }),
    },
    // Both dataset modi declare their `dataset`/`captionset` ports as references to a stored
    // record, so casting one resolves it for the caster before dispatch. These tests are about
    // which ports reach the cursor, so the fixture is the caster's OWN dataset — the refusal
    // path is covered in `tests/unit/execution/ownedAditusEntryPoints.test.ts`.
    ownedResources: {
      datasets: {
        async findOwned(id: string, owner: string) {
          return owner === 'anima-1' && id === 'dataset-alpha'
            ? { id, captionsets: [{ id: 'captionset-alpha' }] }
            : null
        },
      },
    },
  })
  return { deps, atCursor: () => seen }
}

test('routing: the caption modus declaration decides which ports reach the cursor', async () => {
  const { deps, atCursor } = routingDepsFor(MODUS_DATASET_CAPTION)
  const flow = new ExecuteFlow(deps)
  // Pre-filled entry (the /run shortcut): required satisfied → validate + submit.
  // Every declared port carries a value, plus two keys the modus does not declare.
  const ctx = makeCtx({
    state: {
      modusId: MODUS_DATASET_CAPTION.id,
      aditus: {
        dataset: 'dataset-alpha',
        captionset: 'captionset-alpha',
        name: 'second pass',
        captionPrompt: 'describe the subject',
        maxNewTokens: '128',
        captionSet: 'captionset-alpha',   // near-miss casing — not a declared port
        loraId: 'lora-alpha',             // belongs to another modus entirely
      },
    },
  })
  await flow.enter(ctx)

  const at = atCursor()
  assert.ok(at, 'the run reached the cursor')
  assert.deepEqual(Object.keys(at).sort(), CAPTION_PORTS_AT_CURSOR,
    'exactly the declared ports reach the cursor — no declared port dropped, no undeclared key carried')
})

test('routing: a declared caption port arrives at the cursor with its value intact', async () => {
  const { deps, atCursor } = routingDepsFor(MODUS_DATASET_CAPTION)
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx({
    state: {
      modusId: MODUS_DATASET_CAPTION.id,
      aditus: { dataset: 'dataset-alpha', captionset: 'captionset-alpha', maxNewTokens: '128' },
    },
  })
  await flow.enter(ctx)

  const at = atCursor()
  assert.ok(at, 'the run reached the cursor')
  // `captionset` is the extend port: present at the cursor, the pass extends that set;
  // dropped on the route, the same request mints a fresh one and re-captions the dataset.
  assert.equal(at.captionset, 'captionset-alpha', 'the extend port survives the route')
  assert.equal(at.dataset, 'dataset-alpha')
  // Declared 'int' — coerced on the way in, so the cursor reads a number, not the form's string.
  assert.equal(at.maxNewTokens, 128)
})

test('routing: an undeclared caption key never reaches the cursor', async () => {
  const { deps, atCursor } = routingDepsFor(MODUS_DATASET_CAPTION)
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx({
    state: {
      modusId: MODUS_DATASET_CAPTION.id,
      aditus: { dataset: 'dataset-alpha', captionSet: 'captionset-alpha' },
    },
  })
  await flow.enter(ctx)

  const at = atCursor()
  assert.ok(at, 'the run reached the cursor')
  assert.equal('captionSet' in at, false, 'an undeclared key is stripped before dispatch')
  assert.equal('captionset' in at, false, 'and it is not silently re-homed onto the declared port')
})

test('routing: the decompose modus declaration decides which ports reach the cursor (form route)', async () => {
  const { deps, atCursor } = routingDepsFor(MODUS_DATASET_DECOMPOSE)
  const flow = new ExecuteFlow(deps)
  // Cold entry → the flow card, then one form bundle. This is the other entry route:
  // form values merge key-by-key (an undeclared key survives that merge), and the full
  // validate happens at submit.
  const ctx = makeCtx({ state: { modusId: MODUS_DATASET_DECOMPOSE.id, aditus: {}, browsePageIndex: 0 } })
  await flow.enter(ctx)
  await flow.handle(ctx, {
    kind: 'form',
    values: {
      dataset: 'dataset-alpha',
      captionset: 'captionset-alpha',
      redo: true,
      trigger: 'trigword',
      model: 'model-alpha',
      provider: 'provider-alpha',
      rebuild: true,        // not a declared port
      skipped: 0,           // an exitus-shaped key that was deliberately never declared
    },
  })

  const at = atCursor()
  assert.ok(at, 'the run reached the cursor')
  assert.deepEqual(Object.keys(at).sort(), DECOMPOSE_PORTS_AT_CURSOR,
    'exactly the declared ports reach the cursor')
})

test('routing: the decompose redo port arrives at the cursor in the form its reader parses', async () => {
  const { deps, atCursor } = routingDepsFor(MODUS_DATASET_DECOMPOSE)
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx({ state: { modusId: MODUS_DATASET_DECOMPOSE.id, aditus: {}, browsePageIndex: 0 } })
  await flow.enter(ctx)
  await flow.handle(ctx, {
    kind: 'form',
    values: { dataset: 'dataset-alpha', captionset: 'captionset-alpha', redo: true, rebuild: true },
  })

  const at = atCursor()
  assert.ok(at, 'the run reached the cursor')
  // Declared 'text', so the boolean is coerced to the string `isRedo` reads as on.
  assert.equal(at.redo, 'true', 'the whole-set opt-in survives the route')
  assert.equal('rebuild' in at, false, 'an undeclared opt-in does not')
})

test('routing: an undeclared decompose key cannot turn an incremental pass into a whole-set one', async () => {
  const { deps, atCursor } = routingDepsFor(MODUS_DATASET_DECOMPOSE)
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx({ state: { modusId: MODUS_DATASET_DECOMPOSE.id, aditus: {}, browsePageIndex: 0 } })
  await flow.enter(ctx)
  await flow.handle(ctx, {
    kind: 'form',
    values: { dataset: 'dataset-alpha', captionset: 'captionset-alpha', Redo: 'yes', force: 'true' },
  })

  const at = atCursor()
  assert.ok(at, 'the run reached the cursor')
  assert.equal('redo' in at, false, 'the declared port stays absent — the pass is incremental')
  assert.equal('Redo' in at, false)
  assert.equal('force' in at, false)
})
