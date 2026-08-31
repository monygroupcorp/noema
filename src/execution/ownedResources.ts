// =============================================================================
// ownedResources — declared owned-resource references, and the check over them
// =============================================================================
//
// A cursor that takes a resource id out of its aditus cannot scope that read: an Actum is
// identity-blind by design (ADR-0002 — identity lives in `Hospitium` and is surfaced late),
// so by the time the cursor runs there is no caller left to compare an owner against. The
// scope has to be resolved at the last seam that still knows who is calling, which is the
// API's run entry point, and it has to know WHICH ports name resources.
//
// That is what `Porta.owned` declares (see `OwnedRef` in types/modus.ts) and what this
// module reads:
//
//   - `checkOwnedAditus` resolves every DECLARED reference in a set of aditus values
//     through caller-scoped lookups and reports the first that does not resolve. The
//     caller turns that into a refusal, above any reservation and any dispatch.
//
//   - `lintOwnedDeclarations` runs over the seeded modi and fails a modus whose aditus
//     carries a resource-shaped port with no declaration, so a new modus cannot quietly
//     reopen the gap by naming a port `dataset` and saying nothing about it.
//
// SCOPE OF THE CHECK: it reads ONLY the ports the modus declares as references. It does not
// strip, rewrite or refuse anything else, so the internal channels that ride an aditus —
// `CollectioCursor`'s `_attributes` key, the `__capability` routing keys — pass through
// exactly as they did. Schema enforcement is `validateAditus`'s job and stays there.
// =============================================================================

import type { Forma, Modus } from '../types/modus.js'

/**
 * The result of checking one aditus. `field` names the declared port whose reference did not
 * resolve — never the value, and never whether the resource exists at all: a caller learns
 * that the input was not usable, not whether someone else's record is behind that id.
 */
export type OwnedVerdict = { ok: true } | { ok: false; field: string }

/** The minimum a resolved dataset must expose for a captionset reference to be checked. */
export interface OwnedDatasetShape {
  captionsets?: ReadonlyArray<{ id: string }>
}

/**
 * The caller-scoped lookups the check resolves references through. Each is already bound to
 * the calling anima: the identity is closed over, never passed in beside the id, so there is
 * no way to call one of these for a caller other than the one it was built for.
 *
 * An ABSENT lookup fails the reference closed. A deployment that cannot resolve a store
 * cannot affirm access to what lives in it, and admitting the reference on the grounds that
 * nothing could check it is the failure mode this exists to remove (the same reasoning
 * `_ownedStudio` follows when no Conductor is wired).
 */
export interface OwnedResourceLookups {
  /**
   * Resolve a dataset this caller may name, or null. "May name" is the API layer's question,
   * answered entirely on that side of this seam: the caller's identity AND the teams they
   * belong to are closed over when the lookup is built, at dispatch time, so nothing about who
   * is calling crosses into the check or onto the Actum.
   */
  dataset?: (id: string) => Promise<OwnedDatasetShape | null>
  /** Resolve a corpus this caller may name, or null. */
  corpus?: (id: string) => Promise<unknown | null>
  /**
   * True when the raw value is INLINE content rather than a reference to a stored record
   * (the training modus accepts an inline image manifest in place of a corpus id). Inline
   * content is the caller's own input and names nobody else's record, so it is passed
   * through. Absent → every value on a `corpus` port is treated as a reference.
   */
  inline?: (raw: string) => boolean
}

/**
 * Resolve every DECLARED owned reference in `values` against the caller-scoped lookups.
 *
 * Returns the first field that does not resolve rather than a list: this runs in front of a
 * spend, so the first failure ends the request, and reporting the rest would only widen what
 * a probe learns per call.
 *
 * An absent or blank value is NOT a failure here — whether a port is required is declared by
 * `Porta.required` and enforced by `validateAditus`. This answers only "may this caller name
 * what is in this port".
 */
export async function checkOwnedAditus(
  aditus: Forma,
  values: Record<string, unknown>,
  lookups: OwnedResourceLookups,
): Promise<OwnedVerdict> {
  // Resolved datasets are cached for the span of one check so a captionset port and the
  // dataset port it hangs off do not issue the same query twice.
  const datasets = new Map<string, OwnedDatasetShape | null>()
  const resolveDataset = async (id: string): Promise<OwnedDatasetShape | null> => {
    if (datasets.has(id)) return datasets.get(id) ?? null
    const found = lookups.dataset ? await lookups.dataset(id) : null
    datasets.set(id, found)
    return found
  }

  for (const [key, porta] of Object.entries(aditus)) {
    const owned = porta.owned
    if (!owned) continue

    const raw = values[key]
    if (raw === undefined || raw === null) continue
    // A reference is an id string. Anything else cannot be resolved against a store, and
    // passing it through would hand the cursor an unchecked value — refuse instead.
    if (typeof raw !== 'string') return { ok: false, field: key }
    const ref = raw.trim()
    if (ref === '') continue

    if (owned.genus === 'corpus') {
      if (lookups.inline?.(ref)) continue
      const corpus = lookups.corpus ? await lookups.corpus(ref) : null
      if (!corpus) return { ok: false, field: key }
      continue
    }

    if (owned.genus === 'dataset') {
      if (!(await resolveDataset(ref))) return { ok: false, field: key }
      continue
    }

    // A sub-resource is checked against its PARENT: the captionset must live on a dataset
    // this caller may name. Checking the captionset id alone would let a foreign captionset
    // id ride in beside an owned dataset id.
    const parentRaw = values[owned.parens]
    if (typeof parentRaw !== 'string' || parentRaw.trim() === '') return { ok: false, field: key }
    const parent = await resolveDataset(parentRaw.trim())
    if (!parent) return { ok: false, field: key }
    if (!(parent.captionsets ?? []).some(c => c.id === ref)) return { ok: false, field: key }
  }

  return { ok: true }
}

/**
 * Aditus port names that name a stored resource. A port called one of these is a reference
 * whether or not anyone said so, which is exactly the case the lint below exists to catch.
 * Matched case-insensitively.
 */
export const RESOURCE_PORT_NAMES: ReadonlySet<string> = new Set([
  'dataset',
  'datasetid',
  'corpus',
  'corpusid',
  'captionset',
  'captionsetid',
])

/** The resource-shaped aditus ports of one modus that carry no `owned` declaration. */
export function undeclaredResourcePorts(aditus: Forma): string[] {
  return Object.entries(aditus)
    .filter(([key, porta]) => RESOURCE_PORT_NAMES.has(key.toLowerCase()) && porta.owned === undefined)
    .map(([key]) => key)
}

/**
 * Fail the seed set when a modus declares a resource-shaped aditus port without saying what
 * it references.
 *
 * This runs where the canonical modi are defined, so the failure lands when the seeds are
 * loaded rather than on the first run that names someone else's record. A port that really
 * is a plain value and merely shares one of these names is declared out of the set by being
 * renamed — the names are reserved on purpose.
 */
export function lintOwnedDeclarations(modi: readonly Modus[]): void {
  const problems: string[] = []
  for (const modus of modi) {
    for (const port of undeclaredResourcePorts(modus.aditus)) {
      problems.push(`${modus.id}.aditus.${port}`)
    }
  }
  if (problems.length > 0) {
    throw new Error(
      'modus seed: resource-shaped aditus port(s) with no `owned` declaration — ' +
        `declare what each references (Porta.owned) or rename the port: ${problems.join(', ')}`,
    )
  }
}
