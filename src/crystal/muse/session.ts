// =============================================================================
// muse/session — the session as pure domain: a floor, and a ledger with lineage
// =============================================================================
//
// A Muse session is a break-off from a dataset. The dataset is the starter and
// stays pure: a session copies the fragments it was spawned from and works from
// its own copies, so nothing a session does can reach back into the mother. The
// session knows which dataset it came from and nothing assumes that relationship
// is permanent.
//
// A session holds two things:
//
//   THE FLOOR — every fragment the session was spawned with, each carrying an
//   `enabled` flag and a draw `weight`. A fragment turned off stays on the floor
//   and is simply not drawn: darkened, not deleted. The floor is a `SteerState`,
//   the exact type `rollFragments` already reads, so a session's floor is passed
//   to the sampler directly rather than translated at the seam.
//
//   THE PIECE LEDGER — one entry per piece the session produced, each naming the
//   fragments that produced it. That lineage is the point: a reaction on a piece
//   and a save-back of a piece both need to know what went into it, and neither
//   can recover it after the fact.
//
// Floor state is keyed by fragment IDENTITY (`fragmentKey`), never by array
// position. The fragment list is rebuilt whenever the mother's decomposition
// changes, which renumbers positions; state keyed on a position would then land
// on a different fragment, and state that cannot survive a rebuild cannot be
// persisted at all.
//
// Every function here is pure: it takes a session and returns a new one. No I/O,
// no clock, no randomness. Persistence, container wiring and HTTP routes live
// elsewhere; this module is the platform-neutral core they call.

import { fragmentKey, type Fragment } from './taxonomy.js'
import { WEIGHT_MAX, WEIGHT_MIN, type FragmentState, type SteerState } from './sampler.js'

// --- Types -------------------------------------------------------------------

/**
 * What a user said about a piece.
 *
 * `up` and `down` are the steer channel — they are the way to push the session
 * without typing. `note` is informational: it marks a piece without claiming the
 * session should make more or fewer like it.
 */
export type Reaction = 'up' | 'down' | 'note'

/**
 * One piece the session produced, with its lineage.
 *
 * `fragments` is the lineage — the fragments the roll drew to build this piece.
 * It is recorded at the moment the piece is recorded because it is not
 * recoverable later: the floor moves, the fragment list is rebuilt, and a roll
 * replayed against a changed floor is a different roll.
 */
export type Piece = {
  /** The run that produced the piece. */
  runId: string
  /** Which roll of the session this was. */
  rollIndex: number
  /** The fragments that produced the piece — one per category the roll filled. */
  fragments: readonly Fragment[]
  /** What the user said about it, if anything. */
  reaction?: Reaction
  /** Kept: the piece is wanted, and is a candidate to go back into the set. */
  saved: boolean
  /** Discarded: the piece is not wanted. */
  dismissed: boolean
}

/**
 * A session: a break-off of a dataset, with its own floor and its own ledger.
 *
 * `motherDatasetId` is the dataset the session was spawned from. A session is a
 * version of that dataset rather than a peer of it, and holding the mother's id
 * is what lets a session be placed under it — without fixing how that
 * relationship is presented or how long it lasts.
 */
export type MuseSession = {
  /** The dataset this session broke off from. Never written to by the session. */
  motherDatasetId: string
  /** Every fragment on the floor, in display order. Session-owned copies. */
  fragments: readonly Fragment[]
  /** Per-fragment floor state, keyed by `fragmentKey`. Read directly by the sampler. */
  floor: SteerState
  /** Every piece the session recorded, in the order it recorded them. */
  pieces: readonly Piece[]
}

/** The floor state every fragment starts on: in the draw, at even odds. */
export const DEFAULT_FRAGMENT_STATE: Readonly<Required<FragmentState>> = Object.freeze({
  enabled: true,
  weight: 1,
})

// --- Internals ---------------------------------------------------------------

/**
 * A session-owned copy of a fragment.
 *
 * The mother is the starter and stays pure: a session that held the mother's own
 * fragment objects would edit the dataset every time it edited itself, and the
 * two would be impossible to separate afterwards.
 */
function copyFragment(fragment: Fragment): Fragment {
  return {
    category: fragment.category,
    text: fragment.text,
    source: fragment.source,
    trigger: fragment.trigger,
  }
}

/** Weight clamped to the sampler's bounds; a non-finite weight falls back to the default. */
function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return DEFAULT_FRAGMENT_STATE.weight
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight))
}

/**
 * The fragment list with duplicate identities dropped, first occurrence winning.
 *
 * `buildGarden` already dedupes on this identity, so a well-formed decomposition
 * carries no duplicates; enforcing it here keeps the floor's key count equal to
 * the fragment count no matter where the list came from.
 */
function dedupeByIdentity(fragments: readonly Fragment[]): Fragment[] {
  const seen = new Set<string>()
  const kept: Fragment[] = []
  for (const fragment of fragments) {
    const key = fragmentKey(fragment)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(copyFragment(fragment))
  }
  return kept
}

/** A floor for `fragments`, carrying forward any state `previous` holds for the same identity. */
function buildFloor(
  fragments: readonly Fragment[],
  previous?: SteerState,
): ReadonlyMap<string, FragmentState> {
  const floor = new Map<string, FragmentState>()
  for (const fragment of fragments) {
    const key = fragmentKey(fragment)
    const carried = previous?.get(key)
    floor.set(key, {
      enabled: carried?.enabled ?? DEFAULT_FRAGMENT_STATE.enabled,
      weight: clampWeight(carried?.weight ?? DEFAULT_FRAGMENT_STATE.weight),
    })
  }
  return floor
}

