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

import { fragmentKey, isCategory, type Category, type Fragment } from './taxonomy.js'
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
 *
 * `sessionDatasetId` is where the session's own kept work lands: a dataset record
 * of its own, holding the pieces saved out of this session. It is ABSENT until the
 * first save, because a session that never saves must not leave an empty dataset
 * behind — the record is minted by the first save and named on the session from
 * then on. The mother is never the target of a save (S7, S13).
 */
export type MuseSession = {
  /** The dataset this session broke off from. Never written to by the session. */
  motherDatasetId: string
  /** The session's own dataset, holding the pieces saved out of it. Absent until the first save. */
  sessionDatasetId?: string
  /** Every fragment on the floor, in display order. Session-owned copies. */
  fragments: readonly Fragment[]
  /** Per-fragment floor state, keyed by `fragmentKey`. Read directly by the sampler. */
  floor: SteerState
  /** Every piece the session recorded, in the order it recorded them. */
  pieces: readonly Piece[]
  /**
   * What the session fires its draw THROUGH: the flow, the run shape, the model
   * stack and the standing affix. Absent until a setup is committed. See the
   * setup section below for what it deliberately cannot hold.
   */
  setup?: MuseSetup
  /**
   * The rolls the user explicitly kept — prompt text and its paid/free verdict.
   * Append-only. ABSENT MEANS EMPTY; see the kept-rolls section below.
   */
  keptRolls?: readonly KeptRoll[]
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

/**
 * Widen the floor with every fragment identity `fragments` holds and the floor does
 * not, each one landing in the draw at the default state.
 *
 * A session's floor is a snapshot of the mother taken once, at spawn, while the mother
 * keeps growing: a decomposition that lands afterwards reaches the dataset and not the
 * session. The two then disagree about what exists — a prompt rolled against the
 * mother's current fragments cites identities the floor never held, and `recordPiece`
 * rejects that lineage. This is the merge that closes the gap on resume.
 *
 * IT ADDS AND IT NEVER REMOVES. A fragment the mother no longer holds — its media item
 * archived, a later decomposition returning something different — stays on the floor.
 * The session is a break-off and its copies are its own; dropping one would strand the
 * lineage of every piece already recorded against it, which is the thing the floor
 * exists to keep resolvable. `rebuildFragments` is the other operation, and the
 * difference between the two is why both exist.
 *
 * IT DOES NOT TOUCH STEER STATE. An identity the floor already holds is left exactly as
 * it stands: darkened stays darkened, and a weight stays where the user put it. Only a
 * genuinely new identity is given `DEFAULT_FRAGMENT_STATE`. Rebuilding the floor from
 * the mother instead would undo every steer the session had accumulated.
 *
 * The session is returned UNCHANGED — the same object — when there is nothing to add,
 * so a caller can compare by reference and skip a write.
 */
export function reconcileFloor(
  session: MuseSession,
  fragments: readonly Fragment[],
): MuseSession {
  const added: Fragment[] = []
  const seen = new Set<string>()
  for (const fragment of fragments) {
    const key = fragmentKey(fragment)
    if (session.floor.has(key) || seen.has(key)) continue
    seen.add(key)
    added.push(copyFragment(fragment))
  }
  if (added.length === 0) return session

  const floor = new Map(session.floor)
  for (const fragment of added) floor.set(fragmentKey(fragment), { ...DEFAULT_FRAGMENT_STATE })
  return { ...session, fragments: [...session.fragments, ...added], floor }
}

/**
 * Name the session's own dataset — the record its saved pieces land in.
 *
 * Called once, by the first save: the dataset is minted lazily rather than at spawn,
 * so a session that never saves leaves nothing behind. Once named, the id is fixed —
 * a session already carrying one is returned unchanged, so a second save cannot
 * re-point the session at a different record and strand the pieces already in the
 * first one.
 *
 * THE MOTHER IS NOT REACHABLE FROM HERE. This sets a field on the session and nothing
 * else; `motherDatasetId` is not touched, and no function in this module writes to any
 * dataset at all.
 */
export function withSessionDataset(session: MuseSession, datasetId: string): MuseSession {
  if (session.sessionDatasetId) return session
  return { ...session, sessionDatasetId: datasetId }
}

// --- The setup ---------------------------------------------------------------
//
// The floor is what a session draws from; the SETUP is what it fires that draw
// through. The flow, the run shape, the model stack and the standing affix are all
// choices the user makes once and works under for the rest of a sitting, and they
// belong to the session for the same reason the floor does: a session is already a
// durable, owner-scoped, resumable thing, and a setup held only in one browser would
// disagree with the session the moment it is opened anywhere else.
//
// IT LIVES ON THE PURE SESSION, NOT ON THE ENVELOPE. `src/types/museSession.ts` says
// the envelope's four fields are persistence's business and do not change; a setup is
// a domain choice that moves whenever the user moves it, so it is a field of the
// session value and is mutated the way every other one is — through a function here
// that takes a session and returns a new one.
//
// WHAT IT DELIBERATELY CANNOT HOLD is as load-bearing as what it does. There is no
// field for the infinite-mode acknowledgement and no field for which controls were
// folded. The acknowledgement is consent for ONE sitting to run with no count to stop
// it, so a restored setup that came back pre-consented would let a reload arrive
// already agreed to an unbounded spend; a fold is view state and has no business on
// the server. Neither has a key to land in, and `normalizeSetup` reads the fields it
// defines one at a time rather than spreading what it was handed, so neither can be
// written by a caller that sends one.

/** How a stream is run: a fixed number of pieces, or until it is stopped. */
export type MuseRunMode = 'batched' | 'infinite'

/**
 * One model on the stored stack.
 *
 * `nomen` rides alongside the id because it is what a resume has left to say with
 * when the model itself is gone — deleted, or a private one the catalog no longer
 * offers. A stack that could name a missing entry only by its id could not tell the
 * user which of their models it was.
 *
 * `weight` is ABSENT for "the model's own default", which is what a bare trigger word
 * means to the resolver. The weight BAND belongs to the control that offers it, not
 * to this module, so a finite weight is stored as given and clamped where the band is
 * defined.
 */
export interface MuseNozzleEntry {
  intellaId: string
  nomen: string
  trigger: string
  weight?: number
}

/**
 * The run setup a session comes back with.
 *
 * Every field is optional: a setup is assembled one control at a time and a session
 * may hold only part of one.
 */
export interface MuseSetup {
  /** The flow the session fires at. */
  modusId?: string
  /** Batched or infinite. */
  mode?: MuseRunMode
  /** Batched only: how many pieces one launch fires. */
  cap?: number
  /** The model stack, in the order the user stacked it. */
  nozzle?: readonly MuseNozzleEntry[]
  /** The standing instruction that leads every prompt fired on this nozzle. */
  prefix?: string
  /** The standing instruction that trails every prompt fired on this nozzle. */
  suffix?: string
}

function isRunMode(value: unknown): value is MuseRunMode {
  return value === 'batched' || value === 'infinite'
}

/** A trimmed string, or `undefined` for anything that is not one or is empty. */
function setupText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * The stack off the wire: entries naming a model and a trigger word, de-duplicated by
 * `intellaId` with the first occurrence winning.
 *
 * Both refusals mirror the picker's own. An entry with no trigger word is weights that
 * would be fetched and never applied — a paid run with no effect — and a repeated
 * `intellaId` describes a run that does not exist, because the compiler de-dupes
 * pinned refs on its own.
 */
function setupNozzle(value: unknown): MuseNozzleEntry[] {
  if (!Array.isArray(value)) return []
  const out: MuseNozzleEntry[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const intellaId = setupText(entry.intellaId)
    const trigger = setupText(entry.trigger)
    if (!intellaId || !trigger) continue
    if (seen.has(intellaId)) continue
    seen.add(intellaId)
    const weight = entry.weight
    out.push({
      intellaId,
      nomen: setupText(entry.nomen) ?? intellaId,
      trigger,
      ...(typeof weight === 'number' && Number.isFinite(weight) ? { weight } : {}),
    })
  }
  return out
}

/**
 * A setup as it will be stored: the six fields this module defines, read out of an
 * untrusted value one at a time.
 *
 * Non-vacuity: spreading the input instead of reading its fields must fail "a setup
 * cannot carry an infinite-mode acknowledgement, whatever the caller sends".
 */
export function normalizeSetup(raw: unknown): MuseSetup {
  const body = (raw ?? {}) as Record<string, unknown>
  const modusId = setupText(body.modusId)
  const mode = isRunMode(body.mode) ? body.mode : undefined
  const cap =
    typeof body.cap === 'number' && Number.isFinite(body.cap)
      ? Math.max(1, Math.trunc(body.cap))
      : undefined
  const nozzle = setupNozzle(body.nozzle)
  const prefix = setupText(body.prefix)
  const suffix = setupText(body.suffix)

  return {
    ...(modusId ? { modusId } : {}),
    ...(mode ? { mode } : {}),
    ...(cap !== undefined ? { cap } : {}),
    ...(nozzle.length > 0 ? { nozzle } : {}),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  }
}

/**
 * Replace the session's setup with the normalized form of `raw`.
 *
 * WHOLESALE rather than field by field: a setup is one picture of what the screen is
 * about to fire, and a merge would leave a model on the stack after the user took it
 * off. A setup that normalizes to nothing removes the field rather than storing an
 * empty object, so a session that never had one and a session whose setup was cleared
 * read identically.
 */
export function withSetup(session: MuseSession, raw: unknown): MuseSession {
  const setup = normalizeSetup(raw)
  if (Object.keys(setup).length === 0) {
    if (!session.setup) return session
    const { setup: _cleared, ...rest } = session
    return rest
  }
  return { ...session, setup }
}

// --- Kept rolls --------------------------------------------------------------
//
// Rolling is free and a roll in progress is uncommitted work: the rolls a session
// produces, and the edits made to their text, are the sitting's own and stay in the
// browser. KEEPING one is different. It is an explicit act — the user has read a
// prompt and said this one is worth having — and an explicit act that a navigation
// erases is an act the product did not honour. So a kept roll, and only a kept roll,
// gets a home on the session.
//
// A KEPT ROLL IS NOT A PIECE. A piece is an entry in the ledger and names a run that
// produced media; a kept roll names no run, because nothing has been fired. The two
// are recorded separately because they are different facts, and folding one into the
// other would mean either inventing a run id or storing prompt text on a shape that
// has no field for it.
//
// THE LIST IS APPEND-ONLY AND THERE IS NO REMOVE. Keeping the same prompt twice is
// the user's business and stores two entries: the alternative is a de-dupe rule that
// silently discards an act the user made on purpose. Removing a kept roll is a
// separate gesture with a separate decision behind it and is deliberately not built
// here.

/**
 * One roll the user kept: the prompt as it stood, and whether firing it would be paid.
 *
 * EXACTLY TWO FIELDS. The verdict rides along because it is not recoverable later —
 * whether a roll is paid is decided by the fragments it drew and the nozzle it was
 * rolled against, both of which move — while everything else about a roll (its index,
 * its lineage, the report it came from) belongs to the sitting that produced it and
 * means nothing once that sitting is over.
 */
export interface KeptRoll {
  /** The prompt as the user kept it, edits included. */
  prompt: string
  /** Whether firing this prompt would be a paid run. */
  paid: boolean
}

/**
 * Kept rolls as they will be stored, read out of an untrusted value one entry and one
 * field at a time.
 *
 * ANYTHING THAT IS NOT A WELL-FORMED ENTRY IS DROPPED, never repaired. A prompt that
 * is not a non-empty string is not a prompt, and a `paid` that is not a boolean is not
 * a verdict — defaulting either one would store a kept roll the user never kept, or
 * label a paid prompt free. Unknown keys are dropped because the fields are read by
 * name rather than spread, which is the same discipline `normalizeSetup` follows and
 * for the same reason: a caller must not be able to attach state to a session by
 * sending it.
 *
 * A non-array input normalizes to the empty list. Absent ≡ empty everywhere.
 */
export function normalizeKeptRolls(raw: unknown): KeptRoll[] {
  if (!Array.isArray(raw)) return []
  const out: KeptRoll[] = []
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object') continue
    const entry = candidate as Record<string, unknown>
    if (typeof entry.prompt !== 'string') continue
    const prompt = entry.prompt.trim()
    if (!prompt) continue
    if (typeof entry.paid !== 'boolean') continue
    out.push({ prompt, paid: entry.paid })
  }
  return out
}

