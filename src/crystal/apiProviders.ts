// =============================================================================
// apiProviders — declarative descriptors for hosted-API inference providers
// =============================================================================
//
// A `Cursor` per third-party API used to mean a bespoke class each. This makes
// providers DATA instead: OpenAI, OpenRouter, and most inference vendors speak
// the SAME OpenAI-compatible `/chat/completions` wire format, so "chat" is a
// generic capability every descriptor gets for free. Image generation / editing
// are OpenAI-specific capabilities a descriptor opts into.
//
// Adding a new OpenAI-compatible provider (blocker #12's whole point) is now:
//   1. add a descriptor here
//   2. set its `authEnv` key in the environment
//   3. seed a modus with `ministerium: <provider.id>`
// No new Cursor class. See ApiCursor.ts for the single cursor these drive.
// =============================================================================

import { MICRO_USD_PER_IMPETUS } from '../ledger/rates.js'

/** The three capabilities a hosted-API provider can serve. */
export type ApiCapability = 'chat' | 'image' | 'imageEdit'

/** One capability's endpoint + default model. */
export interface ApiCapabilitySpec {
  /** Path appended to `baseUrl`, e.g. '/chat/completions'. */
  path: string
  /** Model used when the aditus does not name one. */
  defaultModel: string
}

/**
 * Token/image → impetus rates for a provider. impetus is an integer (bigint),
 * so chat is metered per 1,000 tokens to keep sub-unit granularity, then
 * ceil-divided. The `run()` result is always clamped to the reserved cap, so
 * these are upper-honest estimates, not exact vendor invoices.
 */
export interface ApiPricing {
  /** Chat: impetus charged per 1,000 tokens (prompt + completion). */
  chatImpetusPer1kTokens?: bigint
  /**
   * Image gen / edit, OpenAI's own billing unit — micro-USD per token, by token kind
   * (its `usage` response reports them separately: text prompt tokens, input image tokens
   * on an edit, and output image tokens, which dominate the cost and vary by orders of
   * magnitude with `quality`/`size`). Converted to impetus via `MICRO_USD_PER_IMPETUS`
   * (`imageTokenImpetus`), the same way chat tokens convert via `chatImpetusPer1kTokens` —
   * a per-token rate so the charge tracks what the vendor actually billed, not a flat guess.
   */
  imageTextInputMicroUsdPerToken?: bigint
  imageInputMicroUsdPerToken?: bigint
  imageOutputMicroUsdPerToken?: bigint
}

/** Token usage an OpenAI image response reports, by kind. Absent/zero kinds cost nothing. */
export interface ImageTokenUsage {
  textInputTokens?: number
  imageInputTokens?: number
  outputTokens?: number
}

/** A hosted-API provider — the unit the ApiCursor is bound to. */
export interface ApiProvider {
  /** == ministerium key on the modi it serves ('openai' | 'openrouter' | …). */
  id: string
  /** API root, e.g. 'https://api.openai.com/v1'. Capability paths append to it. */
  baseUrl: string
  /** Env var holding the bearer key. Resolved by the container, never read here. */
  authEnv: string
  /** Which capabilities this provider serves. Chat is the generic OpenAI-compatible one. */
  capabilities: Partial<Record<ApiCapability, ApiCapabilitySpec>>
  pricing: ApiPricing
}

// ── OpenAI — chat + image gen + image edit ─────────────────────────────────
export const OPENAI_PROVIDER: ApiProvider = {
  id: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  authEnv: 'OPENAI_API_KEY',
  capabilities: {
    chat:      { path: '/chat/completions', defaultModel: 'gpt-4o' },
    // Flare: OpenAI's fast/general text-to-image lane — the right default for a one-shot
    // generation with no prior art to match. Sunburst: the quality/consistency lane, which is
    // what an edit needs (it is reworking a specific existing image, not drawing from scratch).
    // Both superseded gpt-image-1 on 2026-11-04 (gpt-image-2.6, OpenAI's current image family).
    image:     { path: '/images/generations', defaultModel: 'gpt-image-2.6-flare' },
    imageEdit: { path: '/images/edits', defaultModel: 'gpt-image-2.6-sunburst' },
  },
  pricing: {
    chatImpetusPer1kTokens: 3n,
    // OpenAI's published gpt-image-2.6 per-token rates (both Flare and Sunburst, same table):
    // text input $5/1M tokens, image input $8/1M, image output $30/1M → micro-USD/token.
    imageTextInputMicroUsdPerToken: 5n,
    imageInputMicroUsdPerToken:     8n,
    imageOutputMicroUsdPerToken:    30n,
  },
}

