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
  type OpenRouterToolClientDeps,
  type OpenRouterToolChatOpts,
  type OpenRouterChatResult,
} from '../src/allocutio/api/OpenRouterToolClient.js'
import { CrystalApi, type CrystalApiDeps } from '../src/allocutio/api/CrystalApi.js'
import { OPENROUTER_PROVIDER } from '../src/crystal/apiProviders.js'
import { RunPodCursor, type RunPodClient } from '../src/crystal/RunPodCursor.js'
import { ApiCursor } from '../src/crystal/ApiCursor.js'
import { FfmpegCursor } from '../src/crystal/FfmpegCursor.js'
import { LayerCompositeCursor } from '../src/crystal/LayerCompositeCursor.js'
import { AitoolkitTrainingCursor } from '../src/crystal/AitoolkitTrainingCursor.js'
import { Cursorum } from '../src/execution/Cursorum.js'
import { MemoryModorum } from '../src/execution/MemoryModorum.js'
import { MemoryActorum } from '../src/execution/MemoryActorum.js'
import { hashModus } from '../src/crystal/hashModus.js'
import { CANONICAL_ESSENTIAE } from '../src/crystal/seeds/essentiae.js'
import { CANONICAL_COMPOSITI } from '../src/crystal/seeds/compositi.js'
import { CANONICAL_CUSTOM_MODI } from '../src/crystal/seeds/modiCustom.js'
import { CANONICAL_INTELLAE } from '../src/crystal/seeds/intellae.js'
import type { Intella, Intellae, IntellaGenus, Intellarum } from '../src/types/intelligendi.js'

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
// In-memory Intellarum — the models registry `CrystalApi.listModels` needs.
// No repo implementation exists in-memory (only MongoIntella); this is a
// minimal, honest adapter over CANONICAL_INTELLAE implementing the real
// `Intellarum` contract (src/types/intelligendi.ts), scoped to this script.
// -----------------------------------------------------------------------------
class MemoryIntellarum implements Intellarum {
  private readonly byId = new Map<string, Intella>(CANONICAL_INTELLAE.map((i) => [i.id, i]))

  async find(id: string): Promise<Intella | null> {
    return this.byId.get(id) ?? null
  }
  async list(genus?: IntellaGenus): Promise<Intellae> {
    const all = Array.from(this.byId.values())
    return genus ? all.filter((i) => i.genus === genus) : all
  }
  async canonical(): Promise<Intellae> {
    return Array.from(this.byId.values()).filter((i) => i.canonica)
  }
}

