// =============================================================================
// ownedAditusGuard — the caller-bound owned-reference check, shared by every facade
// =============================================================================
//
// `ownedResources.ts` answers "does this aditus name a record this caller may
// name", given lookups that are already bound to a caller. This module builds
// those lookups from the stores, so that every dispatch facade asks the question
// the same way instead of assembling its own.
//
// It exists because the check has to be made where the caller is still known. An
// `Actum` is identity-blind (ADR-0002), so a cursor cannot make it; each facade
// that turns a request into an `Inceptio` has to. Before this module the REST run
// route was the only one that did, and a facade reaching `dispatchInceptio` by
// another door — the Telegram execute flow, a collection's fan-out — carried a
// caller-supplied reference straight past it.
//
// Store-shaped, not store-coupled: the parameters are structural, and the
// inline-content predicate is injected, so nothing here depends on a concrete
// store or on the manifest format.
// =============================================================================

import type { AuctorKey, Modus } from '../types/modus.js'
import {
  checkOwnedAditus,
  type OwnedDatasetShape,
  type OwnedResourceLookups,
  type OwnedVerdict,
} from './ownedResources.js'

/**
 * The stores an owned reference resolves through, in the shape this check needs.
 * Every field is optional: a deployment that has not wired one cannot affirm
 * access to what lives in it, so a reference into that store fails closed (the
 * rule `OwnedResourceLookups` documents).
 */
export interface OwnedResourceStores {
  datasets?: {
    findOwned?: (
      id: string,
      owner: string,
      sodalitasIds?: string[],
    ) => Promise<OwnedDatasetShape | null>
  }
  corpora?: { findOwned: (id: string, owner: string) => Promise<unknown | null> }
  sodalitatum?: { listByMember: (animaId: string) => Promise<ReadonlyArray<{ id: string }>> }
  /**
   * True when a raw value is inline content rather than a reference to a stored
   * record (the training modus accepts an inline manifest in place of a corpus
   * id). Injected so this module stays independent of the manifest format.
   */
  inline?: (raw: string) => boolean
}

/** True when any of the modus' aditus ports declares that it names a stored record. */
export function declaresOwnedRefs(modus: Modus | null | undefined): boolean {
  const aditus = modus?.aditus
  if (!aditus) return false
  return Object.values(aditus).some(porta => porta.owned !== undefined)
}

/**
 * Resolve every declared owned reference in `values` against the caller.
 *
 * A modus that declares none is not a question, so it costs nothing: the store
 * reads below happen only for the modi that name records. The caller's identity
 * and teams are closed over in the lookups — they are never passed beside the id,
 * so there is no way to resolve a reference for anyone but the caller, and
 * nothing about who is calling can travel onward onto the `Actum`.
 */
export async function ownedAditusVerdict(
  stores: OwnedResourceStores,
  auctor: AuctorKey,
  modus: Modus | null | undefined,
  values: Record<string, unknown>,
): Promise<OwnedVerdict> {
  if (!declaresOwnedRefs(modus)) return { ok: true }

  const owner = 'animaId' in auctor ? auctor.animaId : undefined
  const { datasets, corpora, sodalitatum } = stores

  // Resolved once, and only when there is a dataset seam that can use them — the
  // teams of the CALLER, never of anyone the aditus names.
  const canResolveDataset = Boolean(owner && datasets?.findOwned)
  const sodalitasIds: string[] =
    canResolveDataset && owner && sodalitatum
      ? (await sodalitatum.listByMember(owner)).map(t => t.id)
      : []

  const lookups: OwnedResourceLookups = {
    ...(stores.inline ? { inline: stores.inline } : {}),
    ...(owner && datasets?.findOwned
      ? { dataset: (id: string) => datasets.findOwned!(id, owner, sodalitasIds) }
      : {}),
    ...(owner && corpora ? { corpus: (id: string) => corpora.findOwned(id, owner) } : {}),
  }

  return checkOwnedAditus(modus!.aditus, values, lookups)
}
