// =============================================================================
// MUSE SESSION — the persisted envelope around the pure session
// =============================================================================
//
// `src/crystal/muse/session.ts` is the session as pure domain: a floor and a
// piece ledger, every mutator returning a new `MuseSession`. It knows nothing
// about who owns a session, when it was made, or how it is stored — by design,
// so it stays platform-neutral and testable without I/O.
//
// This module is the seam that makes such a session durable. It wraps the pure
// value in an envelope carrying the four fields persistence needs — `id`,
// `owner`, `natum`, `mutatum` — and declares the store interface over it. The
// shape mirrors `Dataset`/`Datasets` (`src/types/dataset.ts`) exactly: an
// owner-scoped record with a Mongo implementation in `src/crystal`.
//
// The envelope wraps rather than flattens. A session's own fields are the pure
// module's business and change with it; the envelope's four are persistence's
// and do not. Keeping them in separate objects means neither can quietly take a
// field name from the other.
//
// OWNER SCOPING IS NOT A STORE CONCERN. As with `Datasets`, `find` takes an id
// and nothing else; the API layer resolves the owner from the authenticated
// caller and compares (see `CrystalApi.getMuseSession`). No caller can hand an
// owner to this seam, so a scope parameter cannot be trusted into it.
// =============================================================================

import { fragmentKey, type Fragment } from '../crystal/muse/taxonomy.js'
import type { FragmentState, SteerState } from '../crystal/muse/sampler.js'
import type { MuseSession } from '../crystal/muse/session.js'

/**
 * One fragment's floor state, as a self-describing entry.
 *
 * The floor is a `SteerState` — a Map keyed by `fragmentKey`, which is
 * `category:text`. That key is user-derived text and cannot be a BSON field
 * name: it may contain a dot or start with `$`, both of which Mongo gives its
 * own meaning inside a document key. Serialising the floor as an ARRAY of
 * entries keeps the key in a value position, where it is just a string.
 *
 * Both fields are required here even though `FragmentState`'s are optional: an
 * entry is written from a floor the pure module has already defaulted and
 * clamped, so there is no absent case to represent on the wire or on disk.
 */
export interface FloorEntry {
  /** `fragmentKey(fragment)` — the fragment's stable identity. */
  key: string
  /** `false` takes the fragment out of the draw while leaving it on the floor. */
  enabled: boolean
  /** Draw weight against its pool-mates, already clamped to the sampler's bounds. */
  weight: number
}

/** The floor as an ordered entry array — the persisted and wire-facing form. */
export function floorToEntries(floor: SteerState): FloorEntry[] {
  const entries: FloorEntry[] = []
  for (const [key, state] of floor) {
    entries.push({ key, enabled: state.enabled ?? true, weight: state.weight ?? 1 })
  }
  return entries
}

/** An entry array read back as a `SteerState` the sampler can be handed directly. */
export function floorFromEntries(entries: readonly FloorEntry[]): SteerState {
  const floor = new Map<string, FragmentState>()
  for (const entry of entries) floor.set(entry.key, { enabled: entry.enabled, weight: entry.weight })
  return floor
}

/**
 * A stored session: the pure `MuseSession` plus the four fields persistence owns.
 *
 * `owner` is an Anima id, mirroring `Dataset.owner`. `natum`/`mutatum` are
 * "born"/"changed", the same pair every other record in this ring carries.
 */
export interface StoredMuseSession {
  id: string
  owner: string
  /** The pure domain value, untouched by persistence. */
  session: MuseSession
  /** "natum" = born — when the session was spawned. */
  natum: Date
  /** "mutatum" = changed — when the session was last written. */
  mutatum: Date
}

/** What a caller hands the store to spawn a session: the owner and the pure value. */
export interface CreateMuseSessionInput {
  owner: string
  session: MuseSession
}

/**
 * MuseSessions — the session store.
 *
 * Deliberately narrow: spawn, read, and replace the pure value. The pure module
 * is the ONLY mutation path — every domain change happens by calling one of its
 * functions and handing the resulting session back to `save`, so there is no
 * second place a floor or a ledger can be edited and no way for the two paths
 * to disagree.
 *
 * A session write NEVER touches the mother dataset. The mother is the starter
 * and stays pure (see `spawnSession`); this store owns exactly one collection
 * and the dataset's document is not in it.
 */
export interface MuseSessions {
  /** Persist a freshly spawned session. Assigns `id`, `natum` and `mutatum`. */
  create(input: CreateMuseSessionInput): Promise<StoredMuseSession>
  /** The stored session, or null when the id names none. Owner scoping is the API layer's. */
  find(id: string): Promise<StoredMuseSession | null>
  /**
   * The sessions one owner broke off one dataset, most recently changed first.
   *
   * This is how a session is reached again once the page that spawned it is gone.
   * The pointer lives on the server, keyed by owner and mother, rather than in a
   * client store that a reload or a second device does not carry.
   *
   * Unlike `find`, this DOES take an owner — a list has to be scoped somewhere,
   * and a list that returned every session for a dataset and left the filtering
   * to its caller would be a cross-tenant read waiting to be written. The owner
   * is still resolved by the API layer from the authenticated caller and never
   * from a request parameter, exactly as it is for `find`.
   */
  listByOwner(owner: string, motherDatasetId: string): Promise<StoredMuseSession[]>
  /**
   * Replace the stored session's pure value and bump `mutatum`. Returns null when
   * the id names no session — one is never created implicitly.
   */
  save(id: string, session: MuseSession): Promise<StoredMuseSession | null>
}

/** The fragment identity a floor operation names, as a caller supplies it. */
export type FragmentIdentity = Pick<Fragment, 'category' | 'text'>

/** Re-exported so a caller of this module never has to reach past it for the key rule. */
export { fragmentKey }