/**
 * Append one kept roll to the session's list.
 *
 * Pure like every other mutator here, and normalize-guarded: the roll offered is read
 * through `normalizeKeptRolls`, so a malformed one returns the session unchanged
 * rather than landing a half-formed entry. A duplicate prompt is appended, not
 * collapsed — see the section note.
 */
export function keepRoll(session: MuseSession, roll: unknown): MuseSession {
  const [kept] = normalizeKeptRolls([roll])
  if (!kept) return session
  return { ...session, keptRolls: [...(session.keptRolls ?? []), kept] }
}

/** The session's kept rolls. Absent reads as the empty list, everywhere. */
export function keptRollsOf(session: MuseSession): readonly KeptRoll[] {
  return session.keptRolls ?? []
}

// --- Widening the floor ------------------------------------------------------
//
// Every other mutator in this module REWEIGHTS a floor: a fragment is turned off,
// or drawn more often, or recorded in the ledger. None of them WIDEN one — a piece
// is assembled from fragments already present, so nothing a session does to its own
// output puts a phrase on the floor that was not there when it spawned. A floor is
// widened either by decomposing more source images into the mother, or by the user
// writing a fragment themselves. This is the second one.
//
// It is pure like everything else here: it takes a session and returns a new one,
// makes no request, and reaches nothing outside this module. A manually added
// fragment costs nothing to add because nothing is called to add it.

