import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  runConcierge,
  maxToolIterations,
  buildSystemPrompt,
  FORCED_FINAL_INSTRUCTION,
  type ConciergeDeps,
  type ConciergeContext,
} from '../../../../src/allocutio/api/ConciergeAgent.js'
import type {
  OpenRouterChatResult,
  OpenRouterToolChatOpts,
  OpenRouterToolClientDeps,
} from '../../../../src/allocutio/api/OpenRouterToolClient.js'
import type { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import type { Run } from '../../../../src/allocutio/api/types.js'

// ---------------------------------------------------------------------------
// Test kit — a scripted (network-free) runToolChat + a minimal CrystalApi mock.
// ---------------------------------------------------------------------------

function chatResult(partial: Partial<OpenRouterChatResult>): OpenRouterChatResult {
  return {
    finishReason: 'stop',
    tokenUsage: { totalTokens: 0 },
    ...partial,
  }
}

function scriptedClient(results: OpenRouterChatResult[]) {
  const calls: OpenRouterToolChatOpts[] = []
  let i = 0
  const runToolChat = async (
    _deps: OpenRouterToolClientDeps,
    opts: OpenRouterToolChatOpts,
  ): Promise<OpenRouterChatResult> => {
    calls.push(opts)
    const r = results[Math.min(i, results.length - 1)]
    i++
    return r
  }
  return { runToolChat, calls, count: () => i }
}

interface ApiSpy {
  listModelsCalls: Array<Record<string, unknown>>
  quoteCalls: Array<{ target: unknown; aditus: unknown }>
  listFlowsCalls: number
  getRunCalls: Array<{ auctor: unknown; id: string }>
  listRunsCalls: Array<{ auctor: unknown; opts: unknown }>
  statusCalls: Array<{ auctor: unknown }>
  listCollectionsCalls: Array<{ auctor: unknown }>
  getCollectionCalls: Array<{ auctor: unknown; id: string }>
  listStudiosCalls: Array<{ auctor: unknown }>
  getStudioCalls: Array<{ auctor: unknown; id: string }>
  listFundamentaCalls: number
}

function makeApi(): { api: CrystalApi; spy: ApiSpy } {
  const spy: ApiSpy = {
    listModelsCalls: [],
    quoteCalls: [],
    listFlowsCalls: 0,
    getRunCalls: [],
    listRunsCalls: [],
    statusCalls: [],
    listCollectionsCalls: [],
    getCollectionCalls: [],
    listStudiosCalls: [],
    getStudioCalls: [],
    listFundamentaCalls: 0,
  }
  const mock = {
    listFlows: async () => {
      spy.listFlowsCalls++
      return [{ id: 'flux.txt2img', nomen: 'Flux', versio: '1', modusGenus: 'imagine' }]
    },
    describeFlow: async (id: string) => ({
      id,
      nomen: 'Flux',
      versio: '1',
      input: { type: 'object', properties: { prompt: { type: 'string' } } },
    }),
    listModels: async (filter: Record<string, unknown> = {}) => {
      spy.listModelsCalls.push(filter)
      return []
    },
    quote: async (_auctor: unknown, target: unknown, aditus: unknown) => {
      spy.quoteCalls.push({ target, aditus })
      return { impetus: '100', recipient: '0xrecipient' }
    },
    // noema-113 pre-GO resolvability check: the concierge normalizes each pinned pick through
    // this chokepoint before emitting a GO-able proposal. The scripted picks all resolve here.
    resolvePinnedModels: async (_auctor: unknown, pinned: readonly (string | { id: string })[]) =>
      pinned.map((p) => ({ role: 'lora', id: typeof p === 'string' ? p : p.id, dest: `models/loras/${typeof p === 'string' ? p : p.id}.safetensors` })),
    // noema-115: owner-scoped history + balance reads.
    getRun: async (auctor: unknown, id: string) => {
      spy.getRunCalls.push({ auctor, id })
      return { id, status: 'complete', modusId: 'flux.txt2img' }
    },
    listRuns: async (auctor: unknown, opts: Record<string, unknown> = {}) => {
      spy.listRunsCalls.push({ auctor, opts })
      return {
        runs: [
          { id: 'run_1', modusId: 'flux.txt2img', modusLabel: 'Flux', status: 'settled', cost: '10', costUsd: 0.01 },
        ],
        runningTotal: { impetus: '10', usd: 0.01 },
      }
    },
    status: async (auctor: unknown) => {
      spy.statusCalls.push({ auctor })
      return { balanceImpetus: '500', balanceUsd: 0.5, gens: [], studios: [], joinable: [], takenAt: 'now' }
    },
    // noema-365: SEE rung 1 — collections/studios/fundamenta discovery, owner-scoped like get_run.
    listCollections: async (auctor: unknown) => {
      spy.listCollectionsCalls.push({ auctor })
      return [{ id: 'coll_1', label: 'a saved grid' }]
    },
    getCollection: async (auctor: unknown, id: string) => {
      spy.getCollectionCalls.push({ auctor, id })
      return { id, label: 'a saved grid' }
    },
    listStudios: async (auctor: unknown) => {
      spy.listStudiosCalls.push({ auctor })
      return [{ id: 'studio_1', state: 'ready' }]
    },
    getStudio: async (auctor: unknown, id: string) => {
      spy.getStudioCalls.push({ auctor, id })
      return { id, state: 'ready' }
    },
    listFundamenta: async () => {
      spy.listFundamentaCalls++
      return [{ id: 'flux', versio: '1' }]
    },
  }
  return { api: mock as unknown as CrystalApi, spy }
}

const toolClient = {} as unknown as OpenRouterToolClientDeps

function baseDeps(runToolChat: ConciergeDeps['runToolChat'], api: CrystalApi): ConciergeDeps {
  return { runToolChat, toolClient, api }
}

function baseCtx(over: Partial<ConciergeContext> = {}): ConciergeContext {
  return { auctor: { animaId: 'anima_1' }, spicyMode: false, ...over }
}

const listFlowsCall = {
  toolCalls: [{ id: 'c1', name: 'list_flows', arguments: '{}' }],
  finishReason: 'tool_calls',
}

// ---------------------------------------------------------------------------
// (a) A scripted tool-call sequence yields a proposal with SUMMED tokenUsage.
// ---------------------------------------------------------------------------
test('scripted tool-call sequence yields a proposal with summed tokenUsage', async () => {
  const { api, spy } = makeApi()
  const proposalJson = JSON.stringify({
    kind: 'proposal',
    modusId: 'flux.txt2img',
    aditus: { prompt: 'a fox' },
    pinnedModels: ['lora_detail'],
    embellishedPrompt: 'a fox, cinematic detail',
    rationale: 'chose flux for photoreal',
  })
  const client = scriptedClient([
    chatResult({ ...listFlowsCall, tokenUsage: { totalTokens: 10, promptTokens: 6, completionTokens: 4 } }),
    chatResult({ content: proposalJson, tokenUsage: { totalTokens: 20, promptTokens: 12, completionTokens: 8 } }),
  ])

  const result = await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'make me a fox')

  assert.equal(result.kind, 'proposal')
  if (result.kind !== 'proposal') return
  assert.equal(result.modusId, 'flux.txt2img')
  assert.deepEqual(result.pinnedModels, ['lora_detail'])
  assert.deepEqual(result.quote, { impetus: '100', recipient: '0xrecipient' })
  // Summed across BOTH runToolChat calls.
  assert.deepEqual(result.tokenUsage, { totalTokens: 30, promptTokens: 18, completionTokens: 12 })
  assert.equal(spy.listFlowsCalls, 1) // the tool actually executed
  assert.equal(spy.quoteCalls.length, 1) // authoritative final quote computed
})

