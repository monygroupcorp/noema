// The session (noema-241): the floor sheet, live reactions, kept rolls, gesture refusal,
// promotion into a collection, garden-chip curation, and manual adds. All of it reads and
// writes the session's own floor — the screen holds no copy of it (see the note at the top
// of `../muse.ts`).

import { CATEGORIES, fragmentKey, isCategory } from '../../../../../../crystal/muse/taxonomy.js';
import { WEIGHT_MAX, WEIGHT_MIN } from '../../../../../../crystal/muse/sampler.js';
import type { FragmentState } from '../../../../../../crystal/muse/sampler.js';
import { lineageOf as recordedLineage, type MuseSession } from '../../../../../../crystal/muse/session.js';
import type {
  Fragment,
  FragmentCategory,
  MuseFragmentIdentity,
  MuseKeptRoll,
  MusePieceRecord,
  MuseReaction,
  MuseSessionView,
} from '../api';
import type { StreamPiece, StreamState } from './stream';

// ── The session: the floor sheet and live reactions (noema-241) ──────────────
// A session is a break-off of a dataset with its own fragments, its own floor and
// its own piece ledger (`src/crystal/muse/session.ts`, persisted through the routes
// in `./api.ts`). The mother dataset is never written to by it (S7).
//
// The screen holds NO copy of the floor. Every mutator returns the whole updated
// session and the screen re-renders from that response, so what is on screen is what
// the server stored — and the floor is still there after a reload, which a
// client-local copy could not be.
//
// Two records, both required, for one heart: the reaction lands on the PIECE
// (`PATCH …/pieces/:runId`) and the weights land on the FLOOR (`PATCH …/floor/weight`,
// one call per fragment of that piece's recorded lineage). The lineage read is the
// CRYSTAL `lineageOf(session, runId)` — the session's own record of what produced the
// piece — reached through the session read. It is a different function from
// `lineageOf` above, which reads a `StreamPiece` the screen is holding, and the two
// are not interchangeable: only the session's record survives a reload.
//
// Nothing here edits the floor from an inference. A ♡ or 😢 is the user's own tap on a
// named piece, which is what makes writing it without a consent sheet correct; the
// inferred edits the consent sheet governs (S9/S12) are a later rung, and dismissal
// deliberately proposes nothing (S12).

/**
 * The session as the pure crystal module wants it, rebuilt from the wire view.
 *
 * The floor travels as an entry array and is read back into the `SteerState` map the
 * sampler and `session.ts` both take. This mirrors `floorFromEntries` in
 * `src/types/museSession.ts` rather than importing it: the app's docker build stage
 * copies `src/crystal/muse/` and nothing else of the backend tree, so an import from
 * `src/types` resolves everywhere except the image build. The identity itself is NOT
 * rebuilt here — the keys are the entries' own, written by `fragmentKey`.
 */
export function sessionFromView(view: MuseSessionView): MuseSession {
  const floor = new Map<string, FragmentState>();
  for (const e of view.floor) floor.set(e.key, { enabled: e.enabled, weight: e.weight });
  return {
    motherDatasetId: view.motherDatasetId,
    fragments: view.fragments,
    floor,
    pieces: view.pieces,
  };
}

/**
 * The session the screen resumes into: the caller's most recently changed session off
 * this dataset, or `null` when there is none to resume and one must be spawned.
 *
 * The app route (`/datasets/:id/muse`) carries no session segment and the dataset holds
 * no session pointer, so this lookup is how the screen finds its floor again after a
 * reload. Non-vacuity: taking a client-local copy instead must fail "the floor sheet
 * survives a reload".
 */
export function latestSession(sessions: readonly MuseSessionView[]): MuseSessionView | null {
  let latest: MuseSessionView | null = null;
  for (const s of sessions) {
    if (!latest || s.mutatum > latest.mutatum) latest = s;
  }
  return latest;
}

/** The floor's own record of what produced a piece, or `[]` when the ledger holds no
 *  entry for that run. This is the lineage a reaction weights — never the stream
 *  piece's client-side copy, which a reload does not carry. */
export function pieceLineage(view: MuseSessionView, runId: string): readonly Fragment[] {
  return recordedLineage(sessionFromView(view), runId) ?? [];
}

/** One recorded piece, or `undefined` when the ledger holds no entry for that run. */
export function recordedPiece(view: MuseSessionView, runId: string) {
  return view.pieces.find((p) => p.runId === runId);
}

