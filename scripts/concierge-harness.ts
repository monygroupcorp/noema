// =============================================================================
// concierge-harness — shared dev-harness plumbing for the concierge scripts
// =============================================================================
//
// The pieces `scripts/concierge-eval.ts` and `scripts/concierge-gym.ts` both
// need: an in-memory `Intellarum` over the canonical seed models, the seeded
// in-memory `CrystalApi` builder, and the tool-call trace shim that wraps the
// injected `runToolChat`.
//
// Extracted verbatim from concierge-eval.ts so the two harnesses share ONE
// catalog builder rather than drifting apart. Behaviour is unchanged; this
// module adds nothing beyond `export` on what was already there.
//
// Like concierge-eval, nothing here is wired into a server, an HTTP route, or a
// container: it is dev-only scaffolding, it never persists, and it only ever
// reaches read-only CrystalApi methods.
// =============================================================================

import type { ConciergeDeps } from '../src/allocutio/api/ConciergeAgent.js'
import {
  httpApiTransport,
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
// In-memory Intellarum — the models registry `CrystalApi.listModels` needs.
// No repo implementation exists in-memory (only MongoIntella); this is a
// minimal, honest adapter over CANONICAL_INTELLAE implementing the real
// `Intellarum` contract (src/types/intelligendi.ts), scoped to this script.
// -----------------------------------------------------------------------------
export class MemoryIntellarum implements Intellarum {
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

  // Trigger resolution over the same in-process catalog. The seed set is entirely
  // platform-canonical (public), so `ownerKey` selects nothing extra here — it is
  // accepted and ignored rather than faked, and a public-only result is the honest
  // answer for this catalog.
  async findByTrigger(trigger: string, familia: string | string[]): Promise<Intellae> {
    const wanted = trigger.toLowerCase()
    return this.loras(familia).filter((i) => i.trigger?.toLowerCase() === wanted)
  }

  async triggerMap(familia: string | string[]): Promise<Map<string, Intellae>> {
    const map = new Map<string, Intellae>()
    for (const i of this.loras(familia)) {
      const key = i.trigger?.toLowerCase()
      if (!key) continue
      const bucket = map.get(key)
      if (bucket) bucket.push(i)
      else map.set(key, [i])
    }
    return map
  }

  /** Public LoRAs whose `familia` matches one family, or is a member of a set of accepted families. */
  private loras(familia: string | string[]): Intella[] {
    const accepted = Array.isArray(familia) ? familia : [familia]
    return Array.from(this.byId.values()).filter(
      (i) =>
        i.genus === 'lora' &&
        i.access !== 'private' &&
        i.familia !== undefined &&
        accepted.includes(i.familia),
    )
  }
}

// -----------------------------------------------------------------------------
// Real seeded canonical catalog → in-memory CrystalApi deps (noema-098 Decision
// record Q1). Mirrors scripts/crystal/seed-canon.ts's registration order
// (essentiae → compositi → custom modi) but into MemoryModorum instead of a
// Mongo-backed one, and needs no DB connection.
// -----------------------------------------------------------------------------
export async function buildSeededCrystalApi(): Promise<CrystalApi> {
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
      throw new Error('concierge-harness: RunPod submit() should never be called (quote-only harness)')
    },
  } as unknown as RunPodClient
  const unusedCompile = async () => {
    throw new Error('concierge-harness: compile() should never be called (quote-only harness)')
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
        // `MediaFetcher` is an object with a `fetch` method, not a bare function — the
        // throwing stub has to sit on that method for the never-called contract to hold.
        mediaFetcher: {
          async fetch(): Promise<Buffer> {
            throw new Error('concierge-harness: mediaFetcher should never be called (quote-only harness)')
          },
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
      throw new Error('concierge-harness: unused run()-only dependency invoked (quote-only harness)')
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
export interface TraceEntry { tool: string; arguments: string }

export function tracedRunToolChat(
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