// ---------------------------------------------------------------------------
// (b) A no-tool-call response yields a reply.
// ---------------------------------------------------------------------------
test('a no-tool-call response yields a reply', async () => {
  const { api } = makeApi()
  const client = scriptedClient([
    chatResult({ content: 'Hi! What would you like to create today?', tokenUsage: { totalTokens: 5 } }),
  ])

  const result = await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'hello')

  assert.equal(result.kind, 'reply')
  if (result.kind !== 'reply') return
  assert.equal(result.text, 'Hi! What would you like to create today?')
  assert.equal(result.tokenUsage.totalTokens, 5)
})

// ---------------------------------------------------------------------------
// (c) spicyMode gates includeAdult on the listModels call (Q2 seam).
// ---------------------------------------------------------------------------
for (const spicyMode of [false, true]) {
  test(`spicyMode:${spicyMode} calls listModels with includeAdult:${spicyMode}`, async () => {
    const { api, spy } = makeApi()
    const client = scriptedClient([
      chatResult({
        toolCalls: [{ id: 'm1', name: 'search_models', arguments: JSON.stringify({ q: 'anime' }) }],
        finishReason: 'tool_calls',
      }),
      chatResult({ content: JSON.stringify({ kind: 'reply', text: 'done' }) }),
    ])

    await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ spicyMode }), 'find models')

    assert.equal(spy.listModelsCalls.length, 1)
    assert.equal(spy.listModelsCalls[0].includeAdult, spicyMode)
    assert.equal(spy.listModelsCalls[0].q, 'anime')
  })
}

