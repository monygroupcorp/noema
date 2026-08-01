// =============================================================================
// pinnedModelResolver — normalize a pinned-model token to a canonical ModelRef
// =============================================================================
//
// The concierge proposes pinned models as BARE strings (an intella id, a slug, or a
// trigger word — see ConciergeAgent). The run path, however, threads `pinnedModels`
// as typed `ModelRef[]` all the way into the Compiler, which resolves each ref by its
// `id` against the Intellarum registry. A bare string arrives as `{id: undefined}`, so
// `find(undefined)` misses and the Compiler throws the misleading
// `No URL for model 'undefined'` — a paid 500 on GO (noema-113).
//
// This resolver is the boundary coercion: given a token (id | slug | trigger, OR an
// already-shaped ref), it produces a `ModelRef{ id: <canonical intellaId> }`. It ASSEMBLES
// from the existing Intellarum primitives — `find(id)` for the id path, and a `list()` scan
// for slug/trigger (the run boundary has no flow `familia` to scope `triggerMap`/`findByTrigger`
// by, so the family-agnostic `list()` is the reuse point). Access is enforced with the same
// `ownsBy` gate the Compiler uses: a private intella resolves only for its owner.
// =============================================================================

import type { Intellarum, Intella } from '../types/intelligendi.js'
import type { ModelRef } from '../types/actum.js'
import { ownsBy, type OwnerKey } from './ownerKey.js'

/** A pinned-model token as it reaches the run boundary: a bare reference string
 *  (intella id | slug | trigger — what the concierge proposes) OR an already-shaped ref. */
export type PinnedInput = string | ModelRef

export type PinnedResolution =
  | { ok: true; ref: ModelRef }
  | { ok: false; token: string; reason: 'unresolved' | 'forbidden' }

/** The bare reference token inside a pinned input, whatever its shape. */
function tokenOf(input: PinnedInput): string {
  if (typeof input === 'string') return input
  return input?.id ?? ''
}

/**
 * The canonical ModelRef the Compiler's pinned path expects. Mirrors
 * `Compiler._loraIntellaeToRefs`: role `'lora'` + a slug-stemmed loras dest for a LoRA;
 * the record's own role/dest otherwise. `url`/`dest` are re-derived from the registry
 * record in `Compiler._resolveModelsWithRecords`, so `id` (the canonical registry id) is
 * the load-bearing field.
 */
function refFor(intella: Intella): ModelRef {
  const isLora = intella.genus === 'lora'
  const dest = isLora
    ? `models/loras/${intella.slug ?? intella.id}.safetensors`
    : intella.dest
  return { role: isLora ? 'lora' : intella.genus, id: intella.id, dest }
}

/** True when `token` matches one of the intella's comma-separated trigger words (case-insensitive). */
function matchesTrigger(intella: Intella, token: string): boolean {
  const t = token.toLowerCase()
  return (intella.trigger ?? '')
    .split(',')
    .some((raw) => raw.trim().toLowerCase() === t && raw.trim() !== '')
}

/**
 * Resolve one pinned token to a canonical ModelRef. Resolution order: exact `find(id)`,
 * then slug, then trigger. Returns a typed "unresolvable"/"forbidden" outcome rather than
 * throwing — the caller decides how to surface it (a non-500 run error, or a concierge
 * re-pick). Access: a PRIVATE intella resolves only for its owner (mirrors the Compiler gate).
 */
export async function resolvePinnedModel(
  store: Intellarum,
  input: PinnedInput,
  ownerKey?: OwnerKey,
): Promise<PinnedResolution> {
  const token = tokenOf(input)
  if (!token) return { ok: false, token: String(token), reason: 'unresolved' }

  let intella = await store.find(token)
  if (!intella) {
    const all = await store.list()
    intella =
      all.find((i) => i.slug !== undefined && i.slug === token) ??
      all.find((i) => matchesTrigger(i, token)) ??
      null
  }
  if (!intella) return { ok: false, token, reason: 'unresolved' }

  if (intella.access === 'private' && !ownsBy(intella, ownerKey)) {
    return { ok: false, token, reason: 'forbidden' }
  }
  return { ok: true, ref: refFor(intella) }
}
