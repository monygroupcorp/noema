import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  runConcierge,
  maxToolIterations,
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
}

function makeApi(): { api: CrystalApi; spy: ApiSpy } {
  const spy: ApiSpy = { listModelsCalls: [], quoteCalls: [], listFlowsCalls: 0 }
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
  assert.deepEqual(names.sort(), ['describe_flow', 'list_flows', 'quote', 'search_models'])
  for (const spend of ['run_flow', 'provision_studio', 'collect', 'runFlow', 'invokeFlow']) {
    assert.ok(!names.includes(spend), `spend tool ${spend} must not be exposed`)
  }
})

// ---------------------------------------------------------------------------
// (f) Hitting maxToolIterations terminates with a reply, not an infinite loop.
// ---------------------------------------------------------------------------
test('hitting maxToolIterations terminates with a reply', async () => {
  const { api } = makeApi()
  // Always returns a tool call — never a final answer.
  const client = scriptedClient([
    chatResult({ ...listFlowsCall, tokenUsage: { totalTokens: 1 } }),
  ])

  const result = await runConcierge(baseDeps(client.runToolChat, api), baseCtx(), 'loop forever')

  assert.equal(result.kind, 'reply')
  assert.equal(client.count(), maxToolIterations) // bounded — exactly the cap, no more
  assert.equal(result.tokenUsage.totalTokens, maxToolIterations) // summed 1 per call
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