// ---------------------------------------------------------------------------
// (c2) search_models passes the turn's auctor through so listModels can union in
// the caller's own imported models (noema-116).
// ---------------------------------------------------------------------------
test('search_models passes ctx.auctor through to listModels', async () => {
  const { api, spy } = makeApi()
  const client = scriptedClient([
    chatResult({
      toolCalls: [{ id: 'm1', name: 'search_models', arguments: JSON.stringify({ trigger: 'valkyriesorder' }) }],
      finishReason: 'tool_calls',
    }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'done' }) }),
  ])

  const ctx = baseCtx({ auctor: { animaId: 'anima-42' } })
  await runConcierge(baseDeps(client.runToolChat, api), ctx, 'find my lora')

  assert.equal(spy.listModelsCalls.length, 1)
  assert.deepEqual(spy.listModelsCalls[0].auctor, { animaId: 'anima-42' })
})

// ---------------------------------------------------------------------------
// (d) embellishedPrompt does NOT prepend generatio.style.
// ---------------------------------------------------------------------------
test('embellishedPrompt does not prepend generatio.style', async () => {
  const { api } = makeApi()
  const proposalJson = JSON.stringify({
    kind: 'proposal',
    modusId: 'flux.txt2img',
    aditus: { prompt: 'a castle' },
    pinnedModels: [],
    embellishedPrompt: 'a castle, dramatic lighting',
    rationale: 'ok',
  })
  const client = scriptedClient([chatResult({ content: proposalJson })])

  const result = await runConcierge(
    baseDeps(client.runToolChat, api),
    baseCtx({ generatio: { style: 'anime' } }),
    'a castle',
  )

  assert.equal(result.kind, 'proposal')
  if (result.kind !== 'proposal') return
  assert.equal(result.embellishedPrompt, 'a castle, dramatic lighting')
  assert.ok(!result.embellishedPrompt.startsWith('anime'))
  assert.ok(!result.embellishedPrompt.includes('anime, '))
})