/** What the session currently says about a piece, if anything. */
export function reactionOf(view: MuseSessionView, runId: string): MuseReaction | undefined {
  return recordedPiece(view, runId)?.reaction;
}

/**
 * Whether the session's ledger says this piece has been put back into the set.
 *
 * Read off the SESSION, never off the stream tile: the tile is a client-side record of
 * this page's own firing and a reload does not carry it, while the ledger entry is the
 * server's. A saved piece therefore still reads as saved after a reload.
 *
 * Non-vacuity: reading a tile-local flag instead must fail "a saved piece still reads as
 * saved after the screen re-renders from the session".
 */
export function savedOf(view: MuseSessionView, runId: string): boolean {
  return recordedPiece(view, runId)?.saved ?? false;
}

// ── Kept rolls (noema-329) ───────────────────────────────────────────────────
// Rolling is free and a roll in progress is uncommitted work, so the report this
// screen is showing and the edits made to its text are the screen's own. KEEPING is
// the explicit act, and an explicit act that a navigation erases is one the product
// did not honour — so a kept roll is written to the session and the panel is rendered
// from the session, exactly as the floor pills and the piece rail already are.

/**
 * What one keep sends: the prompt as it stands, and its paid/free verdict.
 *
 * The prompt is the EDITED text where the user edited it, because that is the prompt
 * they read before deciding to keep it. The verdict is carried rather than recomputed
 * later — whether the prompt fires as a paid run depends on what it drew and what it
 * was rolled against, and both of those move.
 */
export function keptRollRequest(prompt: string, paid: boolean): MuseKeptRoll {
  return { prompt: prompt.trim(), paid };
}

/** Whether a keep can be sent at all — a session to write against, and a prompt to keep. */
export function keepBlocked(view: MuseSessionView | null | undefined, prompt: string): boolean {
  return !view || !prompt.trim();
}

/**
 * The kept rolls the panel renders, oldest first.
 *
 * Read off the SESSION and never off a local list. A local list is this page's own
 * record of this sitting and does not survive leaving the screen, while the session's
 * is the server's — so a kept roll is still there when the screen is opened again.
 * Absent reads as empty, so a session stored before the field existed renders as a
 * session with nothing kept rather than as an error.
 *
 * Non-vacuity: rendering a local `kept` array instead must fail "the kept panel comes
 * back with the session".
 */
export function keptRollsOf(view: MuseSessionView | null | undefined): MuseKeptRoll[] {
  return view?.keptRolls ?? [];
}

/** The panel's heading count — how many rolls the session is holding. */
export function keptCount(view: MuseSessionView | null | undefined): number {
  return keptRollsOf(view).length;
}

// ── Why a gesture is refused (noema-277) ─────────────────────────────────────
// A gesture on a piece is a weight written against a recorded lineage, so the rail
// is gated on the session's ledger holding that piece. Four different situations
// reach that same refusal, and only one of them is "unavailable" in any sense a
// reader would recognise: the ledger has no entry for the piece, a gesture on it is
// already being written, the piece is already in the set, or no session is open yet.
//
// The gating rule itself is unchanged by anything below — `gestureBlock` returns a
// non-null value in exactly the cases the rail was already disabled in. What is added
// is the reason, so a refused control can say which of the four it is.

/** Why a gesture on a piece cannot be made right now.
 *
 *  - `no-session` — no session is open yet, so there is no ledger to write against.
 *  - `not-recorded` — the session holds no entry for this piece, so a reaction has no
 *    lineage to attach to. This is a state a piece does not leave on its own.
 *  - `in-flight` — a gesture on this piece is already being written. The only one of
 *    the four that resolves by waiting.
 *  - `saved` — the piece is already in the set. The set is append-only, so a second
 *    save would put the same media in twice.
 *  - `not-offered` — this rail does not carry this gesture (the tile omits save, which
 *    is a decision considered rather than made at scroll speed). */
export type GestureBlock = 'no-session' | 'not-recorded' | 'in-flight' | 'saved' | 'not-offered';

/** Everything the rail knows about one piece when it decides whether a gesture may be
 *  made. `saved` and `offered` are per-gesture; the first three are per-piece. */
