// Muse (dataset-wide garden, curate, roll) — the web app's front end onto the muse
// engine in `src/crystal/muse`. That module lives outside this app's own
// `tsconfig.json` `include` (see the note on `DatasetMediaItem` in `./api.ts`), but a
// direct relative import resolves fine through this app's own `tsc --noEmit` and
// `vite build` — verified before this file existed. Nothing below reimplements
// garden/roll/sampler/weaver logic; it is a thin, pure composition layer over it, so
// there is exactly one copy of that logic in the tree.

import {
  buildGarden,
  gardenCounts,
  type GardenBuild,
  type GardenDrops,
} from '../../../../../crystal/muse/garden.js';
import { rollReport, formatRoll, type RolledPrompt, type RollReport } from '../../../../../crystal/muse/roll.js';
import { CATEGORIES, fragmentKey, isCategory, type Category, type Garden } from '../../../../../crystal/muse/taxonomy.js';
import { WEIGHT_MAX, WEIGHT_MIN, rollFragments } from '../../../../../crystal/muse/sampler.js';
import { composeTemplate, detectConflicts } from '../../../../../crystal/muse/weaver.js';
import { lineageOf as recordedLineage, type MuseSession } from '../../../../../crystal/muse/session.js';
import {
  MAX_FLOOR_FRAGMENTS,
  MAX_INSTRUCTION_CHARS,
} from '../../../../../crystal/muse/steer.js';
import type { FragmentState } from '../../../../../crystal/muse/sampler.js';
import { mediaFromOutput, type Media } from './media';
import type {
  AddDatasetMediaRequest,
  Fragment,
  FragmentCategory,
  MuseSteerProposal,
  DatasetMediaItem,
  FlowSummary,
  FlowDescription,
  MuseFragmentIdentity,
  MusePieceRecord,
  MuseReaction,
  MuseSessionView,
  RunRequest,
} from './api';

export { buildGarden, gardenCounts, rollReport, formatRoll, CATEGORIES };
// The two steer bounds are the SERVER's — they live in `src/crystal/muse/steer.ts`, are
// enforced in the API layer and again in the cursor's `reserve()`, and are re-exported
// here so the keyboard mirrors them rather than keeping a second copy that can drift.
export { MAX_FLOOR_FRAGMENTS, MAX_INSTRUCTION_CHARS };
export type { GardenBuild, GardenDrops, RolledPrompt, RollReport, Category, Garden, Media };

/** Fixed, deterministic per-category color so a category reads the same everywhere it appears —
 *  not a hash, so the palette stays legible (no two adjacent categories landing on similar hues).
 *  Shared by `Dataset.tsx` (per-item chips) and `Muse.tsx` (the pooled garden's chips) so a
 *  category is always the same color on both screens. */
const CATEGORY_COLOR: Record<FragmentCategory, string> = {
  subject: '#5b8cff', hair: '#8a7cff', outfit: '#c26bd9', pose: '#e0668f', expression: '#e08a55', props: '#c9a13a',
  setting: '#3fae7a', style: '#39a6a0', palette: '#3f8fbf', lighting: '#e0c34a', mood: '#7a8fae',
};

export function categoryColor(category: FragmentCategory): string {
  return CATEGORY_COLOR[category] ?? 'var(--muted)';
}

/**
 * The fragment subset a garden build would actually draw from: everything except the
 * chips the operator has unchecked (indexed into the fragment list passed in — stable
 * within one loaded snapshot). Shared by `Dataset.tsx` (per-item curation) and
 * `Muse.tsx` (dataset-wide curation) so there is one curation rule, not two.
 * Non-vacuity: reverting this to a no-op must fail "an unchecked chip cannot appear
 * in a subsequent roll" (and, in Dataset.tsx, "excludes unchecked chips") in the tests.
 */
export function curatedFragments(fragments: Fragment[], excluded: ReadonlySet<number>): Fragment[] {
  return fragments.filter((_, i) => !excluded.has(i));
}

/**
 * Pool every media item's fragments into one flat list, dataset-wide, item order
 * preserved. This is the whole dataset's garden, never one item's alone — Muse pools
 * across every item Dataset.tsx lists, not a single item's chips (rth ruling
 * 2026-08-18: one dataset, not a pool of several). Non-vacuity: reverting this to
 * pool one item instead of `media` must fail "pools fragments across every media
 * item in the dataset".
 */
export function poolDatasetFragments(media: readonly DatasetMediaItem[]): Fragment[] {
  const out: Fragment[] = [];
  for (const item of media) out.push(...(item.fragments ?? []));
  return out;
}

/**
 * A built garden's fragments, flattened back to one ordered list in the same order
 * `gardenCounts` walks it (attribute tier, then exclusive tier; `CATEGORIES` order
 * within each). This is the index space curation chips are keyed against, so a
 * chip's render position always matches the index an operator (un)checks.
 */
export function flattenGarden(garden: Garden): Fragment[] {
  const out: Fragment[] = [];
  for (const category of CATEGORIES) out.push(...(garden[category] ?? []));
  return out;
}

/** Regroup a flat fragment list back into a `Garden`, preserving each fragment's own category. */
function regroup(fragments: readonly Fragment[]): Garden {
  const garden: Garden = {};
  for (const f of fragments) {
    const pool = garden[f.category] ?? (garden[f.category] = []);
    pool.push(f);
  }
  return garden;
}

/**
 * Roll `count` times against a garden's flattened fragments, with curation applied
 * FIRST: the excluded chips are dropped before the pools are rebuilt, so
 * `rollFragments` can never draw one. This is the one function `Muse.tsx` calls to
 * roll. Non-vacuity: reverting the `curatedFragments` call below to a no-op must
 * fail "an unchecked chip cannot appear in a subsequent roll".
 */