// ── OpenRouter — proves the descriptor generalizes: chat only, zero new code ─
export const OPENROUTER_PROVIDER: ApiProvider = {
  id: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  authEnv: 'OPENROUTER_API_KEY',
  capabilities: {
    chat: { path: '/chat/completions', defaultModel: 'qwen/qwen3.8-27b' },
  },
  pricing: {
    chatImpetusPer1kTokens: 3n,
  },
}

// ── Venice — OpenAI-compatible, chat only (noema-144) ───────────────────────
export const VENICE_PROVIDER: ApiProvider = {
  id: 'venice',
  baseUrl: 'https://api.venice.ai/api/v1',
  authEnv: 'VENICE_API_KEY',
  capabilities: {
    chat: { path: '/chat/completions', defaultModel: 'llama-3.3-70b' },
  },
  pricing: {
    chatImpetusPer1kTokens: 3n,
  },
}

/** All known provider descriptors. The container registers those whose key is set. */
export const API_PROVIDERS: ApiProvider[] = [OPENAI_PROVIDER, OPENROUTER_PROVIDER, VENICE_PROVIDER]

/**
 * The exact chat-token → impetus metering formula: `ceil(tokens × per1k / 1000)`.
 *
 * Extracted as a pure function so BOTH the run rail (`ApiCursor.meterChat`, serving
 * `/chat` and `/runs`) and the concierge per-turn direct-settle path (noema-095) charge
 * IDENTICALLY off the same arithmetic — a single source of truth for the price of a chat
 * turn. Never under-charges on the sub-unit remainder (ceil). `per1k` unset / `0n`, or
 * `tokens <= 0`, → `0n`.
 */
export function chatImpetus(tokens: number, per1k: bigint | undefined): bigint {
  const rate = per1k ?? 0n
  if (rate === 0n || tokens <= 0) return 0n
  return (BigInt(tokens) * rate + 999n) / 1000n
}

/**
 * Image gen/edit metering: usage tokens (by kind) → impetus, at the provider's real per-token
 * USD rate — the counterpart to `chatImpetus` for the image rail. A flat per-image charge
 * cannot bound this: OpenAI's `quality`/`size` span roughly a 100x range in output tokens, so
 * it either overcharges the cheap end badly or undercharges the expensive end — exactly the
 * gap this closes by reading what the vendor actually billed off `usage` instead of guessing
 * a flat rate for "an image".
 * Each token kind is converted to micro-USD, ceil-divided to impetus via
 * `MICRO_USD_PER_IMPETUS` (never under-charges on the sub-unit remainder, same as `chatImpetus`),
 * then summed. A kind with no usage or no configured rate costs 0.
 */
export function imageTokenImpetus(usage: ImageTokenUsage, pricing: ApiPricing): bigint {
  const part = (tokens: number | undefined, microUsdPerToken: bigint | undefined): bigint => {
    const rate = microUsdPerToken ?? 0n
    const n = tokens ?? 0
    if (rate === 0n || n <= 0) return 0n
    const microUsd = BigInt(n) * rate
    return (microUsd + MICRO_USD_PER_IMPETUS - 1n) / MICRO_USD_PER_IMPETUS
  }
  return (
    part(usage.textInputTokens, pricing.imageTextInputMicroUsdPerToken) +
    part(usage.imageInputTokens, pricing.imageInputMicroUsdPerToken) +
    part(usage.outputTokens, pricing.imageOutputMicroUsdPerToken)
  )
}
