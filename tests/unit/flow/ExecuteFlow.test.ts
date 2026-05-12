import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExecuteFlow } from '../../../src/flow/flows/ExecuteFlow.js'
import type { ExecuteFlowDeps } from '../../../src/flow/flows/ExecuteFlow.js'
import type { FlowContext, PrimitiveEvent, Step, Resolution } from '../../../src/flow/types.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'

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
    },
    actorum: {
      create: async (a) => ({ ...a, inceptum: new Date() }),
      update: async (id, patch) => ({ ...makeActum({ id }), ...patch }),
      findById: async (_id) => null,
      findByExternusJobId: async (_id) => null,
      findExpired: async () => [],
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

test('CONFIGURE + form, balance insufficient returns handoff to manage', async () => {
  const deps = makeDeps({
    signorum: {
      balance: async () => 0n,  // zero balance
      issue: async () => { throw new Error('not implemented') },
      lock: async () => {},
      release: async () => {},
      history: async () => [],
      settle: async () => {},
    },
  })
  const flow = new ExecuteFlow(deps)
  const ctx = makeCtx()
  await flow.enter(ctx)
  await flow.handle(ctx, { kind: 'select', selectedId: 'create' })
  await flow.handle(ctx, { kind: 'select', selectedId: 'image' })
  await flow.handle(ctx, { kind: 'paginate', action: 'select', selectedId: 'mod-1' })

  const result = await flow.handle(ctx, { kind: 'form', values: { prompt: 'a cat' } })
  assertResolution(result)

  assert.equal(result.kind, 'handoff')
  if (result.kind === 'handoff') {
    assert.equal(result.toIntent, 'manage')
    assert.deepEqual((result.withContext as { reason: string }).reason, 'insufficient_funds')
  }
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