/**
 * The `source` a fragment the user wrote carries.
 *
 * Attribution is load-bearing (`garden.ts`): `source` and `trigger` together are
 * what turns a roll back into model bindings, so a fragment cannot be given a blank
 * pair and left ambiguous about where it came from. A fragment the user typed came
 * from no moodboard entry and binds no model, so its attribution is STATED rather
 * than inferred — the source is this literal, and the trigger is empty because there
 * is no model behind it. `roll.ts` already reads an empty trigger as "no binding":
 * `triggersOf` collects only non-empty triggers and `formatRoll` omits the binding
 * arrow, so a manual fragment composes into a prompt and attaches nothing.
 *
 * A literal rather than an absent field, so a manual fragment stays distinguishable
 * from a lifted one everywhere attribution is read. The two are different
 * provenance and should not merge into one bucket.
 */
export const MANUAL_SOURCE = 'manual'

/** Thrown when a fragment is offered for a category the taxonomy does not define. */
export class UnknownCategoryError extends Error {
  /** The category that was offered and is not in the taxonomy. */
  readonly category: string

  constructor(category: string) {
    super(`'${category}' is not a Muse fragment category`)
    this.name = 'UnknownCategoryError'
    this.category = category
  }
}

/** Thrown when a fragment is offered with no text of its own. */
export class EmptyFragmentTextError extends Error {
  constructor() {
    super('a fragment needs text')
    this.name = 'EmptyFragmentTextError'
  }
}