export function rollCurated(
  gardenFragments: readonly Fragment[],
  excluded: ReadonlySet<number>,
  count: number,
): RollReport {
  const curated = curatedFragments([...gardenFragments], excluded);
  return rollReport(regroup(curated), count);
}

// ── Ignition (Muse P4, noema-230) ────────────────────────────────────────────
// Turning a mined prompt into a run. The rules below are the whole of the
// decision-making; `Muse.tsx` renders them and nothing more, so they are gated by
// `tests/unit/web/muse.test.ts` rather than living inside a component.
//
// The dataset a prompt was mined from is a moodboard, not a model source. A
// trigger word carried by a mined fragment is prompt text like any other prompt
// text — `src/crystal/loraResolver.ts` resolves triggers server-side at run time,
// as it already does for every prompt in the product. Muse therefore attaches
// models exactly the way `Card.tsx` does: it does not.

/** The t2i verb. `effect` is i2i and needs an input image, `enhance` takes no text at
 *  all — a prompt alone cannot drive either, so neither is offered here. */
const T2I_VERB = 'make';

/**
 * The flows a mined prompt can be fired against: t2i only. Order is preserved, so the
 * dropdown reads in the same order `/v1/flows` returns.
 * Non-vacuity: dropping the `modusGenus` filter must fail "only a t2i ('make') flow can
 * be selected for a mined prompt".
 */
export function t2iFlows(flows: readonly FlowSummary[]): FlowSummary[] {
  return flows.filter((f) => f.modusGenus === T2I_VERB);
}

/** The single aditus key a mined prompt fills. */
export const PROMPT_KEY = 'prompt';

/**
 * Why a selected flow cannot be fired from Muse, or `null` when it can. Muse sends
 * `aditus` = `{prompt}` alone (the per-flow input form is `Card.tsx`'s job and stays
 * there), so a flow requiring any other input would 400 — on a metered request. Read
 * the requirement on SELECTION and refuse it before the spend, rather than firing and
 * surfacing the server's error.
 */
export function ignitionBlockReason(flow: Pick<FlowDescription, 'input'>): string | null {
  const required = flow.input?.required ?? [];
  const extra = required.filter((k) => k !== PROMPT_KEY);
  if (extra.length === 0) return null;
  return `this workflow also needs ${extra.join(', ')} — run it from its own card`;
}

/**
 * The body for both the quote and the run: the prompt as it stands on screen, against
 * the chosen flow. Nothing else.
 *
 * A mined fragment carries a `trigger` and `RolledPrompt.triggers` collects them, so the
 * tempting move is to lift those into `pinnedModels`. That would attach a model the
 * operator never chose — `pinnedModelResolver.ts` resolves a bare trigger against the
 * caller's own models, and a dataset can carry triggers from separate decompose passes,
 * so it can attach the wrong one of several. Muse fires with no `pinnedModels`, ever.
 * Non-vacuity: lifting a roll's triggers into `pinnedModels` must fail "a mined trigger
 * is never lifted into pinnedModels".
 */
export function ignitionRequest(modusId: string, prompt: string): RunRequest {
  return { modusId, aditus: { [PROMPT_KEY]: prompt } };
}

/**
 * Whether the single manual card may be fired. The manual path keeps its editable
 * prompt and fires that one prompt down the same route a stream piece takes, so its
 * only requirements are a chosen flow the prompt alone can drive, and text to send.
 * The price for that route is shown on the launch control above it (`launchLabel`),
 * quoted once for the flow rather than per prompt — see the note on `streamQuote`.
 */
export function canFireOne(
  modusId: string | null,
  prompt: string,
  blockReason: string | null,
): boolean {
  if (!modusId || blockReason) return false;
  return prompt.trim() !== '';
}

// ── The stream's front door (noema-244) ──────────────────────────────────────
// Configuration, one launch control, and a loop that rides until it is stopped.
//
// WHERE THE LOOP LIVES, and why it matters for spend: in the browser. There is no
// server-side stream — no stream id, no heartbeat, no reaper — so a piece is
// requested only when the previous one settles, and closing the tab ends the
// stream because nothing is left to fire it. The property that buys: there is no
// state in which an unattended page keeps spending. The cost, which the screen
// must show rather than hide: a page that goes away comes back stopped, and the
// state readout has to say so instead of rendering as though it were still riding.
//
// Everything the loop decides is `nextPieceDecision` below — pure, and the money
// ceiling of the whole design is one comparison inside it.

/** How a stream is run: a fixed number of pieces, or until it is stopped. */
export type StreamMode = 'batched' | 'infinite';

/** The price the launch control carries: one quote for the chosen flow.
 *
 *  ONE quote prices every piece, and that is a statement about the server, not a
 *  convenience: a t2i reservation is evaluated from the flow's own cost curve against
 *  the run's NUMERIC inputs (`steps`, `width`, `height` — see `reservationImpetus` in
 *  `src/ledger/rates.ts`), falling back to the flow's schema defaults. Muse sends
 *  `aditus` = `{prompt}` and nothing else, so every piece in a stream quotes the same
 *  figure whatever prompt it was rolled from.
 *
 *  It is still an ESTIMATE and is labelled `~` everywhere it is rendered: a
 *  reservation is an upper bound that settlement charges measured pod time against
 *  and refunds the remainder of. The client figure never becomes the charge —
 *  every piece goes through `POST /v1/runs`, which prices and charges server-side. */
export interface StreamQuote { modusId: string; impetus: string }

/** A stream as it is configured before launch. */
export interface StreamConfig {
  mode: StreamMode;
  /** Batched only: how many pieces to fire. */
  cap: number;
  /** Infinite only: the runs-until-you-stop-it warning has been acknowledged. */
  acknowledged: boolean;
}

/** Everything the launch control is refused on, in one object. */
export interface LaunchState {
  config: StreamConfig;
  /** The chosen t2i flow, or null when none is chosen. */
  modusId: string | null;
  /** `ignitionBlockReason` for the chosen flow: a flow needing more than a prompt. */
  flowBlockReason: string | null;
  /** How many fragments are in the draw right now. */
  liveFragments: number;
  /** The configuration-time quote, or null while it is still being fetched. */
  quote: StreamQuote | null;
}

