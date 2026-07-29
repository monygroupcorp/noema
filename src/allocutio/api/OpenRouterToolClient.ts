// =============================================================================
// OpenRouterToolClient — tool-call-aware OpenRouter chat client
// =============================================================================
//
// ApiCursor.runChat (src/crystal/ApiCursor.ts) is a sync, non-tool-calling chat
// path by documented design: it never sends `tools` and only reads
// `choices[0].message.content` + `usage.total_tokens`. This module is the
// missing, additive tool-calling client the upcoming ConciergeAgent tool-use
// loop needs to import: it sends `tools[]` and parses back `tool_calls`,
// `finish_reason`, and token usage. Non-streaming only.
//
// This module does not wire into any construction site, container, or agent
// loop, and it does not implement metering/settlement — it only reports
// tokenUsage on its return value for a caller to consume.
// =============================================================================

import type { ApiHttp } from '../../crystal/ApiCursor.js'
import { httpApiTransport } from '../../crystal/ApiCursor.js'
import { OPENROUTER_PROVIDER } from '../../crystal/apiProviders.js'

export { httpApiTransport }

export interface OpenRouterToolCall {
  id: string
  name: string
  arguments: string   // raw JSON string exactly as the API returned it — this client does NOT
                       // JSON.parse it; a malformed-arguments string is the caller's concern (094),
                       // not this client's, per DOCTRINE §2 (never guess on the caller's behalf)
}

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string              // required when role === 'tool' (OpenAI-compatible wire shape)
  tool_calls?: OpenRouterToolCall[]  // present on a prior assistant turn that made tool calls,
                                      // for multi-turn tool-loop history
}

export interface OpenRouterToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>   // JSON Schema, caller-supplied
  }
}

export interface OpenRouterChatResult {
  content?: string
  toolCalls?: OpenRouterToolCall[]   // undefined (not []) when the response made no tool calls
  finishReason: string               // e.g. 'stop' | 'tool_calls' | 'length' — passed through verbatim,
                                      // not narrowed to a union (OpenRouter is multi-vendor; do not
                                      // assume the full enum space)
  tokenUsage: {
    totalTokens: number
    promptTokens?: number
    completionTokens?: number
  }
}

export interface OpenRouterToolClientDeps {
  http: ApiHttp     // the SAME injectable transport interface ApiCursor.ts uses — reuse it, do not
                     // redeclare an equivalent interface
  apiKey: string     // resolved by the CALLER (from OPENROUTER_API_KEY); this module never reads
                      // process.env itself, matching ApiCursor's own DI seam
}

export interface OpenRouterToolChatOpts {
  model?: string                    // falls back to OPENROUTER_PROVIDER.capabilities.chat.defaultModel
  messages: OpenRouterChatMessage[]
  tools?: OpenRouterToolSpec[]      // omit the `tools` key from the request body entirely when this
                                     // is undefined or empty — do not send `tools: []`
  temperature?: number              // omit the `temperature` key when undefined (mirrors ApiCursor's
                                     // own `if (aditus.temperature !== undefined)` pattern)
}

interface OpenRouterChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    }
    finish_reason?: string
  }>
  usage?: {
    total_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
}

/**
 * Send a tool-call-aware OpenRouter chat-completions request and parse back
 * content, tool calls, finish reason, and token usage.
 */
export async function runToolChat(
  deps: OpenRouterToolClientDeps,
  opts: OpenRouterToolChatOpts,
): Promise<OpenRouterChatResult> {
  const spec = OPENROUTER_PROVIDER.capabilities.chat!
  const url = `${OPENROUTER_PROVIDER.baseUrl}${spec.path}`

  const body: Record<string, unknown> = {
    model: opts.model ?? spec.defaultModel,
    messages: opts.messages,
  }
  if (opts.tools?.length) body.tools = opts.tools
  if (opts.temperature !== undefined) body.temperature = opts.temperature

  const res = await deps.http.postJson(url, deps.apiKey, body) as OpenRouterChatCompletionResponse

  const choice = res.choices?.[0]
  if (!choice) {
    throw new Error('OpenRouterToolClient: response carried no choices[0]')
  }

  const content = choice.message?.content || undefined
  const rawToolCalls = choice.message?.tool_calls
  const toolCalls = rawToolCalls?.length
    ? rawToolCalls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }))
    : undefined
  const finishReason = choice.finish_reason ?? ''

  return {
    content,
    toolCalls,
    finishReason,
    tokenUsage: {
      totalTokens: res.usage?.total_tokens ?? 0,
      promptTokens: res.usage?.prompt_tokens,
      completionTokens: res.usage?.completion_tokens,
    },
  }
}