export interface GestureGate {
  /** Whether a session is open at all. */
  hasSession: boolean;
  /** Whether the session's ledger holds this piece. */
  recorded: boolean;
  /** Whether a gesture on this piece is already being written. */
  writing: boolean;
  /** Save only: the piece is already in the set. */
  saved?: boolean;
  /** False when this rail does not carry the gesture. Defaults to true. */
  offered?: boolean;
}

/**
 * The single reason a gesture is refused, or `null` when it may be made.
 *
 * Order is the order the screen already refused in, and it is preserved deliberately:
 * a rail with no session is refused before the ledger is consulted, a piece the ledger
 * never took is refused before an in-flight write, and `saved` is read last because it
 * only ever applies to a piece that is otherwise gestureable.
 *
 * Non-vacuity: returning `null` unconditionally must fail every reason test below;
 * reordering `saved` above `not-recorded` must fail "a piece the ledger never took
 * says so".
 */
export function gestureBlock(gate: GestureGate): GestureBlock | null {
  if (gate.offered === false) return 'not-offered';
  if (!gate.hasSession) return 'no-session';
  if (!gate.recorded) return 'not-recorded';
  if (gate.writing) return 'in-flight';
  if (gate.saved) return 'saved';
  return null;
}

/** The sentence a refusal is worded as — the product's own words for the state, in the
 *  register the rest of the screen speaks in.
 *
 *  `not-recorded` says what happened and stops there. It does not say "try again": a
 *  piece that was never written to the session does not become written by waiting, and
 *  offering a retry that does not exist would be the same silence in a friendlier font. */
const GESTURE_REASON: Record<GestureBlock, string> = {
  'no-session': 'the session is still opening — gestures land once it is ready',
  'not-recorded': 'this piece was not written to the session, so there is nothing to react against',
  'in-flight': 'writing your last gesture on this piece…',
  saved: 'saved — this piece is in the set',
  'not-offered': 'open the piece to save it back into the set',
};

/** The words for a refusal. */
export function gestureBlockLine(block: GestureBlock): string {
  return GESTURE_REASON[block];
}

/** What a rail button says: the reason it is refused, or its own label when it is not.
 *  Every disabled gesture therefore carries a reason rather than a bare glyph, and the
 *  saved piece keeps the wording it already had. */
export function gestureTitle(block: GestureBlock | null, label: string): string {
  return block ? GESTURE_REASON[block] : label;
}

/** The factor one steer moves a fragment's weight by. The sampler's bounds are
 *  0.125–8 — a 64:1 span — so a doubling per tap reaches either end in three steps
 *  and every step stays inside a range the sampler still draws from. */
export const STEER_FACTOR = 2;

/** One steer's effect on one fragment's weight, clamped to the sampler's bounds. The
 *  server clamps too; clamping here keeps the number the screen shows equal to the
 *  number the floor will hold. */
export function steerWeight(current: number, direction: 'up' | 'down'): number {
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  const next = direction === 'up' ? base * STEER_FACTOR : base / STEER_FACTOR;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, next));
}

/** One floor write: the fragment named by its identity, and the weight to store. */
export interface WeightWrite { fragment: MuseFragmentIdentity; weight: number }

/**
 * The floor writes one reaction produces: every fragment in the piece's RECORDED
 * lineage, moved one step in the direction of the reaction.
 *
 * 😂 (`note`) produces none — it is recorded on the piece and steers nothing (S4, V9).
 * A run the ledger holds no entry for produces none either: there is no lineage to
 * weight, so nothing is written rather than something guessed.
 *
 * Non-vacuity: reverting this to `[]` for `up` must fail "hearting a piece weights
 * every fragment in its lineage up"; returning writes for `note` must fail "😂 records
 * a note and changes no weight".
 */
export function weightWrites(
  view: MuseSessionView,
  runId: string,
  reaction: MuseReaction,
): WeightWrite[] {
  if (reaction === 'note') return [];
  const floor = new Map(view.floor.map((e) => [e.key, e]));
  return pieceLineage(view, runId).map((f) => ({
    fragment: { category: f.category, text: f.text },
    weight: steerWeight(floor.get(fragmentKey(f))?.weight ?? 1, reaction === 'up' ? 'up' : 'down'),
  }));
}

/** What is recorded at FIRE time: the run, which roll it was, and the lineage. The
 *  reaction is not carried here — the ledger is append-only and a reaction arrives
 *  after the piece exists, so it is attached by a later update. */
