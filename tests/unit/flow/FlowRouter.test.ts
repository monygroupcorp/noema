import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FlowRouter } from '../../../src/flow/FlowRouter.js'
import { MemoryFlowContextStore } from '../../../src/flow/FlowContextStore.js'
import type { Flow, FlowContext, Step, Resolution, PrimitiveEvent, Intent } from '../../../src/flow/types.js'

// ---------------------------------------------------------------------------
// Stub flows
// ---------------------------------------------------------------------------

function makeStep(label = 'test step'): Step {
  return { primitives: [{ kind: 'Prompt', label }] }
}

/** A minimal Flow that always returns the given step from enter/handle */
function makeStubFlow(intent: Intent, enterStep?: Step, handleResult?: Step | Resolution): Flow {
  return {
    intent,
    enter: async (_ctx) => enterStep ?? makeStep(`enter:${intent}`),
    handle: async (_ctx, _event) => handleResult ?? makeStep(`handle:${intent}`),
  }
}

function makeRouter(overrides: Partial<{ onStep: (ctx: FlowContext, step: Step) => void; onResolution: (ctx: FlowContext, res: Resolution) => void }> = {}) {
  const steps: Array<{ ctx: FlowContext; step: Step }> = []
  const resolutions: Array<{ ctx: FlowContext; res: Resolution }> = []
  const store = new MemoryFlowContextStore()
  const router = new FlowRouter({
    store,
    onStep: overrides.onStep ?? ((ctx, step) => { steps.push({ ctx, step }) }),
    onResolution: overrides.onResolution ?? ((ctx, res) => { resolutions.push({ ctx, res }) }),
  })
  return { router, store, steps, resolutions }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('enter calls flow.enter and invokes onStep callback', async () => {
  const { router, steps } = makeRouter()
  router.register(makeStubFlow('execute', makeStep('hello')))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })

  assert.equal(steps.length, 1)
  assert.equal(steps[0].step.primitives[0].label, 'hello')
})

test('handle routes to active flow and invokes onStep with next step', async () => {
  const { router, steps } = makeRouter()
  router.register(makeStubFlow('execute', makeStep('enter'), makeStep('next')))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  steps.length = 0  // clear enter step

  const event: PrimitiveEvent = { kind: 'prompt', text: 'hello' }
  await router.handle('telegram', 'user-1', event)

  assert.equal(steps.length, 1)
  assert.equal(steps[0].step.primitives[0].label, 'next')
})

test('handle with Resolution invokes onResolution and clears context', async () => {
  const resolution: Resolution = { kind: 'complete' }
  const { router, store, resolutions } = makeRouter()
  router.register(makeStubFlow('execute', makeStep(), resolution))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  await router.handle('telegram', 'user-1', { kind: 'prompt', text: 'done' })

  assert.equal(resolutions.length, 1)
  assert.equal(resolutions[0].res.kind, 'complete')
  assert.equal(store.get('telegram', 'user-1'), undefined)
})

test('handle with abandon Resolution clears context', async () => {
  const resolution: Resolution = { kind: 'abandon' }
  const { router, store, resolutions } = makeRouter()
  router.register(makeStubFlow('execute', makeStep(), resolution))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  await router.handle('telegram', 'user-1', { kind: 'action', actionId: 'cancel' })

  assert.equal(resolutions.length, 1)
  assert.equal(resolutions[0].res.kind, 'abandon')
  assert.equal(store.get('telegram', 'user-1'), undefined)
})

test('handle with handoff Resolution re-enters target flow', async () => {
  const handoffResult: Resolution = { kind: 'handoff', toIntent: 'manage', withContext: { reason: 'test' } }
  const { router, steps } = makeRouter()

  router.register(makeStubFlow('execute', makeStep('execute-enter'), handoffResult))
  router.register(makeStubFlow('manage', makeStep('manage-enter')))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  steps.length = 0

  await router.handle('telegram', 'user-1', { kind: 'prompt', text: 'go' })

  // Should have a new step from the manage flow
  assert.ok(steps.some(s => s.step.primitives[0].label === 'manage-enter'))
})