// ---------------------------------------------------------------------------
// (e) The tool array passed to runToolChat exposes NONE of the spend tools.
// ---------------------------------------------------------------------------
test('the tool surface contains no spend tools', async () => {
  const { api } = makeApi()
  const client = scriptedClient([chatResult({ content: 'hi' })])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'hello')

  const names = (client.calls[0].tools ?? []).map((t) => t.function.name)
  assert.deepEqual(
    names.sort(),
    [
      'describe_flow',
      'get_collection',
      'get_run',
      'get_studio',
      'list_collections',
      'list_flows',
      'list_fundamenta',
      'list_runs',
      'list_studios',
      'quote',
      'search_models',
      'status',
    ],
  )
  for (const spend of ['run_flow', 'provision_studio', 'collect', 'runFlow', 'invokeFlow']) {
    assert.ok(!names.includes(spend), `spend tool ${spend} must not be exposed`)
  }
})

// ---------------------------------------------------------------------------
// (i) noema-115: get_run, list_runs, and status are wired into the tool loop,
// forward the caller's auctor (owner-scoped), and their results reach the model.
// ---------------------------------------------------------------------------
test('get_run is wired, owner-scoped, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({
      toolCalls: [{ id: 'g1', name: 'get_run', arguments: JSON.stringify({ id: 'run_1' }) }],
      finishReason: 'tool_calls',
    }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'that run made a fox' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'what was run_1?')

  assert.equal(spy.getRunCalls.length, 1)
  assert.deepEqual(spy.getRunCalls[0], { auctor, id: 'run_1' })
  const secondCallMessages = client.calls[1].messages
  const toolResultMsg = secondCallMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'g1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('run_1'))
})

test('list_runs is wired, owner-scoped, forwards limit/cursor, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({
      toolCalls: [{ id: 'l1', name: 'list_runs', arguments: JSON.stringify({ limit: 5, cursor: 'c0' }) }],
      finishReason: 'tool_calls',
    }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'you made a fox yesterday' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'what did I make recently?')

  assert.equal(spy.listRunsCalls.length, 1)
  assert.equal(spy.listRunsCalls[0].auctor, auctor)
  assert.deepEqual(spy.listRunsCalls[0].opts, { limit: 5, cursor: 'c0' })
  const secondCallMessages = client.calls[1].messages
  const toolResultMsg = secondCallMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'l1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('run_1'))
})

test('status is wired, owner-scoped, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({
      toolCalls: [{ id: 's1', name: 'status', arguments: '{}' }],
      finishReason: 'tool_calls',
    }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'you have 500 impetus' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'can I afford this?')

  assert.equal(spy.statusCalls.length, 1)
  assert.deepEqual(spy.statusCalls[0], { auctor })
  const secondCallMessages = client.calls[1].messages
  const toolResultMsg = secondCallMessages.find((m) => m.role === 'tool' && m.tool_call_id === 's1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('500'))
})

// ---------------------------------------------------------------------------
// (j) noema-365: SEE rung 1 — list_collections, get_collection, list_studios,
// get_studio, and list_fundamenta are wired into the tool loop, owner-scoped
// where the handler is, and their results reach the model.
// ---------------------------------------------------------------------------
test('list_collections is wired, owner-scoped, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({ toolCalls: [{ id: 'lc1', name: 'list_collections', arguments: '{}' }], finishReason: 'tool_calls' }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'you have one saved collection' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'what collections do I have?')

  assert.equal(spy.listCollectionsCalls.length, 1)
  assert.deepEqual(spy.listCollectionsCalls[0], { auctor })
  const toolResultMsg = client.calls[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'lc1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('coll_1'))
})

test('get_collection is wired, owner-scoped, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({
      toolCalls: [{ id: 'gc1', name: 'get_collection', arguments: JSON.stringify({ id: 'coll_1' }) }],
      finishReason: 'tool_calls',
    }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'that is your saved grid' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'tell me about coll_1')

  assert.equal(spy.getCollectionCalls.length, 1)
  assert.deepEqual(spy.getCollectionCalls[0], { auctor, id: 'coll_1' })
  const toolResultMsg = client.calls[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'gc1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('coll_1'))
})