export function pieceRecord(
  runId: string,
  rollIndex: number,
  lineage: readonly Fragment[],
): MusePieceRecord {
  return { runId, rollIndex, fragments: lineage.map((f) => ({ category: f.category, text: f.text })) };
}

/**
 * Why a piece must not be fired: its lineage cites a fragment the open session's floor
 * does not hold. `null` when it is safe to fire.
 *
 * A FIRE SPENDS BEFORE IT RECORDS. `createRun` reserves and spends, and the ledger entry
 * is written afterwards; a lineage the floor cannot resolve is rejected at the record
 * call, by which point the run has already happened and been paid for, and the piece can
 * never be reacted to, saved or dismissed. This is the pre-flight that keeps that from
 * being paid for at all — it is derived from the floor and the lineage the screen
 * already holds, and it reads nothing on the spend path.
 *
 * No session open means no ledger entry is attempted, so there is nothing to refuse and
 * this returns `null`.
 *
 * With the resume-time floor reconcile in place this should not fire; it is the guard
 * for the case where the floor and the garden have drifted apart anyway.
 *
 * Non-vacuity: reverting this to `null` must fail "a piece whose lineage the floor does
 * not hold is refused before it is fired".
 */
export function lineageBlockReason(
  view: MuseSessionView | null,
  lineage: readonly Fragment[],
): string | null {
  if (!view) return null;
  const held = new Set(view.floor.map((e) => e.key));
  const missing = lineage.find((f) => !held.has(fragmentKey(f)));
  if (!missing) return null;
  return `this session's floor doesn't hold '${missing.category}: ${missing.text}' — reload the screen to pick up the set's fragments`;
}

/** One fragment as the floor sheet renders it. A disabled fragment is a pill like any
 *  other — dark, still listed, still tappable (S8). */
export interface FloorPill {
  category: FragmentCategory;
  text: string;
  enabled: boolean;
  weight: number;
}

/** One category's row in the floor sheet: its pills, and how many of them are in the draw. */
export interface FloorSheetCategory {
  category: FragmentCategory;
  live: number;
  total: number;
  fragments: FloorPill[];
}

/**
 * The floor as the pull-up sheet shows it (V1): every fragment the session holds,
 * grouped by category in sampling order, with a live/total count per category.
 *
 * A DISABLED FRAGMENT IS INCLUDED, marked not-enabled. That is the whole point of the
 * sheet — "what did my steer turn off" is the question it exists to answer, and a
 * sheet that dropped what a steer turned off could not answer it.
 * Non-vacuity: filtering disabled fragments out must fail "a disabled fragment is
 * still shown, dark, and can be tapped back to live".
 */
export function floorSheet(view: MuseSessionView): FloorSheetCategory[] {
  const state = new Map(view.floor.map((e) => [e.key, e]));
  const rows: FloorSheetCategory[] = [];
  for (const category of CATEGORIES) {
    const fragments: FloorPill[] = [];
    let live = 0;
    for (const f of view.fragments) {
      if (f.category !== category) continue;
      const entry = state.get(fragmentKey(f));
      const enabled = entry?.enabled ?? true;
      if (enabled) live += 1;
      fragments.push({ category: f.category, text: f.text, enabled, weight: entry?.weight ?? 1 });
    }
    if (fragments.length > 0) rows.push({ category, live, total: fragments.length, fragments });
  }
  return rows;
}

/** The session floor in one line: how many fragments are in the draw, out of how many
 *  the session holds. This is what the dock shows without the sheet being open. */
export function floorCounts(view: MuseSessionView): { live: number; total: number } {
  const state = new Map(view.floor.map((e) => [e.key, e]));
  let live = 0;
  for (const f of view.fragments) if ((state.get(fragmentKey(f))?.enabled ?? true) !== false) live += 1;
  return { live, total: view.fragments.length };
}

// ── Promotion: the garden becomes a collection (noema-307) ──────────────────
//
// Muse IS collection mode, played transiently. Promotion is the one gesture that says
// so: the floor as it stands becomes a collection's trait grid, and the session's engine
// — its flow, its standing affix, its stacked trigger words — becomes the base that grid
// expands. The mapping itself is the SERVER's (`api/musePromote.ts`), asserted there
// field by field; what lives here is only what the screen needs in order to decide
// whether to offer the gesture and where to go afterwards.
//
// It is offered while a stream is running. Promotion writes nothing to the session and
// spends nothing — it reads the floor and mints a draft — so there is no reason to make
// the user stop a stream they are paying for in order to take it.