/**
 * The single reason launch is refused, or `null` when it may proceed.
 *
 * Four refusals, and each is load-bearing:
 *
 *  - no flow chosen, and a flow that needs more than a prompt — the two refusals the
 *    per-card arming used to perform. They did not vanish with it; they moved here.
 *  - an EMPTY FLOOR. A stream draws every piece from the floor, so a floor with
 *    nothing in the draw has nothing to make. A thin floor is allowed to run — the
 *    refusal is emptiness, not thinness.
 *  - INFINITE MODE THAT HAS NOT BEEN ACKNOWLEDGED. An infinite stream has no count to
 *    stop it; the balance is its only ceiling. The acknowledgement is the disclosure
 *    that stands in for the count, so it is a gate on the control and not a caption
 *    beside it.
 *
 * A stream also cannot launch before it is priced: `perPieceImpetus` is what the funds
 * check compares the balance against, so an unpriced stream is one with no ceiling.
 *
 * Non-vacuity: reverting the acknowledgement gate must fail "infinite mode cannot
 * launch until the runs-until-you-stop-it warning is acknowledged"; reverting the
 * empty-floor refusal must fail "launch is refused when zero fragments are live on
 * the floor".
 */
export function launchBlockReason(state: LaunchState): string | null {
  if (!state.modusId) return 'choose a workflow to fire at';
  if (state.flowBlockReason) return state.flowBlockReason;
  if (state.liveFragments <= 0) {
    return 'nothing is in the draw — add a fragment to the floor before launching';
  }
  if (state.config.mode === 'infinite' && !state.config.acknowledged) {
    return 'infinite runs until you stop it or your funds run out — acknowledge that first';
  }
  if (!state.quote || state.quote.modusId !== state.modusId) {
    return 'pricing this run…';
  }
  return null;
}

/** Why a stream stopped. `lost` is D1's honest readout: the page went away and took
 *  the loop with it, so the stream ended without anyone deciding to end it. */
export type StopReason = 'user' | 'funds' | 'cap' | 'errors';
export type StopCause = StopReason | 'lost';

/** Where a stream is. `stopping` is a stop pressed while a piece is still in flight:
 *  the loop finishes the piece that is already paid for and then stops. */
export type StreamPhase = 'idle' | 'running' | 'stopping' | 'stopped';

/** Consecutive failures that end a stream. A loop that retries a hard failure forever
 *  is the other way this design can spend without a hand on it. */
export const MAX_CONSECUTIVE_ERRORS = 3;

/** What the loop knows when it decides whether to fire the next piece. */
export interface StreamDecisionInput {
  mode: StreamMode;
  /** Batched only. */
  cap: number;
  /** How many pieces this stream has fired so far. */
  fired: number;
  /** True while a piece is still generating. */
  inFlight: boolean;
  /** The caller's balance, freshly read — impetus, as a decimal integer string. */
  balanceImpetus: string;
  /** The quoted reservation for one piece, same units. */
  perPieceImpetus: string;
  stopRequested: boolean;
  consecutiveErrors: number;
}

/** Fire, or don't — and when not, whether the stream is over and why. `stop: null`
 *  means "not now, not over": a piece is still in flight. */
export type StreamDecision = { fire: true } | { fire: false; stop: StopReason | null };

/** Impetus figures cross the wire as decimal integer strings and are compared exactly.
 *  A malformed or absent figure reads as 0, which fails the funds check closed. */
function impetus(value: string | null | undefined): bigint {
  if (!value || !/^\d+$/.test(value.trim())) return 0n;
  return BigInt(value.trim());
}

/** `count` pieces at `perPiece` each, as a decimal string — what the launch control
 *  shows as the batch total, and what the readout shows as spent so far. Estimates
 *  both, and both are rendered with a `~`. */
export function impetusTotal(perPiece: string, count: number): string {
  const n = Number.isFinite(count) && count > 0 ? BigInt(Math.trunc(count)) : 0n;
  return (impetus(perPiece) * n).toString();
}

/**
 * THE WHOLE OF THE LOOP'S JUDGEMENT. `Muse.tsx` awaits a settlement and asks this
 * what to do next; it decides nothing itself.
 *
 * Order, and every position is deliberate:
 *
 *  1. `stopRequested` always wins. A stop pressed mid-stream is the user's, whatever
 *     else is true.
 *  2. `inFlight` is not a stop — it is "not yet". Exactly one piece is in flight at a
 *     time, because a loop that fires on a timer rather than on settlement spends at a
 *     rate nobody chose.
 *  3. `consecutiveErrors`, then the cap, then funds.
 *
 * THE FUNDS COMPARISON IS THE ENTIRE CEILING OF THIS DESIGN. Infinite mode has no
 * count; the balance is what ends it. It must therefore be compared against a balance
 * READ AGAIN as the stream runs, never the one read at launch — a stale balance is a
 * stream that keeps firing into a refusal.
 *
 * Non-vacuity: reverting the funds check must fail "a stream stops with reason 'funds'
 * when the balance is below the next piece's quoted impetus"; reverting the cap must
 * fail "a batched stream of K fires exactly K pieces and then stops with reason 'cap'";
 * reverting the in-flight guard must fail "no second piece is requested while one is
 * still in flight".
 */
