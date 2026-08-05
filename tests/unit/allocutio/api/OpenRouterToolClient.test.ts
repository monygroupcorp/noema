// =============================================================================
// OpenRouterToolClient — hermetic facade test (fake ApiHttp, no network)
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runToolChat, type OpenRouterToolClientDeps, type OpenRouterToolChatOpts } from '../../../../src/allocutio/api/OpenRouterToolClient.js'
import { OPENROUTER_PROVIDER } from '../../../../src/crystal/apiProviders.js'
import type { ApiHttp } from '../../../../src/crystal/ApiCursor.js'

/** A fake transport that records the last request and returns canned JSON. */
function fakeHttp(response: unknown): ApiHttp & { lastJson?: { url: string; body: any } } {
  const rec: any = {
    async postJson(url: string, _key: string, body: unknown) { rec.lastJson = { url, body }; return response },
    async postForm() { throw new Error('unused') },
  }
  return rec
}

function deps(http: ApiHttp): OpenRouterToolClientDeps {
  return { http, apiKey: 'sk-test' }
}

const baseOpts: OpenRouterToolChatOpts = {
  messages: [{ role: 'user', content: 'hi' }],
}

// ── content, no tool calls ──────────────────────────────────────────────────

test('response with content and no tool_calls maps to content, toolCalls undefined, finishReason stop', async () => {
  const http = fakeHttp({
    choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
    usage: { total_tokens: 42 },
  })
  const result = await runToolChat(deps(http), baseOpts)
  assert.equal(result.content, 'Hello!')
  assert.equal(result.toolCalls, undefined)
  assert.equal(result.finishReason, 'stop')
})

// ── tool calls present ──────────────────────────────────────────────────────

test('response with tool_calls maps each entry and sets finishReason tool_calls', async () => {
  const http = fakeHttp({
    choices: [{
      message: {
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"a"}' } },
          { id: 'call_2', type: 'function', function: { name: 'search', arguments: '{"q":"b"}' } },
        ],
      },
      finish_reason: 'tool_calls',
    }],
    usage: { total_tokens: 10 },
  })
  const result = await runToolChat(deps(http), baseOpts)
  assert.equal(result.finishReason, 'tool_calls')
  assert.deepEqual(result.toolCalls, [
    { id: 'call_1', name: 'lookup', arguments: '{"q":"a"}' },
    { id: 'call_2', name: 'search', arguments: '{"q":"b"}' },
  ])
})

// ── token usage extraction ──────────────────────────────────────────────────

test('tokenUsage reads total/prompt/completion tokens from res.usage', async () => {
  const http = fakeHttp({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 },
  })
  const result = await runToolChat(deps(http), baseOpts)
  assert.equal(result.tokenUsage.totalTokens, 100)
  assert.equal(result.tokenUsage.promptTokens, 60)
  assert.equal(result.tokenUsage.completionTokens, 40)
})

test('tokenUsage.totalTokens defaults to 0 when usage is absent', async () => {
  const http = fakeHttp({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  const result = await runToolChat(deps(http), baseOpts)
  assert.equal(result.tokenUsage.totalTokens, 0)
  assert.equal(result.tokenUsage.promptTokens, undefined)
  assert.equal(result.tokenUsage.completionTokens, undefined)
})

// ── request body shape ──────────────────────────────────────────────────────

test('omitted/empty tools ⇒ no tools key in posted body', async () => {
  const http = fakeHttp({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  await runToolChat(deps(http), { ...baseOpts, tools: [] })
  assert.equal('tools' in (http.lastJson!.body as object), false)

  const http2 = fakeHttp({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  await runToolChat(deps(http2), baseOpts)
  assert.equal('tools' in (http2.lastJson!.body as object), false)
})

test('present tools ⇒ posted body tools key equals it verbatim', async () => {
  const http = fakeHttp({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  const tools = [{ type: 'function' as const, function: { name: 'lookup', description: 'look things up', parameters: {} } }]
  await runToolChat(deps(http), { ...baseOpts, tools })
  assert.deepEqual(http.lastJson!.body.tools, tools)
})

test('omitted model ⇒ posted model equals OPENROUTER_PROVIDER default model', async () => {
  const http = fakeHttp({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  await runToolChat(deps(http), baseOpts)
  assert.equal(http.lastJson!.body.model, OPENROUTER_PROVIDER.capabilities.chat!.defaultModel)
})

test('omitted temperature ⇒ no temperature key in posted body', async () => {
  const http = fakeHttp({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
  await runToolChat(deps(http), baseOpts)
  assert.equal('temperature' in (http.lastJson!.body as object), false)
})

// ── no choices[0] ────────────────────────────────────────────────────────────

test('response with no choices[0] throws', async () => {
  const http = fakeHttp({ choices: [] })
  await assert.rejects(() => runToolChat(deps(http), baseOpts), /choices/i)
})