/**
 * Why the promote gesture is refused, or `null` when it is available.
 *
 * The one refusal is an empty draw. A collection expands a grid, and a grid with no axis
 * has nothing to expand — the same completeness `fireCollection` enforces, said here
 * before a draft is minted rather than after it. A THIN floor is not refused: one axis
 * with one option is a collection of one repeated look, which is a choice and not an
 * error.
 */
export function promoteBlockReason(view: MuseSessionView | null | undefined): string | null {
  if (!view) return 'this sitting has no session yet';
  if (floorCounts(view).live <= 0) return 'nothing is in the draw — a collection needs at least one fragment';
  return null;
}

/** What the promote control says, given the floor behind it. Counted, because the count
 *  is the claim it makes: these are the fragments that become the collection's traits. */
export function promoteLabel(view: MuseSessionView | null | undefined): string {
  const live = view ? floorCounts(view).live : 0;
  return live === 1
    ? 'make a collection from this fragment'
    : `make a collection from these ${live} fragments`;
}

/** Where a promotion lands: the new draft's own trait garden, which is the first screen of
 *  the funnel that finishes what a session cannot supply — supply, review, DNA. */
export function promotedCollectionPath(collectionId: string): string {
  return `/collections/${encodeURIComponent(collectionId)}/garden`;
}

/** What tapping a floor pill writes: the same fragment, with its enabled flag flipped.
 *  Disable is reversible (S8) — the tap that darkens a pill is the tap that brings it
 *  back, and it is the same call in both directions. */
export function floorToggle(pill: FloorPill): { fragment: MuseFragmentIdentity; enabled: boolean } {
  return { fragment: { category: pill.category, text: pill.text }, enabled: !pill.enabled };
}

/**
 * Which flattened-garden indices the session floor has taken out of the draw.
 *
 * A darkened fragment stays on the floor and stays in the sheet; it is simply not
 * drawn. Merged with the screen's own curation set, this is what keeps a roll from
 * drawing a fragment a steer just turned off.
 */
export function floorDisabledIndices(
  fragments: readonly Fragment[],
  view: MuseSessionView | null,
): Set<number> {
  const out = new Set<number>();
  if (!view) return out;
  const state = new Map(view.floor.map((e) => [e.key, e]));
  fragments.forEach((f, i) => {
    if (state.get(fragmentKey(f))?.enabled === false) out.add(i);
  });
  return out;
}

/** Two exclusion sets as one — both keep a fragment out of the next roll. */
export function mergedExclusions(...sets: ReadonlyArray<ReadonlySet<number>>): Set<number> {
  const out = new Set<number>();
  for (const s of sets) for (const i of s) out.add(i);
  return out;
}

// ── Garden chips: one curation channel, and it is the floor (noema-320) ──────
// The garden chip and the floor pill are two views of ONE fact — whether a
// fragment is in the draw — so they read and write the same place: the session
// floor. A chip's checked-ness is DERIVED from the floor rather than held beside
// it, which is what makes the garden the same garden after a reload and what
// makes a promotion carry the subset that is on screen (`musePromote.ts` builds
// the collection from the enabled floor: darkening a fragment IS the curation).
//
// The index space is positional (`flattenGarden`) while the floor's key space is
// `category:text`, and the mapping is many-to-one: the same phrase pooled from
// several media items occupies several chip positions and ONE floor key, so
// toggling any one of them moves all of them. That is the correct reading of a
// single curation channel, not a defect to fight with per-index state.

/** Whether the session floor holds this fragment at all. The garden is pooled from the
 *  mother dataset client-side while the floor is session-owned, so a client holding a
 *  stale session can render a chip whose key the floor does not carry — and a write
 *  against a key the floor does not hold is a no-op server-side. The caller re-reads the
 *  session (the GET reconciles the floor against the mother's live garden) rather than
 *  letting a click disappear. */
export function floorHolds(
  view: MuseSessionView | null,
  fragment: Pick<Fragment, 'category' | 'text'>,
): boolean {
  if (!view) return false;
  const key = fragmentKey(fragment);
  return view.floor.some((e) => e.key === key);
}