/**
 * A fragment the user wrote, ready to be put on a floor.
 *
 * THE CATEGORY IS CONSTRAINED TO THE TAXONOMY, and that is the whole reason this
 * function exists rather than a caller assembling the object literal. The sampler
 * iterates `CATEGORIES` and `buildGarden` groups by category, so a fragment filed
 * under anything else lands in a pool nothing ever reads: it would sit on the floor,
 * count towards the floor's totals, and never be drawn. Rejecting it at the door is
 * the difference between a fragment that widens the floor and one that only looks
 * like it did.
 *
 * The text is trimmed to the identity `fragmentKey` will key it by, so the fragment
 * as stored reads the same as the fragment as identified.
 */
export function manualFragment(category: string, text: string): Fragment {
  if (!isCategory(category)) throw new UnknownCategoryError(category)
  const trimmed = text.trim()
  if (!trimmed) throw new EmptyFragmentTextError()
  return {
    category: category as Category,
    text: trimmed,
    source: MANUAL_SOURCE,
    trigger: '',
  }
}

/**
 * Put a fragment on the session's floor, in the draw at even odds.
 *
 * ADDING A FRAGMENT THE FLOOR ALREADY HOLDS CHANGES NOTHING. `fragmentKey` is the
 * identity and `buildGarden` already dedupes on it, so a second copy of one identity
 * is not a second fragment — it is one fragment counted twice, which silently doubles
 * that phrase's odds in every roll and leaves two entries for any later steer to land
 * on. The session is returned unchanged instead, so adding what is already there is a
 * no-op rather than an error: the fragment the user asked for is on the floor either
 * way, including when the identity they typed is one a steer had darkened.
 *
 * THE MOTHER IS NEVER TOUCHED. The session works from its own copies (`spawnSession`),
 * and this appends a fresh copy to a NEW list rather than pushing onto the array the
 * session was spawned from — a manual add reaches the mother dataset's fragments
 * neither by reference nor by write. A fragment the user wrote belongs to the session
 * that spawned it and to nothing above it.
 */