// -----------------------------------------------------------------------------
// Real seeded canonical catalog → in-memory CrystalApi deps (noema-098 Decision
// record Q1). Mirrors scripts/crystal/seed-canon.ts's registration order
// (essentiae → compositi → custom modi) but into MemoryModorum instead of a
// Mongo-backed one, and needs no DB connection.
// -----------------------------------------------------------------------------
async function buildSeededCrystalApi(): Promise<CrystalApi> {
  const modorum = new MemoryModorum()
  for (const essentia of CANONICAL_ESSENTIAE) {
    await modorum.register({ ...essentia, contentHash: hashModus(essentia) })
  }
  for (const compositus of CANONICAL_COMPOSITI) {
    await modorum.register({ ...compositus, contentHash: hashModus(compositus) })
  }
  for (const customModus of CANONICAL_CUSTOM_MODI) {
    await modorum.register({ ...customModus, contentHash: hashModus(customModus) })
  }

  // Cursors — ONLY `reserve()` is ever invoked by `CrystalApi.quote` (the read-only
  // upper-bound estimate ConciergeAgent's `quote` tool calls); every cursor below
  // reserves via `modus.impetusFixum ?? <cheap default>`, per each Cursor class's
  // own source (two-phase reserve()/run() contract, src/types/cursus.ts). `run()`
  // is never called by this harness (it never spends), so its heavier deps
  // (RunPod client, ffmpeg engine, R2 uploader, …) are deliberately unused stubs —
  // real for the read-only path this script exercises, inert for the rest.
  const cursorum = new Cursorum()
  const actorum = new MemoryActorum()
  const unusedRunPodClient = {
    async submit() {
      throw new Error('concierge-eval: RunPod submit() should never be called (quote-only harness)')
    },
  } as unknown as RunPodClient
  const unusedCompile = async () => {
    throw new Error('concierge-eval: compile() should never be called (quote-only harness)')
  }
  cursorum.register(
    'runpod',
    new RunPodCursor(unusedRunPodClient, unusedCompile, modorum, actorum, {
      webhookUrl: 'http://localhost/unused',
    }),
  )
  if (process.env.OPENROUTER_API_KEY) {
    cursorum.register(
      OPENROUTER_PROVIDER.id,
      new ApiCursor(OPENROUTER_PROVIDER, {
        apiKey: process.env.OPENROUTER_API_KEY,
        http: httpApiTransport,
        mediaFetcher: async () => {
          throw new Error('concierge-eval: mediaFetcher should never be called (quote-only harness)')
        },
      }),
    )
  }
  // Unused-at-runtime stubs for the heavier (`run()`-only) deps of the remaining
  // cursor classes — `reserve()` never touches engine/fetcher/uploader/store/spawner,
  // per each class's own source (read above); satisfying the constructor type is
  // enough for the quote-only path this harness exercises.
  const unused = () => new Proxy({}, {
    get: () => () => {
      throw new Error('concierge-eval: unused run()-only dependency invoked (quote-only harness)')
    },
  })
  cursorum.register(
    'ffmpeg',
    new FfmpegCursor({
      engine: unused() as ConstructorParameters<typeof FfmpegCursor>[0]['engine'],
      fetcher: unused() as ConstructorParameters<typeof FfmpegCursor>[0]['fetcher'],
      uploader: unused() as ConstructorParameters<typeof FfmpegCursor>[0]['uploader'],
    }),
  )
  cursorum.register(
    'composite',
    new LayerCompositeCursor({
      engine: unused() as ConstructorParameters<typeof LayerCompositeCursor>[0]['engine'],
      fetcher: unused() as ConstructorParameters<typeof LayerCompositeCursor>[0]['fetcher'],
      uploader: unused() as ConstructorParameters<typeof LayerCompositeCursor>[0]['uploader'],
    }),
  )
  cursorum.register(
    'aitoolkit',
    new AitoolkitTrainingCursor({
      store: unused() as ConstructorParameters<typeof AitoolkitTrainingCursor>[0]['store'],
      spawner: unused() as ConstructorParameters<typeof AitoolkitTrainingCursor>[0]['spawner'],
      image: 'unused',
      mounts: [],
    }),
  )

  const intellarum = new MemoryIntellarum()

  // Partial-deps CrystalApi construction pattern (scripts/train-bomhat-klein.ts:30,
  // scripts/backlog/ms2-klein.ts:175), seeded with the real canonical catalog
  // instead of a hand-picked fixture per this item's Decision record Q1.
  return new CrystalApi({
    actorum,
    modorum,
    cursorum,
    intellarum,
  } as unknown as CrystalApiDeps)
}

// -----------------------------------------------------------------------------
// Tool-call trace shim — wraps the real `runToolChat` to record each call's tool
// name + arguments + result, without touching ConciergeAgent.ts/
// OpenRouterToolClient.ts (the DI seam is `ConciergeDeps.runToolChat` itself).
// -----------------------------------------------------------------------------
interface TraceEntry { tool: string; arguments: string }

function tracedRunToolChat(
  real: ConciergeDeps['runToolChat'],
  trace: TraceEntry[],
): ConciergeDeps['runToolChat'] {
  return async (deps: OpenRouterToolClientDeps, opts: OpenRouterToolChatOpts): Promise<OpenRouterChatResult> => {
    const result = await real(deps, opts)
    for (const tc of result.toolCalls ?? []) {
      trace.push({ tool: tc.name, arguments: tc.arguments })
    }
    return result
  }
}

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