/** Every garden chip's checked-ness, derived from the session floor: a chip is checked
 *  when its fragment is in the draw. With no session nothing is darkened yet. */
export function chipStates(
  fragments: readonly Fragment[],
  view: MuseSessionView | null,
): boolean[] {
  const off = floorDisabledIndices(fragments, view);
  return fragments.map((_, i) => !off.has(i));
}

/** What tapping a garden chip writes: the fragment at that position, with its enabled
 *  flag flipped — the same write and the same route as a floor pill's tap. `null` when
 *  there is nothing to write (no session yet, or an index off the end of the garden). */
export function chipToggle(
  fragments: readonly Fragment[],
  index: number,
  view: MuseSessionView | null,
): { fragment: MuseFragmentIdentity; enabled: boolean } | null {
  if (!view) return null;
  const f = fragments[index];
  if (!f) return null;
  const on = !floorDisabledIndices(fragments, view).has(index);
  return { fragment: { category: f.category, text: f.text }, enabled: !on };
}

// ── Manual add: the free way to widen a floor (noema-242) ────────────────────
// A piece is composed from fragments already on the floor, so working the session
// reweights the floor and never widens it. Short of decomposing more source images,
// a fragment the user writes is the only thing that puts a phrase on a narrow floor
// that was not already there — which is what the readout's "add to the floor" offer
// resolves to when it is taken without spending.
//
// Everything below is pure and free by construction: the whole of what the add sends
// is a category and a text, and there is no second call behind it.

/** The categories the form offers, in sampling order — the taxonomy and nothing else. */
export const MANUAL_CATEGORIES = CATEGORIES;

/**
 * The whole of what a manual add sends: the fragment's category and its text.
 *
 * A MANUAL ADD IS FREE. No flow id, no aditus, no pinned model, no quote and no key
 * ride this request, and no run is created behind it — compare `ignitionRequest`,
 * which is the metered path and carries a `modusId`. That is the product rule (V3),
 * not an implementation detail: the LLM-assisted add is a separate, metered surface.
 * Non-vacuity: giving this path a flow, a model or any other field must fail "a
 * manual add reaches no model and no key".
 */
export function manualAddRequest(category: FragmentCategory, text: string): MuseFragmentIdentity {
  return { category, text: text.trim() };
}

/**
 * Why the fragment on the form cannot be added yet, or `null` when it can.
 *
 * Three rules, and each is refused on the form rather than at the server:
 *
 *   THE CATEGORY MUST BE IN THE TAXONOMY. Prompts are composed by walking
 *   `CATEGORIES`, so a fragment filed outside them would sit on the floor, count in
 *   its totals, and never be drawn by any roll.
 *
 *   THE FRAGMENT NEEDS TEXT. An empty phrase has no identity to be keyed by.
 *
 *   A FRAGMENT ALREADY ON THE FLOOR IS NOT ADDED TWICE. `fragmentKey` is the
 *   identity; a second entry under it would double that phrase's odds in every roll
 *   and leave two entries for a later steer to land on. Said here so the form can
 *   name the fragment as already present — including when a steer has darkened it,
 *   which is the case a user is most likely to be retyping their way into.
 *
 * Non-vacuity: dropping the `isCategory` check must fail "a fragment cannot be added
 * outside the taxonomy"; dropping the identity check must fail "adding a fragment
 * already on the floor does not duplicate it".
 */
export function manualAddError(
  view: MuseSessionView | null,
  category: string,
  text: string,
): string | null {
  if (!isCategory(category)) return 'pick a category';
  const trimmed = text.trim();
  if (!trimmed) return 'write the fragment first';
  if (!view) return 'no session yet';
  const key = fragmentKey({ category, text: trimmed });
  const held = view.floor.find((e) => e.key === key);
  if (held) {
    return held.enabled
      ? "that fragment is already on the floor"
      : "that fragment is already on the floor — it's turned off, tap it to bring it back";
  }
  return null;
}

/**
 * Take a dismissed piece off the scroll. ✕ is declutter: it is recorded on the piece
 * and it writes NOTHING to the floor, and it proposes nothing — the count-to-proposal
 * behaviour rides the consent sheet, which is a later rung (S12).
 */
export function dismissFromStream(state: StreamState, runId: string): StreamState {
  const drop = (p: StreamPiece) => p.runId !== runId;
  return { pieces: state.pieces.filter(drop), pending: state.pending.filter(drop) };
}