/** The floor with one fragment's state replaced. Unknown identity → the floor is returned unchanged. */
function withFragmentState(
  session: MuseSession,
  fragment: Pick<Fragment, 'category' | 'text'>,
  patch: FragmentState,
): MuseSession {
  const key = fragmentKey(fragment)
  const current = session.floor.get(key)
  if (!current) return session

  const floor = new Map(session.floor)
  floor.set(key, {
    enabled: patch.enabled ?? current.enabled ?? DEFAULT_FRAGMENT_STATE.enabled,
    weight: clampWeight(patch.weight ?? current.weight ?? DEFAULT_FRAGMENT_STATE.weight),
  })
  return { ...session, floor }
}

// --- Spawning ----------------------------------------------------------------

/**
 * Break a session off a dataset's pooled fragments.
 *
 * The session copies every fragment and starts them all on the floor, in the
 * draw, at even odds. The fragments passed in are never held by reference and
 * never mutated.
 */
export function spawnSession(
  motherDatasetId: string,
  fragments: readonly Fragment[],
): MuseSession {
  const owned = dedupeByIdentity(fragments)
  return {
    motherDatasetId,
    fragments: owned,
    floor: buildFloor(owned),
    pieces: [],
  }
}

/**
 * Replace the session's fragment list, keeping the floor state of every fragment
 * that survives the rebuild.
 *
 * A rebuild is what happens when the mother's decomposition changes: fragments
 * are added, dropped and renumbered. Because floor state is keyed by identity, a
 * fragment turned off before the rebuild is still off after it, and a fragment
 * that is new to the list starts at the default. State for an identity that is
 * no longer on the floor is dropped with it.
 */
export function rebuildFragments(
  session: MuseSession,
  fragments: readonly Fragment[],
): MuseSession {
  const owned = dedupeByIdentity(fragments)
  return { ...session, fragments: owned, floor: buildFloor(owned, session.floor) }
}

// --- The floor ---------------------------------------------------------------

/** What the floor says about one fragment, or `undefined` if the floor does not hold it. */
export function fragmentStateOf(
  session: MuseSession,
  fragment: Pick<Fragment, 'category' | 'text'>,
): FragmentState | undefined {
  return session.floor.get(fragmentKey(fragment))
}

/** Whether the session holds this fragment at all. */
export function holdsFragment(
  session: MuseSession,
  fragment: Pick<Fragment, 'category' | 'text'>,
): boolean {
  return session.floor.has(fragmentKey(fragment))
}

/**
 * Turn a fragment off or back on.
 *
 * A disabled fragment stays on the floor and stays in the fragment list — it is
 * out of the draw, not gone, and the same call turns it back on.
 */
export function setFragmentEnabled(
  session: MuseSession,
  fragment: Pick<Fragment, 'category' | 'text'>,
  enabled: boolean,
): MuseSession {
  return withFragmentState(session, fragment, { enabled })
}

/** Weight a fragment up or down against its pool-mates, clamped to the sampler's bounds. */
export function setFragmentWeight(
  session: MuseSession,
  fragment: Pick<Fragment, 'category' | 'text'>,
  weight: number,
): MuseSession {
  return withFragmentState(session, fragment, { weight })
}

/** The fragments currently in the draw, in floor order. */
export function enabledFragments(session: MuseSession): Fragment[] {
  return session.fragments.filter((f) => session.floor.get(fragmentKey(f))?.enabled !== false)
}

// --- The piece ledger --------------------------------------------------------

/** A piece as the caller presents it: lineage is required, the bookkeeping flags are not. */
export type PieceRecord = {
  runId: string
  rollIndex: number
  fragments: readonly Fragment[]
  reaction?: Reaction
  saved?: boolean
  dismissed?: boolean
}

/** Thrown when a piece cites a fragment the session's floor does not hold. */
export class UnknownFragmentError extends Error {
  /** The identity that was cited and is not on the floor. */
  readonly citedKey: string

  constructor(citedKey: string) {
    super(`piece cites a fragment this session does not hold: ${citedKey}`)
    this.name = 'UnknownFragmentError'
    this.citedKey = citedKey
  }
}

/**
 * Append a piece to the session's ledger, with its lineage.
 *
 * Every cited fragment must be one the session holds. A piece citing anything
 * else has a lineage that cannot be resolved against this floor, so a reaction on
 * it would steer a fragment that is not there and a save-back would carry a tag
 * the session never had — the citation is rejected rather than stored.
 *
 * A disabled fragment is still a fragment the session holds: a piece rolled
 * before a fragment was darkened is a real piece with a real lineage.
 */
export function recordPiece(session: MuseSession, piece: PieceRecord): MuseSession {
  for (const fragment of piece.fragments) {
    const key = fragmentKey(fragment)
    if (!session.floor.has(key)) throw new UnknownFragmentError(key)
  }

  const recorded: Piece = {
    runId: piece.runId,
    rollIndex: piece.rollIndex,
    fragments: piece.fragments.map(copyFragment),
    saved: piece.saved ?? false,
    dismissed: piece.dismissed ?? false,
    ...(piece.reaction !== undefined ? { reaction: piece.reaction } : {}),
  }

  return { ...session, pieces: [...session.pieces, recorded] }
}

/** The lineage of one recorded piece — the fragments that produced it. */
export function lineageOf(session: MuseSession, runId: string): readonly Fragment[] | undefined {
  return session.pieces.find((p) => p.runId === runId)?.fragments
}