test('list_studios is wired, owner-scoped, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({ toolCalls: [{ id: 'ls1', name: 'list_studios', arguments: '{}' }], finishReason: 'tool_calls' }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'you have one studio running' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'what studios do I have?')

  assert.equal(spy.listStudiosCalls.length, 1)
  assert.deepEqual(spy.listStudiosCalls[0], { auctor })
  const toolResultMsg = client.calls[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'ls1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('studio_1'))
})

test('get_studio is wired, owner-scoped, and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const auctor = { animaId: 'anima_owner' }
  const client = scriptedClient([
    chatResult({
      toolCalls: [{ id: 'gs1', name: 'get_studio', arguments: JSON.stringify({ id: 'studio_1' }) }],
      finishReason: 'tool_calls',
    }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'studio_1 is ready' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx({ auctor }), 'is studio_1 ready?')

  assert.equal(spy.getStudioCalls.length, 1)
  assert.deepEqual(spy.getStudioCalls[0], { auctor, id: 'studio_1' })
  const toolResultMsg = client.calls[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'gs1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('studio_1'))
})

test('list_fundamenta is wired and its result reaches the model', async () => {
  const { api, spy } = makeApi()
  const client = scriptedClient([
    chatResult({ toolCalls: [{ id: 'lf1', name: 'list_fundamenta', arguments: '{}' }], finishReason: 'tool_calls' }),
    chatResult({ content: JSON.stringify({ kind: 'reply', text: 'flux is available' }) }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'what base models can I provision?')

  assert.equal(spy.listFundamentaCalls, 1)
  const toolResultMsg = client.calls[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === 'lf1')
  assert.ok(toolResultMsg)
  assert.ok(String(toolResultMsg!.content).includes('flux'))
})

// ---------------------------------------------------------------------------
// (f) Hitting maxToolIterations terminates, bounded: the tool loop runs exactly
// the cap, then EXACTLY ONE closing call. No re-entry, no unbounded spin.
// ---------------------------------------------------------------------------
test('hitting maxToolIterations terminates after exactly one closing call', async () => {
  const { api } = makeApi()
  // Always returns a tool call — never a final answer. The closing call gets the
  // same scripted response; its tool calls must be ignored, not executed.
  const client = scriptedClient([
    chatResult({ ...listFlowsCall, tokenUsage: { totalTokens: 1 } }),
  ])

  const result = await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'loop forever')

  assert.equal(result.kind, 'reply')
  // Bounded — the cap's worth of tool turns plus the single closing call, no more.
  assert.equal(client.count(), maxToolIterations + 1)
  assert.equal(result.tokenUsage.totalTokens, maxToolIterations + 1) // summed 1 per call
})

// ---------------------------------------------------------------------------
// (f2) noema-363: reaching the cap with context already gathered does NOT discard
// that work. The agent asks the model once more with tools disabled and returns
// THAT answer; the fixed reply is only the fallback.
// ---------------------------------------------------------------------------
test('cap reached with gathered context: the closing call answers, tools disabled', async () => {
  const { api, spy } = makeApi()
  const proposalJson = JSON.stringify({
    kind: 'proposal',
    modusId: 'flux.txt2img',
    aditus: { prompt: 'a neon alley' },
    pinnedModels: [],
    embellishedPrompt: 'a neon alley, rain-slick, cinematic',
    rationale: 'the option you picked, priced at 100 impetus',
  })
  // The first maxToolIterations responses churn on tool calls; the closing call
  // (response index maxToolIterations) finally answers.
  const client = scriptedClient([
    ...Array.from({ length: maxToolIterations }, () =>
      chatResult({ ...listFlowsCall, tokenUsage: { totalTokens: 1 } }),
    ),
    chatResult({ content: proposalJson, tokenUsage: { totalTokens: 7 } }),
  ])

  const result = await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'option one, please')

  // The gathered work became an answer, not the canned string.
  assert.equal(result.kind, 'proposal')
  if (result.kind !== 'proposal') return
  assert.equal(result.modusId, 'flux.txt2img')
  assert.equal(result.embellishedPrompt, 'a neon alley, rain-slick, cinematic')
  assert.equal(spy.quoteCalls.length, 1) // finalize ran: the authoritative quote was computed
  assert.equal(result.tokenUsage.totalTokens, maxToolIterations + 7) // closing call is metered

  // Exactly one closing call, and it carried NO tool surface — the cap's invariant
  // survives: the closing call cannot invoke a tool.
  assert.equal(client.count(), maxToolIterations + 1)
  const closingCall = client.calls[maxToolIterations]
  assert.ok(
    closingCall.tools === undefined || closingCall.tools.length === 0,
    'the closing call must carry no tools',
  )
  // ...and it carried the accumulated history plus an explicit close-out instruction.
  const closingRoles = closingCall.messages.map((m) => m.role)
  assert.ok(closingRoles.includes('tool'), 'the closing call keeps the gathered tool results')
  const last = closingCall.messages[closingCall.messages.length - 1]
  assert.equal(last.role, 'system')
  assert.equal(last.content, FORCED_FINAL_INSTRUCTION)
})

// ---------------------------------------------------------------------------
// (f3) The closing call cannot reach a tool even if the model asks for one: with
// tools omitted, any tool_calls on its response are ignored, never executed.
// ---------------------------------------------------------------------------
test('tool calls returned by the closing call are ignored, not executed', async () => {
  const { api, spy } = makeApi()
  const client = scriptedClient([
    ...Array.from({ length: maxToolIterations }, () =>
      chatResult({
        toolCalls: [{ id: 'm1', name: 'search_models', arguments: '{"q":"neon"}' }],
        finishReason: 'tool_calls',
        tokenUsage: { totalTokens: 1 },
      }),
    ),
    // The closing call answers AND asks for another tool it was not given.
    chatResult({
      content: JSON.stringify({ kind: 'reply', text: 'Which of the two do you want?' }),
      toolCalls: [{ id: 'm2', name: 'search_models', arguments: '{"q":"neon"}' }],
      tokenUsage: { totalTokens: 1 },
    }),
  ])

  const result = await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'something neon')

  assert.equal(result.kind, 'reply')
  if (result.kind !== 'reply') return
  assert.equal(result.text, 'Which of the two do you want?')
  // Only the in-loop searches ran; the closing call's tool request executed nothing.
  assert.equal(spy.listModelsCalls.length, maxToolIterations)
  assert.equal(client.count(), maxToolIterations + 1) // and no re-entry into the loop
})

// ---------------------------------------------------------------------------
// (f4) The fixed reply survives as the fallback: a closing call that throws still
// terminates the turn with something addressed to the user.
// ---------------------------------------------------------------------------
test('a failing closing call falls back to the fixed reply', async () => {
  const { api } = makeApi()
  let calls = 0
  const runToolChat: ConciergeDeps['runToolChat'] = async () => {
    calls++
    if (calls > maxToolIterations) throw new Error('upstream unavailable')
    return chatResult({ ...listFlowsCall, tokenUsage: { totalTokens: 1 } })
  }

  const result = await runConcierge(baseDeps(runToolChat, api), baseCtx(), 'loop forever')

  assert.equal(result.kind, 'reply')
  if (result.kind !== 'reply') return
  assert.match(result.text, /allotted steps/)
  assert.equal(calls, maxToolIterations + 1) // the failure is not retried
  assert.equal(result.tokenUsage.totalTokens, maxToolIterations)
})

// ---------------------------------------------------------------------------
// (f5) noema-363: the system prompt tells the model to reply in the user's
// language. Prompt text only — this asserts the instruction is present, not the
// model's actual behavior (untestable without a live LLM).
// ---------------------------------------------------------------------------
test('system prompt instructs replying in the language the user writes in', () => {
  const prompt = buildSystemPrompt(baseCtx())
  assert.match(prompt, /Reply in the language the user is writing in/)
})

// ---------------------------------------------------------------------------
// (f6) noema-363: the system prompt discourages re-searching the catalog, which
// is what spent the tool budget before a proposal could be made.
// ---------------------------------------------------------------------------
test('system prompt discourages repeating a search already run', () => {
  const prompt = buildSystemPrompt(baseCtx())
  assert.match(prompt, /Read the catalog ONCE/)
  assert.match(prompt, /prefer proposing over searching again/)
})

// ---------------------------------------------------------------------------
// (g) The critique/adjusted case is a proposal-kind result carrying priorRunId + delta.
// ---------------------------------------------------------------------------
test('critique case yields a proposal carrying priorRunId and delta, not a new kind', async () => {
  const { api } = makeApi()
  const priorRun = {
    id: 'run_prior_1',
    status: 'completus',
    modusId: 'flux.txt2img',
    aditus: { prompt: 'a fox', steps: 20 },
  } as unknown as Run

  const proposalJson = JSON.stringify({
    kind: 'proposal',
    modusId: 'flux.txt2img',
    aditus: { prompt: 'a fox', steps: 35 },
    pinnedModels: [],
    embellishedPrompt: 'a fox, more detail',
    rationale: 'bumped steps for sharper output',
    delta: 'increased steps 20 -> 35 for more detail',
  })
  const client = scriptedClient([chatResult({ content: proposalJson })])

  const result = await runConcierge(
    baseDeps(client.runToolChat, api),
    baseCtx({ priorRun }),
    'sharper please',
  )

  assert.equal(result.kind, 'proposal')
  if (result.kind !== 'proposal') return
  assert.equal(result.priorRunId, 'run_prior_1')
  assert.equal(result.delta, 'increased steps 20 -> 35 for more detail')
})

// ---------------------------------------------------------------------------
// (h) REGRESSION (noema-102): the echoed assistant tool_calls on the NEXT
// request must carry the OpenAI/OpenRouter WIRE shape ({id, type: 'function',
// function: {name, arguments}}), not the client's friendly parsed shape
// ({id, name, arguments}) — echoing the friendly shape verbatim is what 400s
// every real staging turn (`messages[].tool_calls[].type` missing). The
// following `tool` result message must carry a matching `tool_call_id`.
// ---------------------------------------------------------------------------
test('the outgoing assistant tool_calls on the next request carry the wire shape', async () => {
  const { api } = makeApi()
  const client = scriptedClient([
    chatResult({ ...listFlowsCall, tokenUsage: { totalTokens: 1 } }),
    chatResult({ content: 'ok', tokenUsage: { totalTokens: 1 } }),
  ])

  await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'make me a fox')

  // client.calls[1] is what the SECOND runToolChat call received — the request
  // that carries the echoed history from the first tool-call turn.
  const secondCallMessages = client.calls[1].messages
  const assistantMsg = secondCallMessages.find((m) => m.role === 'assistant' && m.tool_calls?.length)
  assert.ok(assistantMsg, 'expected an assistant message carrying tool_calls in the echoed history')
  const toolCalls = assistantMsg!.tool_calls as unknown as Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  assert.equal(toolCalls[0].id, 'c1')
  assert.equal(toolCalls[0].type, 'function')
  assert.deepEqual(toolCalls[0].function, { name: 'list_flows', arguments: '{}' })

  const toolResultMsg = secondCallMessages.find((m) => m.role === 'tool' && m.tool_call_id === 'c1')
  assert.ok(toolResultMsg, 'expected a tool-role result message with matching tool_call_id')
})

// ---------------------------------------------------------------------------
// (i) noema-361: the system prompt instructs the model to price a proposal's
// rationale plainly — the quote gym found rationale text that never named a
// cost. Prompt text only; this asserts the instruction is present, not the
// model's actual behavior (untestable without a live LLM).
// ---------------------------------------------------------------------------
test('system prompt instructs the rationale to state the price plainly', () => {
  const prompt = buildSystemPrompt(baseCtx())
  assert.match(prompt, /state that\s+price plainly/)
})