test('handle when no active flow does nothing (no error, no callback)', async () => {
  const { router, steps, resolutions } = makeRouter()
  router.register(makeStubFlow('execute'))

  // No enter() called
  await router.handle('telegram', 'user-1', { kind: 'prompt', text: 'hello' })

  assert.equal(steps.length, 0)
  assert.equal(resolutions.length, 0)
})

test('handleActumComplete resumes a context that has pendingActumId set', async () => {
  // Use a flow that sets pendingActumId on ctx inside enter
  const steps: Array<{ ctx: FlowContext; step: Step }> = []
  const store = new MemoryFlowContextStore()

  const resumeStep = makeStep('resumed')

  // A flow with handleCompletion support
  const flow: Flow & { handleCompletion(ctx: FlowContext, result: { kind: 'complete'; exitus: Record<string, unknown> } | { kind: 'failed'; error: string }): Promise<Step | Resolution> } = {
    intent: 'execute',
    enter: async (ctx) => {
      ctx.pendingActumId = 'actum-42'
      return makeStep('waiting')
    },
    handle: async (_ctx, _event) => makeStep('handle'),
    handleCompletion: async (_ctx, _result) => resumeStep,
  }

  const router = new FlowRouter({
    store,
    onStep: (ctx, step) => { steps.push({ ctx, step }) },
    onResolution: () => {},
  })
  router.register(flow)

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  steps.length = 0  // clear enter step

  await router.handleActumComplete('actum-42', { kind: 'complete', exitus: { url: 'https://example.com' } })

  assert.equal(steps.length, 1)
  assert.equal(steps[0].step.primitives[0].label, 'resumed')
})

test('handleActumComplete for unknown actumId is a no-op', async () => {
  const { router, steps, resolutions } = makeRouter()
  router.register(makeStubFlow('execute'))

  await router.handleActumComplete('actum-unknown', { kind: 'complete', exitus: {} })

  assert.equal(steps.length, 0)
  assert.equal(resolutions.length, 0)
})

test('clear removes context', async () => {
  const { router, store } = makeRouter()
  router.register(makeStubFlow('execute'))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  assert.ok(store.get('telegram', 'user-1') !== undefined)

  router.clear('telegram', 'user-1')
  assert.equal(store.get('telegram', 'user-1'), undefined)
})

test('enter with state initialCtx passes state to flow', async () => {
  const receivedStates: unknown[] = []
  const store = new MemoryFlowContextStore()
  const router = new FlowRouter({
    store,
    onStep: () => {},
    onResolution: () => {},
  })

  const flow: Flow = {
    intent: 'execute',
    enter: async (ctx) => {
      receivedStates.push(ctx.state)
      return makeStep('entered')
    },
    handle: async (_ctx, _event) => makeStep('handled'),
  }
  router.register(flow)

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' }, {
    state: { myField: 42, messages: [{ role: 'user', content: 'hi' }] }
  })

  assert.equal(receivedStates.length, 1)
  const s = receivedStates[0] as { myField: number; messages: unknown[] }
  assert.equal(s.myField, 42)
  assert.equal(s.messages.length, 1)
})

test('entering a new flow when one is active abandons the existing one', async () => {
  const resolutions: Array<Resolution> = []
  const store = new MemoryFlowContextStore()
  const router = new FlowRouter({
    store,
    onStep: () => {},
    onResolution: (_ctx, res) => resolutions.push(res),
  })

  router.register(makeStubFlow('execute'))
  router.register(makeStubFlow('train'))

  await router.enter('execute', 'telegram', 'user-1', { animaId: 'anima-1' })
  await router.enter('train', 'telegram', 'user-1', { animaId: 'anima-1' })

  // The abandoned context should have triggered an abandon resolution
  assert.ok(resolutions.some(r => r.kind === 'abandon'))
  // New flow should be active
  assert.equal(store.get('telegram', 'user-1')?.intent, 'train')
})
