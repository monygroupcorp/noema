import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type {
  Vestigiorum,
  VestigiumSearchDimension,
  VestigiumSweepItem,
} from '../types/vestigium.js'
import { makeLogger } from '../lib/logger.js'

// =============================================================================
// EmbedSweepCursor — the backlog of un-embedded traces, worked off in batches
// =============================================================================
//
// A vestigium is written when a run completes and embedded afterwards, so any
// stretch where the CLIP service was unreachable leaves traces that metadata can
// find and semantic search cannot. The gap does not heal on its own: nothing
// re-visits an old trace. This cursor is the pass that does — the caller asks for
// their backlog to be worked off, and it is worked off as an ordinary metered run.
//
// FOUR PROPERTIES ARE LOAD-BEARING HERE:
//
//   NO RESOURCE ID IN THE ADITUS — the work arrives as VALUES (`_sweep`: the id
//     and the text or image URL of each backlogged trace), read by the API layer
//     for the authenticated caller. An `Actum` carries no identity, so a cursor
//     that took an animaId out of its aditus and queried the store with it would
//     be unscoped by construction, and this one writes: an unscoped read here
//     would be a pass that embeds — and bills for — a stranger's trail.
//
//   THE OWNER IS PART OF EVERY WRITE — `setEmbedding` takes the owner token the
//     boundary stamped and matches on it. Even if a foreign id reached this
//     cursor, the write would address no record. Stranger isolation does not
//     depend on this cursor being careful; it is a property of the write.
//
//   FAILURE IS A SKIP, NOT A FAILURE — one unfetchable image among sixty must not
//     lose the other fifty-nine. A batch that throws is counted skipped and the
//     pass continues; the run settles for what it actually embedded, and the items
//     it skipped are still in the backlog for the next pass, which is exactly where
//     they should be.
//
//   OWN MINISTERIUM — `Cursorum` is a flat Map<ministerium, Cursor> whose
//     `register` is a bare set, so registering this under a provider's key would
//     replace that provider's cursor. It owns `'embedsweep'` and nothing else.
//
// Ring rules: `src/crystal` is platform-neutral. Nothing here reads `process.env`
// — the CLIP endpoint and its job token arrive from the container.
// =============================================================================

const log = makeLogger('cursor:embedsweep')

/** The ministerium this cursor owns. Never a provider's key — see the header. */
export const EMBED_SWEEP_MINISTERIUM = 'embedsweep'

/**
 * What one embedded item costs, in impetus.
 *
 * The pass runs on a CPU pod at the bottom of the rental card (a few cents an hour)
 * and one item is a fraction of a CPU-second, so the true cost of an item is well
 * under one impetus point — and a point is the smallest unit there is. Charging one
 * per item is therefore the smallest honest price that never charges for less than
 * it delivers, and it makes the quote a caller reads off the backlog surface
 * ("you owe N embeddings") the same number they are charged.
 */
export const EMBED_SWEEP_IMPETUS_PER_ITEM = 1n

/** The most items one sweep will take, whatever it is handed. Mirrors the API cap. */
export const MAX_SWEEP_ITEMS = 500

/** Batch sizes the CLIP service accepts (`clip_service.py`: MAX_TEXT_BATCH / MAX_IMAGE_BATCH). */
export const CLIP_TEXT_BATCH = 64
export const CLIP_IMAGE_BATCH = 16

/**
 * The embedding service, as this cursor needs it: batches in, vectors out, in order.
 *
 * A batch call rather than one-at-a-time because that is the shape the service is
 * built around — a single forward pass over the batch — and a sweep is the one caller
 * that always has a batch.
 */
export interface ClipEmbedder {
  embedTexts(texts: string[]): Promise<number[][]>
  embedImages(urls: string[]): Promise<number[][]>
}

export interface EmbedSweepCursorDeps {
  clip: ClipEmbedder
  /** Only the writeback slice — this cursor never reads the trace store. */
  vestigiorum: Pick<Vestigiorum, 'setEmbedding'>
  /** Overrides `CLIP_TEXT_BATCH`. */
  textBatch?: number
  /** Overrides `CLIP_IMAGE_BATCH`. */
  imageBatch?: number
  /** Overrides `EMBED_SWEEP_IMPETUS_PER_ITEM`. */
  impetusPerItem?: bigint
}

/** The owner token the API boundary stamps, and the shape it parses back to. */
export type SweepOwner = { animaId: string } | { commitment: string }

/**
 * Render an owner as the flat token an aditus can carry.
 *
 * An aditus port is a scalar (`validateAditus` coerces a declared 'text' port with
 * `String`), so the owner rides as `animaId:<id>` / `commitment:<id>` rather than as
 * an object that would arrive as '[object Object]'. Exported because the API layer
 * writes what this cursor reads, and one function is what keeps them the same.
 */
export function sweepOwnerToken(owner: SweepOwner): string {
  return 'animaId' in owner ? `animaId:${owner.animaId}` : `commitment:${owner.commitment}`
}

/** The inverse of `sweepOwnerToken`. Anything else is not an owner. */
export function parseSweepOwner(token: unknown): SweepOwner | undefined {
  if (typeof token !== 'string') return undefined
  if (token.startsWith('animaId:') && token.length > 'animaId:'.length) {
    return { animaId: token.slice('animaId:'.length) }
  }
  if (token.startsWith('commitment:') && token.length > 'commitment:'.length) {
    return { commitment: token.slice('commitment:'.length) }
  }
  return undefined
}