export function addFragment(session: MuseSession, fragment: Fragment): MuseSession {
  const key = fragmentKey(fragment)
  if (session.floor.has(key)) return session

  const owned = copyFragment(fragment)
  const floor = new Map(session.floor)
  floor.set(key, { ...DEFAULT_FRAGMENT_STATE })
  return { ...session, fragments: [...session.fragments, owned], floor }
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

/** Thrown when a piece is recorded for a run this session's ledger already holds. */
export class DuplicatePieceError extends Error {
  /** The run that already has an entry in this session's ledger. */
  readonly runId: string

  constructor(runId: string) {
    super(`this session already recorded a piece for run '${runId}'`)
    this.name = 'DuplicatePieceError'
    this.runId = runId
  }
}

/** Thrown when an update names a run this session's ledger holds no entry for. */
export class UnknownPieceError extends Error {
  /** The run that has no entry in this session's ledger. */
  readonly runId: string

  constructor(runId: string) {
    super(`this session has no recorded piece for run '${runId}'`)
    this.name = 'UnknownPieceError'
    this.runId = runId
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
 *
 * ONE ENTRY PER RUN. The run identifies the piece, so a record for a run the
 * ledger already holds is rejected rather than appended: two entries for one run
 * double that piece's lineage in every read of the ledger, and anything naming
 * the run — a reaction, a dismissal, a save-back — then has two entries to land
 * on. Changing a piece already in the ledger is `updatePiece`.
 */
export function recordPiece(session: MuseSession, piece: PieceRecord): MuseSession {
  if (session.pieces.some((p) => p.runId === piece.runId)) throw new DuplicatePieceError(piece.runId)

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

/** What an update may change about a piece already in the ledger. */
export type PiecePatch = {
  /** What the user said about the piece. */
  reaction?: Reaction
  /** Whether the piece is discarded. */
  dismissed?: boolean
  /**
   * Whether the piece has been put back into the set.
   *
   * Set by the save path once the piece's media is in the session's own dataset, so
   * the ledger entry says whether this piece went back in. It is deliberately NOT
   * reachable from the piece-patch route: a flag claiming a piece was saved, written
   * without the media landing anywhere, would be a ledger that disagrees with the
   * dataset. The wire validation for that route reads `reaction` and `dismissed` only.
   */
  saved?: boolean
}

/**
 * Change what the session says about a piece already in its ledger.
 *
 * A reaction and a dismissal both arrive AFTER the piece exists — the roll is
 * recorded when it lands, and the user reacts to it later — so they cannot be
 * carried on the record call and there has to be a way to reach a recorded piece
 * again. This is that way, and it is the only one: lineage, run and roll index
 * are fixed at record time and are not patchable, because they describe what
 * produced the piece rather than what anyone thinks of it.
 *
 * Pure like every other mutator here: the named piece is replaced in a new ledger
 * array, in place, and a new session is returned. A run the ledger does not hold
 * is rejected rather than created — an update never records a piece.
 */
export function updatePiece(session: MuseSession, runId: string, patch: PiecePatch): MuseSession {
  const index = session.pieces.findIndex((p) => p.runId === runId)
  if (index < 0) throw new UnknownPieceError(runId)

  const current = session.pieces[index]!
  const updated: Piece = {
    ...current,
    dismissed: patch.dismissed ?? current.dismissed,
    saved: patch.saved ?? current.saved,
    ...(patch.reaction !== undefined ? { reaction: patch.reaction } : {}),
  }

  const pieces = [...session.pieces]
  pieces[index] = updated
  return { ...session, pieces }
}

/** The lineage of one recorded piece — the fragments that produced it. */
export function lineageOf(session: MuseSession, runId: string): readonly Fragment[] | undefined {
  return session.pieces.find((p) => p.runId === runId)?.fragments
}

/** One recorded piece by the run that produced it, or `undefined` if the ledger has none. */
export function pieceOf(session: MuseSession, runId: string): Piece | undefined {
  return session.pieces.find((p) => p.runId === runId)
}
