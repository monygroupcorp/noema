#!/usr/bin/env -S npx tsx
// =============================================================================
// concierge-eval — dev-only ConciergeAgent (noema-094) eval harness
// =============================================================================
//
// Runs a curated set of representative user asks through the REAL, merged
// ConciergeAgent, wired against the REAL canonical seed catalog (src/crystal/seeds
// — not a live staging DB, not a hand-faked fixture) and REAL, LIVE OpenRouter
// (src/allocutio/api/OpenRouterToolClient.ts's runToolChat — no mock). It prints
// one structured, human-scannable report per ask (chosen kind, flow/modusId,
// embellishedPrompt, pinnedModels, rationale, quote, tokenUsage, and the raw
// tool-call trace) so the operator can tune ConciergeAgent's system prompt and
// the flow/model catalog with EVIDENCE instead of vibes: run it, see where it
// mis-routes, fix the prompt/catalog, re-run.
//
//   OPENROUTER_API_KEY=sk-... npx tsx scripts/concierge-eval.ts
//
// ⚠️  WARNING: this makes REAL, BILLED calls to OpenRouter — one live LLM
//     tool-use loop (up to `maxToolIterations` round-trips) per ASK_SET entry.
//     It is non-deterministic and costs real tokens. It is a manual dev tool
//     ONLY — it never enters `test:hermetic`, is never wired into any HTTP
//     route, and never exposes/calls a spend method (see the invariant below).
//
// Catalog data source (per noema-098's Decision record Q1): the REAL canonical
// seed data under `src/crystal/seeds` — CANONICAL_ESSENTIAE, CANONICAL_COMPOSITI,
// CANONICAL_CUSTOM_MODI (flows) and CANONICAL_INTELLAE (models), loaded straight
// into in-memory registries. Not live staging, not a hand-picked fixture — the
// same seed data `scripts/crystal/seed-canon.ts` writes to the staging DB, just
// held in-process instead of persisted.
//
// HARD INVARIANT (mirrors ConciergeAgent's own, mechanically enforced by this
// item's `verify` grep): this script never exposes or calls any spend-tool
// handler or spend-dispatch method anywhere below. It only ever reaches
// ConciergeAgent's four read-only discovery tools (list_flows, describe_flow,
// search_models, quote) via the real runConcierge loop.
// =============================================================================

import {
  runConcierge,
  type ConciergeDeps,
  type ConciergeContext,
} from '../src/allocutio/api/ConciergeAgent.js'
import {
  httpApiTransport,
  runToolChat,
} from '../src/allocutio/api/OpenRouterToolClient.js'
// The seeded in-memory catalog and the tool-call trace shim live in
// `concierge-harness.ts` so this script and `concierge-gym.ts` share one builder.
import {
  buildSeededCrystalApi,
  tracedRunToolChat,
  type TraceEntry,
} from './concierge-harness.js'

// -----------------------------------------------------------------------------
// ASK_SET — curated, operator-extensible representative asks (noema-098 Decision
// record). Do NOT remove entries; add more as needed for future tuning passes.
// -----------------------------------------------------------------------------
export const ASK_SET: Array<{ label: string; message: string }> = [
  { label: 'hot chick',            message: 'make me a hot chick' },
  { label: 'anime girl w/ sword',  message: 'anime girl with a sword' },
  { label: 'cinematic dragon',     message: 'cinematic dragon shot' },
  { label: 'remove background',    message: 'remove the background' },
  { label: 'watercolor (style)',   message: 'watercolor' },
  { label: 'short rain video',     message: 'short rain video' },
  { label: 'photoreal portrait',   message: 'photorealistic portrait' },
  { label: 'cyberpunk (style)',    message: 'cyberpunk' },
]

// -----------------------------------------------------------------------------
// Report printing — one human-scannable block per ask.
// -----------------------------------------------------------------------------
function printReport(label: string, message: string, trace: TraceEntry[], result: Awaited<ReturnType<typeof runConcierge>> | { error: string }): void {
  console.log('')
  console.log('='.repeat(78))
  console.log(`ASK: ${label}  →  "${message}"`)
  console.log('='.repeat(78))

  if ('error' in result) {
    console.log(`  ERROR: ${result.error}`)
    return
  }

  console.log(`  kind: ${result.kind}`)
  if (result.kind === 'proposal') {
    const target = result.modusId ? `modusId=${result.modusId}` : `verb=${result.verb}`
    console.log(`  flow: ${target}`)
    console.log(`  sensibility: does "${target}" plausibly match "${message}"? (human judgment call)`)
    console.log(`  embellishedPrompt: ${result.embellishedPrompt}`)
    console.log(`  pinnedModels: ${JSON.stringify(result.pinnedModels)}`)
    console.log(`  rationale: ${result.rationale}`)
    console.log(`  quote: ${JSON.stringify(result.quote)}`)
    if (result.priorRunId) console.log(`  priorRunId: ${result.priorRunId}`)
    if (result.delta) console.log(`  delta: ${result.delta}`)
  } else {
    console.log(`  text: ${result.text}`)
  }
  console.log(`  tokenUsage: ${JSON.stringify(result.tokenUsage)}`)
  console.log(`  tool trace (${trace.length} call${trace.length === 1 ? '' : 's'}):`)
  for (const t of trace) {
    console.log(`    - ${t.tool}(${t.arguments})`)
  }
}

// -----------------------------------------------------------------------------
// Main — sequential run over ASK_SET (not Promise.all: keeps output readable,
// avoids hammering OpenRouter's rate limit). One failing ask never aborts the run.
// -----------------------------------------------------------------------------
async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('concierge-eval: OPENROUTER_API_KEY is not set. Run:')
    console.error('  OPENROUTER_API_KEY=sk-... npx tsx scripts/concierge-eval.ts')
    process.exit(1)
  }

  const api = await buildSeededCrystalApi()
  const flows = await api.listFlows()
  console.log(`Seeded catalog: ${flows.length} canonical flow(s).`)
  for (const f of flows) console.log(`  - ${f.id} (${f.nomen}, ${f.modusGenus ?? 'no-verb'})`)

  for (const { label, message } of ASK_SET) {
    const trace: TraceEntry[] = []
    const deps: ConciergeDeps = {
      runToolChat: tracedRunToolChat(runToolChat, trace),
      toolClient: { http: httpApiTransport, apiKey },
      api,
    }
    const ctx: ConciergeContext = {
      auctor: { animaId: 'concierge-eval-harness' },
      spicyMode: false,
      history: [], // fresh, empty conversation history per ask — single-turn only
    }

    try {
      const result = await runConcierge(deps, ctx, message)
      printReport(label, message, trace, result)
    } catch (e) {
      printReport(label, message, trace, { error: String(e) })
    }
  }
}

main().catch((e) => {
  console.error('concierge-eval: fatal error', e)
  process.exit(1)
})