/** Read the sweep items off an aditus, dropping anything that is not one. */
export function parseSweepItems(raw: unknown): VestigiumSweepItem[] {
  if (!Array.isArray(raw)) return []
  const items: VestigiumSweepItem[] = []
  for (const entry of raw) {
    const id = typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : ''
    if (!id) continue
    const textum = typeof (entry as { textum?: unknown }).textum === 'string' ? (entry as { textum: string }).textum : ''
    const imagoUrl = typeof (entry as { imagoUrl?: unknown }).imagoUrl === 'string' ? (entry as { imagoUrl: string }).imagoUrl : ''
    if (!textum && !imagoUrl) continue
    items.push({ id, ...(textum ? { textum } : {}), ...(imagoUrl ? { imagoUrl } : {}) })
  }
  return items
}

/** The dimension this pass is embedding. Anything undeclared is the default one. */
export function parseSweepDimension(raw: unknown): VestigiumSearchDimension {
  return raw === 'imago' || raw === 'intella' ? raw : 'promptum'
}

export class EmbedSweepCursor implements Cursor {
  constructor(private readonly deps: EmbedSweepCursorDeps) {}

  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    if (modus.impetusFixum !== undefined) return modus.impetusFixum
    // Both refusals happen HERE — before the reservation is locked and before the first
    // embed call — so an unscoped or oversized sweep costs nothing.
    const { items } = this.resolveWork(aditus)
    return BigInt(items.length) * (this.deps.impetusPerItem ?? EMBED_SWEEP_IMPETUS_PER_ITEM)
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    // The reservation ActumInceptor locked — the upper bound run() must not exceed.
    const reserved = actum.impetus

    const { items, owner, per } = this.resolveWork(aditus)
    const perItem = this.deps.impetusPerItem ?? EMBED_SWEEP_IMPETUS_PER_ITEM
    const size = per === 'imago'
      ? (this.deps.imageBatch ?? CLIP_IMAGE_BATCH)
      : (this.deps.textBatch ?? CLIP_TEXT_BATCH)

    let embedded = 0
    let skipped = 0

    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size)
      let vectors: number[][]
      try {
        vectors = per === 'imago'
          ? await this.deps.clip.embedImages(batch.map(b => b.imagoUrl ?? ''))
          : await this.deps.clip.embedTexts(batch.map(b => b.textum ?? ''))
      } catch (err) {
        // One bad batch is not a bad sweep. The items stay in the backlog and the next
        // pass gets them; what this pass did embed is still worth settling.
        skipped += batch.length
        log.warn('embed batch failed — skipped', { count: batch.length, per, error: (err as Error).message })
        continue
      }

      for (let j = 0; j < batch.length; j++) {
        const vector = vectors[j]
        const item = batch[j]!
        // A service that answers with fewer vectors than it was asked for has not
        // embedded the tail: those items are skipped, never written with a wrong vector.
        if (!Array.isArray(vector) || vector.length === 0) { skipped++; continue }
        const written = await this.deps.vestigiorum
          .setEmbedding(item.id, owner, per, vector)
          .catch(() => false)
        if (written) embedded++
        else skipped++
      }
    }

    // Settle what was DONE, never what was asked for: the reservation is an upper bound
    // and a pass that skipped half its batch charges for half.
    const impetus = BigInt(embedded) * perItem
    log.info('embed sweep complete', { per, embedded, skipped, impetus: impetus.toString() })

    return {
      kind: 'sync',
      exitus: {
        exitus: { embedded, skipped, per },
        impetus: impetus > reserved ? reserved : impetus,
      },
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Read the work off the aditus, refusing anything this pass cannot honestly do.
   *
   * Called from `reserve()` as well as `run()`, so every refusal lands before the
   * reservation rather than mid-run with credits locked. NOTE what it does not do: it
   * takes no id it would resolve for itself. The owner it reads is the one the API
   * layer stamped from the resolved caller, and it is used to SCOPE the writeback,
   * never to widen the work.
   */
  private resolveWork(
    aditus: Record<string, unknown>,
  ): { items: VestigiumSweepItem[]; owner: SweepOwner; per: VestigiumSearchDimension } {
    const owner = parseSweepOwner(aditus._owner)
    if (!owner) {
      throw new Error('embed sweep: no owner on the run — the sweep is stamped by the API layer, never by a caller')
    }

    const per = parseSweepDimension(aditus.per)
    const items = parseSweepItems(aditus._sweep)
    if (items.length === 0) throw new Error('embed sweep: nothing to sweep')
    if (items.length > MAX_SWEEP_ITEMS) {
      throw new Error(`embed sweep: ${items.length} items is above the ${MAX_SWEEP_ITEMS}-item per-sweep cap`)
    }
    // A dimension whose items carry no source cannot be embedded, and a run that
    // reached the service with empty strings would be billed for nothing.
    const usable = items.filter(item => (per === 'imago' ? !!item.imagoUrl : !!item.textum))
    if (usable.length !== items.length) {
      throw new Error(`embed sweep: ${items.length - usable.length} item(s) carry nothing to embed for '${per}'`)
    }

    return { items, owner, per }
  }
}