export function nextPieceDecision(input: StreamDecisionInput): StreamDecision {
  if (input.stopRequested) return { fire: false, stop: 'user' };
  if (input.inFlight) return { fire: false, stop: null };
  if (input.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return { fire: false, stop: 'errors' };
  if (input.mode === 'batched' && input.fired >= input.cap) return { fire: false, stop: 'cap' };
  if (impetus(input.balanceImpetus) < impetus(input.perPieceImpetus)) return { fire: false, stop: 'funds' };
  return { fire: true };
}

/**
 * What the launch control says. The price is ON the control rather than behind a
 * separate step, which is the change this item makes to how spend is seen: once, and
 * earlier, instead of per piece — not less.
 */
export function launchLabel(config: StreamConfig, quote: StreamQuote | null): string {
  if (!quote) return 'launch';
  const each = `~${quote.impetus} impetus each`;
  if (config.mode === 'infinite') return `launch · ${each} · rides until you stop it`;
  const n = Math.max(0, Math.trunc(config.cap));
  return `launch ${n} · ${each} · ~${impetusTotal(quote.impetus, n)} total`;
}

/** Why a stream ended, in words. Every stop reason gets one — including the one
 *  nobody chose (`lost`), which is what keeps D1's tradeoff visible instead of
 *  rendering a dead stream as a live one. */
export function stopLabel(cause: StopCause, fired: number, cap: number): string {
  switch (cause) {
    case 'user': return 'stopped — you stopped it';
    case 'funds': return 'stopped — out of funds';
    case 'cap': return `stopped — ${fired} of ${cap}`;
    case 'errors': return `stopped — ${MAX_CONSECUTIVE_ERRORS} fires failed`;
    case 'lost': return 'stopped — the page lost the stream';
  }
}

/** The stream's state in one line. Infinite mode has no progress bar and no total, so
 *  this readout is the only place a user can watch the money: it carries the pieces
 *  fired and the impetus this stream has spent, at every phase. */
export function streamStatusLine(
  phase: StreamPhase,
  cause: StopCause | null,
  fired: number,
  config: StreamConfig,
  quote: StreamQuote | null,
): string {
  const spent = quote ? ` · ~${impetusTotal(quote.impetus, fired)} impetus this stream` : '';
  const made = `${fired} ${fired === 1 ? 'piece' : 'pieces'}`;
  if (phase === 'idle') return 'idle';
  if (phase === 'running') {
    const progress = config.mode === 'batched'
      ? `${fired} of ${Math.max(0, Math.trunc(config.cap))} pieces`
      : made;
    return `running · ${progress}${spent}`;
  }
  if (phase === 'stopping') return `stopping after this piece · ${made}${spent}`;
  const why = cause ? stopLabel(cause, fired, Math.max(0, Math.trunc(config.cap))) : 'stopped';
  return `${why} · ${made}${spent}`;
}

/** One draw for the stream: the prompt to fire, the fragments it came from, and the
 *  roll index that reproduces it. */
export interface StreamDraw {
  index: number;
  fragments: Fragment[];
  prompt: string;
  paid: boolean;
}

/**
 * The draw for ONE piece, at a named roll index.
 *
 * The index is not decoration. `rollFragments` is deterministic by design — the same
 * (garden, steer, index) always yields the same roll, which is what makes a recorded
 * `rollIndex` replayable — so a stream that drew at a fixed index would fire the same
 * prompt for every piece it paid for. The loop therefore advances the index once per
 * piece, and each piece is a different rolled prompt.
 *
 * The garden is rebuilt from the fragments and exclusions handed in on each call, so a
 * fragment turned off on the floor mid-stream is out of the draw for the very next
 * piece. That is what makes the floor the steering wheel while a stream is riding.
 *
 * Non-vacuity: pinning the index to a constant must fail "consecutive stream draws are
 * different rolls".
 */
export function rollAt(
  gardenFragments: readonly Fragment[],
  excluded: ReadonlySet<number>,
  index: number,
): StreamDraw {
  const garden = regroup(curatedFragments([...gardenFragments], excluded));
  const at = Math.max(0, Math.trunc(index));
  const fragments = rollFragments(garden, at);
  return {
    index: at,
    fragments,
    prompt: composeTemplate(fragments),
    // The same verdict the roll cards badge, from the same detector — this module
    // never forms a second opinion about what conflicts.
    paid: detectConflicts(fragments).length > 0,
  };
}

// ── The stream (noema-238) ───────────────────────────────────────────────────
// Where a fired piece lands. Before this, ignition produced a run id and a link to
// the run view, so the only way to see what Muse made was to leave Muse. The pieces
// come home instead, as a grid of tiles in the screen that fired them.
//
// Every rule the grid needs is a pure function here — what a piece is, where a new
// one lands while the user is scrolled away, how many tiles sit on a row, and which
// fragments produced a given piece — so `Muse.tsx` stays a renderer and the
// behaviour is gated by `tests/unit/web/muse.test.ts`.

/** One fired piece in the stream: the run that makes it, the prompt that was fired,
 *  and the fragments that produced it (its lineage). */
export interface StreamPiece {
  runId: string;
  prompt: string;
  /** The rolled fragments this piece was assembled from — carried at fire time
   *  because a later roll replaces the report the piece came out of. */
  lineage: Fragment[];
  status: 'running' | 'ready' | 'failed';
  media: Media | null;
  error?: string;
}

/** The stream as the screen holds it. `pieces` is what is on screen, newest first.
 *  `pending` is what arrived while the grid was frozen — see `admitPiece`. */
export interface StreamState {
  pieces: StreamPiece[];
  pending: StreamPiece[];
}

export const EMPTY_STREAM: StreamState = { pieces: [], pending: [] };

/** A piece at the moment it is fired: a run is running, nothing has come back yet. */
export function streamPiece(runId: string, prompt: string, lineage: readonly Fragment[]): StreamPiece {
  return { runId, prompt, lineage: [...lineage], status: 'running', media: null };
}

/**
 * Where a newly fired piece lands. New pieces insert at the TOP (V8b) — but only
 * when the user is looking at the top. While `frozen` (the user has scrolled away
 * from the head of the grid) the piece is held in `pending` and the tiles already on
 * screen do not move, because the tile's gestures are steers and a grid that shifts
 * under a thumb writes the wrong one.
 * Non-vacuity: dropping the `frozen` branch must fail "a piece arriving while the
 * user is scrolled away does not move the tile under their thumb".
 */
export function admitPiece(state: StreamState, piece: StreamPiece, frozen: boolean): StreamState {
  if (frozen) return { pieces: state.pieces, pending: [piece, ...state.pending] };
  return { pieces: [piece, ...state.pieces], pending: state.pending };
}

/** Let the held pieces through — what the "N new" pill does when it is tapped. */
export function releasePending(state: StreamState): StreamState {
  if (state.pending.length === 0) return state;
  return { pieces: [...state.pending, ...state.pieces], pending: [] };
}

/** A run's terminal state, as `useRunStream` reports it. */
export interface RunResult {
  terminal: 'complete' | 'failed' | null;
  exitus?: Record<string, unknown> | null;
  error?: string;
}

/**
 * Fold a finished run back into the piece that started it, wherever it sits — on
 * screen or still held. This is the whole result path: the piece's own subscription
 * reports terminal, and the image it produced is rendered in place.
 * Non-vacuity: reverting this to return `state` unchanged must fail "a fired piece
 * appears in Muse without leaving the screen".
 */
export function applyRunResult(state: StreamState, runId: string, result: RunResult): StreamState {
  if (!result.terminal) return state;
  const fold = (p: StreamPiece): StreamPiece => {
    if (p.runId !== runId) return p;
    if (result.terminal === 'failed') {
      return { ...p, status: 'failed', error: result.error ?? 'this piece failed' };
    }
    return { ...p, status: 'ready', media: mediaFromOutput(result.exitus ?? null) };
  };
  return { pieces: state.pieces.map(fold), pending: state.pending.map(fold) };
}

/** Roughly what one tile needs to stay legible with its three targets on it (V8a). */
export const STREAM_TILE_PX = 145;
/** Phone-first floor (S14/S15): two columns on a ~322px phone, never one. */
export const STREAM_MIN_COLUMNS = 2;
/** Past this the tiles get bigger, not more numerous — a wall of thumbnails is not a stream. */
export const STREAM_MAX_COLUMNS = 6;

/**
 * How many tiles sit on one row at a given grid width. The stream is fast, so a
 * single-tile column leaves the user scrolling behind the output (S15): the floor is
 * two columns whatever the width, and it widens from there.
 * Non-vacuity: returning 1 must fail "the stream lays out more than one piece per row".
 */
export function streamColumns(gridPx: number): number {
  const fits = Math.floor((Number.isFinite(gridPx) ? gridPx : 0) / STREAM_TILE_PX);
  return Math.max(STREAM_MIN_COLUMNS, Math.min(STREAM_MAX_COLUMNS, fits));
}

/** One line of a piece's lineage, as the expanded view names it. */
export interface LineageEntry { category: FragmentCategory; text: string; trigger?: string }

/**
 * The fragments that produced a piece, grouped in `CATEGORIES` order and de-duplicated
 * so a fragment drawn twice reads once. This is what the expanded view renders (V8:
 * lineage always, in the expanded view — the tile is for speed).
 * Non-vacuity: returning `[]` must fail "the expanded view names the fragments that
 * produced the piece".
 */
export function lineageOf(piece: Pick<StreamPiece, 'lineage'>): LineageEntry[] {
  const seen = new Set<string>();
  const out: LineageEntry[] = [];
  for (const category of CATEGORIES) {
    for (const f of piece.lineage) {
      if (f.category !== category) continue;
      const key = `${f.category} ${f.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ category: f.category, text: f.text, ...(f.trigger ? { trigger: f.trigger } : {}) });
    }
  }
  return out;
}

/** The three gestures a tile carries (V8a): the two steers plus declutter — the gestures
 *  made while scrolling. They write to the session (see the session section below); a tile
 *  whose piece is not in the session ledger renders them disabled rather than as controls
 *  that silently do nothing. */
export const TILE_GESTURES: ReadonlyArray<{ key: string; glyph: string; label: string }> = [
  { key: 'up', glyph: '♡', label: 'more like this' },
  { key: 'down', glyph: '\u{1F622}', label: 'less like this' },
  { key: 'dismiss', glyph: '✕', label: 'dismiss' },
];

/** The rail the expanded view carries: the tile's three, plus the gestures that are
 *  considered rather than made at speed (V8a). Save is one of those: it puts the piece
 *  back into the set, which is a decision about the work rather than a scroll-speed steer. */
export const EXPANDED_GESTURES: ReadonlyArray<{ key: string; glyph: string; label: string }> = [
  ...TILE_GESTURES,
  { key: 'laugh', glyph: '\u{1F602}', label: 'noted — steers nothing' },
  { key: 'save', glyph: '↓', label: 'save this piece back into the set' },
];

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

/** Two exclusion sets as one — the screen's local curation and the session floor's
 *  disabled fragments both keep a fragment out of the next roll. */
export function mergedExclusions(...sets: ReadonlyArray<ReadonlySet<number>>): Set<number> {
  const out = new Set<number>();
  for (const s of sets) for (const i of s) out.add(i);
  return out;
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

// ── Adding images to the moodboard (noema-260) ───────────────────────────────
// The second exit off a thin floor, beside the manual add above. Where a written
// fragment widens the floor directly and for free, an image widens it through the
// chain the rest of the product already has: the upload joins the set (free), a
// caption pass reads the set, and a decompose turns those captions into fragments.
//
// Everything below is pure. The screen does the uploading and the requesting; what
// is decided here is what the user is told BEFORE either metered step is pressed,
// and when the second one is refused.

/** The least a dataset has to be for the readouts below to hold: media ids and the
 *  caption passes over them. Structural on purpose — `Dataset` satisfies it, and so
 *  does a fixture, so nothing here needs the whole record. */
export interface CaptionedSet {
  media: ReadonlyArray<{ id: string }>;
  captionsets: ReadonlyArray<{ id: string; coverage?: string; captions?: Record<string, string> }>;
}

/**
 * How many of the set's media items carry no caption in the chosen pass.
 *
 * This is the figure a user is shown before spending, so it counts what the pass
 * actually holds rather than trusting a stored coverage string: a media item is
 * uncaptioned when the pass' caption map has no non-empty text under its id. A pass
 * that lists no captions at all (an older one, written before the map was carried)
 * reads as covering nothing — the map is what the count is over.
 *
 * With no pass selected every media item is uncaptioned, because there is no pass to
 * be covered by.
 *
 * Non-vacuity: deriving this from anything but the caption map — a stored coverage
 * string, the media count alone — must fail "a dataset with 2 media absent from the
 * chosen captionset reports 2 uncaptioned".
 */
export function uncaptionedCount(dataset: CaptionedSet, captionsetId: string | null): number {
  const set = captionsetId ? dataset.captionsets.find((c) => c.id === captionsetId) : undefined;
  const captions = set?.captions;
  if (!captions) return dataset.media.length;
  return dataset.media.filter((m) => {
    const text = captions[m.id];
    return typeof text !== 'string' || text.trim() === '';
  }).length;
}

/** The coverage of the chosen pass as words, for the line above the two metered
 *  actions. A pass whose caption map is not carried says so rather than reporting a
 *  gap it cannot see. */
export function captionCoverageLine(dataset: CaptionedSet, captionsetId: string | null): string {
  const total = dataset.media.length;
  const set = captionsetId ? dataset.captionsets.find((c) => c.id === captionsetId) : undefined;
  if (!set) return `no caption pass is selected — all ${total} ${total === 1 ? 'image' : 'images'} would be uncaptioned`;
  if (!set.captions) {
    return set.coverage
      ? `this pass reports ${set.coverage}; which images it covers is not listed here`
      : 'which images this pass covers is not listed here';
  }
  const missing = uncaptionedCount(dataset, captionsetId);
  if (missing === 0) return `all ${total} ${total === 1 ? 'image is' : 'images are'} captioned in this pass`;
  return `${missing} of ${total} ${total === 1 ? 'image has' : 'images have'} no caption in this pass`;
}

/**
 * Why a decompose over the chosen pass is refused, or `null` when it may run.
 *
 * A decompose reads ONE caption pass and mines fragments from the captions in it. Run
 * over a pass that does not cover the images just added, it mines the older images
 * only, spends a chat call per caption doing it, and returns success — nothing on
 * screen would say the new images contributed nothing. So the gap is a refusal, not a
 * note, and it is named with the number the user can act on.
 *
 * A pass that does not carry its caption map is NOT refused: coverage is not knowable
 * from here, and a refusal on an unknown is a path taken away rather than a spend
 * prevented.
 *
 * Non-vacuity: dropping the refusal must fail "the decompose control is refused while
 * any appended image is still uncaptioned".
 */
export function decomposeGateReason(dataset: CaptionedSet, captionsetId: string | null): string | null {
  if (!captionsetId) return null;
  const set = dataset.captionsets.find((c) => c.id === captionsetId);
  if (!set || !set.captions) return null;
  const missing = uncaptionedCount(dataset, captionsetId);
  if (missing === 0) return null;
  const total = dataset.media.length;
  return `${missing} of ${total} images have no caption in this pass — caption the set first, or a decompose reads the captioned images only.`;
}

/**
 * The append request for a set of uploaded media URLs, or `null` when there is
 * nothing to append.
 *
 * The null is the point: an empty selection must fire NO request. A `POST` with an
 * empty `mediaUrls` would still mint a new dataset version and recompute every pass'
 * coverage denominator over an unchanged set — a version that records nothing having
 * happened.
 *
 * Non-vacuity: returning a request for an empty list must fail "appending with no
 * files chosen fires no request".
 */
export function appendMediaRequest(
  mediaUrls: readonly string[],
): Extract<AddDatasetMediaRequest, { source: 'upload' }> | null {
  const urls = mediaUrls.filter((u) => typeof u === 'string' && u.trim() !== '');
  if (urls.length === 0) return null;
  return { source: 'upload', mediaUrls: urls.slice() };
}

/**
 * Put the dataset an append returned back into the list the screen renders from.
 *
 * The response carries the new version and every pass' recomputed coverage, so it —
 * not a locally patched copy of what was on screen — is what everything downstream
 * reads: the garden is pooled from `media`, and the version is what a later reader
 * trusts.
 *
 * Non-vacuity: keeping the pre-append copy must fail "the floor is rebuilt from the
 * dataset the append returned, not from the pre-append copy".
 */
export function replaceDataset<T extends { id: string }>(list: readonly T[] | null | undefined, updated: T): T[] {
  const current = list ?? [];
  return current.some((d) => d.id === updated.id)
    ? current.map((d) => (d.id === updated.id ? updated : d))
    : [...current, updated];
}

/** The files that did not upload, named, or `null` when every one landed. A partial
 *  batch is reported and the rest is still appended: dropping the whole batch because
 *  one file failed loses the user's other files for no reason. */
export function appendFailureNote(failed: readonly string[]): string | null {
  if (failed.length === 0) return null;
  return `${failed.length} did not upload and ${failed.length === 1 ? 'was' : 'were'} not added: ${failed.join(', ')}`;
}

// ── The steer keyboard and the consent sheet (noema-261) ─────────────────────
// The surface over the steer route. A person writes a short instruction, one metered
// call returns a PROPOSAL, and the proposal is rendered as a sheet of pills that can be
// vetoed one by one. THE FLOOR MOVES ONLY ON CONFIRM, through the same two floor routes
// every other gesture on this screen uses.
//
// Three rules are load-bearing and each one is a pure function below rather than a
// judgement made in the screen:
//
//   A VETOED PILL WRITES NOTHING. A veto that still wrote would be silent destruction —
//   the user said no and the floor moved anyway — and it is the one failure the sheet
//   exists to make impossible.
//
//   NOTHING IS WRITTEN BEFORE CONFIRM. `writesForConfirm` is gated on the sheet's phase,
//   so a sheet under review yields an empty write set however many pills it holds.
//
//   THE OFFER IS AN OFFER. `dismissalOffer` returns text to pre-fill the keyboard with
//   and nothing else. It carries no flow, no aditus and no request, so no arrangement of
//   dismissals can spend: the metered call happens when a person presses send, never as
//   a side effect of passing on pieces.

/** The metered flow one steer runs on. Priced through `POST /v1/runs/quote` with the
 *  same aditus the route builds, so the figure is the run's own reservation. */
export const STEER_MODUS_ID = 'modus.muse-steer';

/**
 * The fragments a steer will actually read: everything the session holds that the floor
 * has not turned off, as identities.
 *
 * This mirrors what the route does server-side (`enabledFragments`) — a fragment with no
 * floor entry is in the draw, and only an explicit `enabled: false` takes it out. The
 * count is what the price is quoted against and what the per-steer cap is judged against,
 * so it has to be the same set the server will steer rather than every fragment on file.
 */
export function steerFloor(view: MuseSessionView | null): MuseFragmentIdentity[] {
  if (!view) return [];
  const state = new Map(view.floor.map((e) => [e.key, e]));
  return view.fragments
    .filter((f) => state.get(fragmentKey(f))?.enabled !== false)
    .map((f) => ({ category: f.category, text: f.text }));
}

/** Characters left in the instruction. Negative once it is over the server's bound, which
 *  is what the keyboard counts down and what `steerBlockReason` refuses on. */
export function instructionRemaining(instruction: string): number {
  return MAX_INSTRUCTION_CHARS - instruction.trim().length;
}

/**
 * Why this steer cannot be sent, or `null` when it can.
 *
 * Every rule here is the SERVER's, mirrored so a person is not told "no" after writing a
 * sentence — and mirrored is all it is: the API layer refuses an empty or oversized
 * instruction with a 400 and the cursor refuses an oversized floor in `reserve()`, both
 * before anything is spent. The keyboard never becomes the enforcement.
 */
export function steerBlockReason(input: {
  view: MuseSessionView | null;
  instruction: string;
  inFlight: boolean;
}): string | null {
  if (input.inFlight) return 'a steer is already running';
  if (!input.view) return 'no session yet';
  const floor = steerFloor(input.view);
  if (floor.length === 0) return 'nothing is in the draw to steer';
  if (floor.length > MAX_FLOOR_FRAGMENTS) {
    return `this floor carries ${floor.length} fragments in the draw, above the ${MAX_FLOOR_FRAGMENTS} one steer reads —`
      + ' turn some off in the cutting floor first';
  }
  const trimmed = input.instruction.trim();
  if (!trimmed) return 'write what you want changed first';
  if (trimmed.length > MAX_INSTRUCTION_CHARS) {
    return `that is ${trimmed.length} characters — a steer is at most ${MAX_INSTRUCTION_CHARS}`;
  }
  return null;
}

/**
 * The quote request for one steer: the same modus and the same aditus the route builds,
 * so `POST /v1/runs/quote` prices this exact run without creating it.
 *
 * The reservation is a base plus a per-floor-fragment term and does not read the
 * instruction's content, so the figure is stable for a given floor size — which is why
 * the screen re-quotes when the floor changes rather than on every keystroke. The
 * reservation still needs an instruction to be present, so an empty box prices against a
 * stand-in; the number it returns is the number the written instruction will be quoted at.
 */
export function steerQuoteRequest(
  instruction: string,
  floor: readonly MuseFragmentIdentity[],
): Pick<RunRequest, 'modusId' | 'aditus'> {
  const trimmed = instruction.trim();
  return {
    modusId: STEER_MODUS_ID,
    aditus: { instruction: trimmed || 'steer this floor', floor: floor.map((f) => ({ ...f })) },
  };
}

/** One pill in the consent sheet. `key` is the fragment's identity and is what a veto is
 *  recorded against — an elimination names a fragment the floor holds and an addition one
 *  it does not, so the two sides cannot collide on it. */
export interface SteerPill {
  kind: 'elimination' | 'addition';
  category: FragmentCategory;
  text: string;
  key: string;
}

/**
 * The proposal as pills, eliminations first.
 *
 * Nothing here re-derives what the server already decided: every elimination is on the
 * floor as it stands and every addition is in the taxonomy and new to the floor, because
 * `validateProposal` is the single validation point and it already dropped everything
 * else. An addition arrives carrying its own attribution; the pill does not render it —
 * see the note on `writesForConfirm`.
 */
export function proposalPills(proposal: MuseSteerProposal | null): SteerPill[] {
  if (!proposal) return [];
  return [
    ...proposal.eliminations.map((f) => ({
      kind: 'elimination' as const, category: f.category, text: f.text, key: fragmentKey(f),
    })),
    ...proposal.additions.map((f) => ({
      kind: 'addition' as const, category: f.category, text: f.text, key: fragmentKey(f),
    })),
  ];
}

/**
 * What the sheet says about the changes that did not survive validation, or `null` when
 * none were dropped.
 *
 * SAID IN WORDS, never swallowed. The route counts drops precisely so this sentence can
 * be true: a user shown a shorter list with no explanation comes away believing they
 * vetoed something that was never proposed to them.
 */
export function droppedNote(dropped: number): string | null {
  if (!Number.isFinite(dropped) || dropped <= 0) return null;
  return dropped === 1
    ? "1 suggestion didn't fit your floor and was dropped"
    : `${dropped} suggestions didn't fit your floor and were dropped`;
}

/** Where a sheet is: under review, or confirmed by the person reading it. Confirm is the
 *  cut line, and this is that line as a value. */
export type SheetPhase = 'reviewing' | 'confirmed';

/**
 * One floor call the confirm makes. `disable` is `PATCH …/floor/enabled` with
 * `enabled: false`; `add` is `POST …/floor/fragments`.
 *
 * A disable DARKENS a fragment, it never deletes it (S8): the pill stays on the cutting
 * floor and tapping it brings it back. A steer's elimination is the same act as tapping
 * that pill, with the same reversibility.
 */
export type FloorWrite =
  | { kind: 'disable'; fragment: MuseFragmentIdentity }
  | { kind: 'add'; fragment: MuseFragmentIdentity };

/**
 * The exact floor calls a confirmed sheet makes, and nothing else.
 *
 * THIS IS WHERE THE SHEET'S PROMISES ARE KEPT, and each one is a line of code here rather
 * than a rule the screen is trusted to follow:
 *
 *   A VETOED PILL CONTRIBUTES NOTHING. Vetoes are keyed by fragment identity and filtered
 *   before anything is emitted, on both sides.
 *
 *   AN ELIMINATION IS EXACTLY ONE `enabled: false` WRITE for that identity, and never an
 *   add. Turning an elimination into an addition — or into both — would put a phrase on
 *   the floor that the user asked to have taken off it.
 *
 *   A SHEET UNDER REVIEW WRITES NOTHING. `reviewing` yields an empty set however many
 *   pills survive, so the floor cannot move before the person reading the sheet rules on
 *   it. That is V2 stated as code: confirm is the cut line.
 *
 * One thing this deliberately does NOT carry: the proposal's own attribution. An addition
 * comes back marked as a steer's, and the confirm sends it down the floor-fragments route,
 * which builds the fragment as a manual one — so the provenance label does not survive the
 * confirm. The pills and the floor entry are both correct; only that label is lost, and
 * nothing here or on screen claims a provenance the floor does not carry. Preserving it
 * needs a `source` argument on that route, which is a server change and a separate ruling.
 */
export function writesForConfirm(
  proposal: MuseSteerProposal | null,
  vetoed: ReadonlySet<string>,
  phase: SheetPhase,
): FloorWrite[] {
  if (!proposal || phase !== 'confirmed') return [];
  const writes: FloorWrite[] = [];
  for (const f of proposal.eliminations) {
    if (vetoed.has(fragmentKey(f))) continue;
    writes.push({ kind: 'disable', fragment: { category: f.category, text: f.text } });
  }
  for (const f of proposal.additions) {
    if (vetoed.has(fragmentKey(f))) continue;
    writes.push({ kind: 'add', fragment: { category: f.category, text: f.text } });
  }
  return writes;
}

/** One floor write named as the sheet names it, for the row that says which ones landed
 *  and which did not. */
export function writeLabel(write: FloorWrite): string {
  return `${write.kind === 'disable' ? 'off' : 'add'} · ${write.fragment.category}: ${write.fragment.text}`;
}

/**
 * What the sheet says after a confirm that did not fully land.
 *
 * The writes that landed STAY LANDED and the ones that did not are named — the same
 * partial-batch honesty the moodboard append uses. A consent sheet that half-applied and
 * said nothing is worse than one that visibly failed: the floor would have moved in a way
 * the user could neither see nor undo.
 */
export function confirmOutcomeNote(landed: number, failed: readonly string[]): string {
  const applied = `${landed} ${landed === 1 ? 'change' : 'changes'} applied to the floor`;
  if (failed.length === 0) return `${applied}.`;
  return `${applied} · ${failed.length} did not land and ${failed.length === 1 ? 'is' : 'are'} still as`
    + ` ${failed.length === 1 ? 'it' : 'they'} ${failed.length === 1 ? 'was' : 'were'}: ${failed.join('; ')}`;
}

/**
 * How many pieces a person passes on before the screen offers to help (S12).
 *
 * Three in a row, with no floor change between them: one dismissal is taste, three
 * without touching the floor is a pattern the floor has not been told about.
 */
export const DISMISSALS_BEFORE_OFFER = 3;

/** Dismissals since the floor last moved. The only state the offer is derived from. */
export interface DismissalState { sinceFloorChange: number }

/** No dismissals yet — where a screen starts. */
export const NO_DISMISSALS: DismissalState = { sinceFloorChange: 0 };

/** One ✕. Counted, and that is the whole of what a dismissal does on its own: it moves no
 *  floor by itself, exactly as it did before this sheet existed. */
export function recordDismissal(state: DismissalState): DismissalState {
  return { sinceFloorChange: state.sinceFloorChange + 1 };
}

/**
 * Any floor change — an enable, a weight, an add, a confirmed sheet — resets the count.
 *
 * THE RESET IS THE PROPERTY. A count that survived a floor change would re-offer the same
 * suggestion immediately after the user acted on it, so the offer has to be earned again
 * from zero: three more dismissals, after the floor moved.
 */
export function recordFloorChange(state: DismissalState): DismissalState {
  return state.sinceFloorChange === 0 ? state : NO_DISMISSALS;
}

/**
 * The offer, when it has been earned.
 *
 * AN OFFER, NEVER AN ACTION. What comes back is a line to render and text to pre-fill the
 * instruction box with — no flow id, no aditus, no request, nothing that can be dispatched.
 * Compare `steerQuoteRequest`, which is the metered path and carries a `modusId`. That gap
 * is the product rule: a steer is user-initiated, and one that fired because somebody
 * scrolled past three pieces would be a spend nobody chose.
 */
export interface SteerOffer { kind: 'offer'; line: string; instruction: string }

export function dismissalOffer(state: DismissalState): SteerOffer | null {
  if (state.sinceFloorChange < DISMISSALS_BEFORE_OFFER) return null;
  return {
    kind: 'offer',
    line: "you've passed on three in a row — want me to suggest a change?",
    instruction: "I keep passing on these — suggest what to change about the floor",
  };
}
