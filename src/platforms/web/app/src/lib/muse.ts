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
  ActivityDoor,
  ActivityKind,
  ActivityRow,
  Fragment,
  FragmentCategory,
  MuseSteerProposal,
  DatasetMediaItem,
  FlowSummary,
  FlowDescription,
  ModelCard,
  MuseFragmentIdentity,
  MusePiece,
  MusePieceRecord,
  MuseReaction,
  MuseSessionView,
  MuseNozzleEntry,
  MuseSetup,
  RunRequest,
  RunStatus,
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

// ── Archive: what has left the set (noema-267, over the noema-266 server half) ─────────────
//
// A dataset or one of its media items is archived by carrying an `archivum` timestamp; absent
// means live, and a restore removes the field rather than writing a second flag beside it. An
// archived dataset leaves both list routes server-side. An archived MEDIA item does NOT leave
// the record it hangs on — every caption map and every fragment list is keyed on the item's id
// and has to survive a restore — so the payload still carries it, and this side is what stops
// rendering it and stops counting it.
//
// Everything that says how big a set is therefore counts LIVE media: the grid, the header, the
// coverage line, the caption control's quote and the decompose gate. A captionset's stored
// coverage is recomputed server-side over the live media on every archive, so a client counting
// the whole array would print a total that disagrees with the fraction printed beside it.

/** A record whose archived state this side can read. `archivum` arrives as an ISO string on the
 *  wire, exactly as `natum`/`mutatum` do. */
export interface Archivable { archivum?: string }

/** Archived — carrying an `archivum`. Absent is live, including on a record written before the
 *  field existed. */
export function isArchived(record: Archivable): boolean {
  return typeof record.archivum === 'string' && record.archivum.trim() !== '';
}

/**
 * The live records of a list, in order — the working set of a dataset's media, or the datasets
 * a library still holds.
 *
 * Non-vacuity: dropping the filter must fail "an archived image is not rendered in the set's
 * grid" and "the header counts the images that are left".
 */
export function liveRecords<T extends Archivable>(records: readonly T[]): T[] {
  return records.filter((r) => !isArchived(r));
}

/**
 * Pool every media item's fragments into one flat list, dataset-wide, item order
 * preserved. This is the whole dataset's garden, never one item's alone — Muse pools
 * across every item Dataset.tsx lists, not a single item's chips (rth ruling
 * 2026-08-18: one dataset, not a pool of several). Non-vacuity: reverting this to
 * pool one item instead of `media` must fail "pools fragments across every media
 * item in the dataset".
 *
 * An archived item is not in the pool: it has left the working set, and its fragments would
 * otherwise keep seeding rolls from an image the set no longer shows.
 */
export function poolDatasetFragments(media: readonly DatasetMediaItem[]): Fragment[] {
  const out: Fragment[] = [];
  for (const item of liveRecords(media)) out.push(...(item.fragments ?? []));
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
 * so it can attach the wrong one of several. This request carries no `pinnedModels`, ever
 * — the only models a fired piece pins are the ones the user picked on the nozzle
 * control, which `firedRunRequest` adds on top of this body.
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
 *  the loop finishes the piece that is already paid for and then stops.
 *
 *  `holding` is the nozzle being changed (S6) and it is NOT a stop: the loop parks,
 *  keeping its fired count, its cap, its run mode and its generation, and committing
 *  the change returns it to `running` with no relaunch. See `HoldReason`.
 *
 *  `resumed` is a session reopened with pieces already in its ledger: no loop is riding,
 *  but the screen is not sitting at a fresh configuration either. See `resumePhase`. */
export type StreamPhase = 'idle' | 'running' | 'holding' | 'stopping' | 'stopped' | 'resumed';

/** Consecutive failures that end a stream. A loop that retries a hard failure forever
 *  is the other way this design can spend without a hand on it. */
export const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Why the stream is holding (S6). Both reasons are a nozzle change and nothing else —
 * a floor change never holds, which is the distinction this whole control turns on:
 * pieces drawn while the floor is being edited are still pieces the user asked for,
 * while pieces fired while a model is being chosen come out of the old nozzle at full
 * price and are exactly the ones they were about to stop wanting.
 *
 *  - `picking` — the model control is open or mid-change.
 *  - `loading` — the change is committed and the new weights are being taken up. The
 *    first piece under a new LoRA can be slow because the pod fetches those weights,
 *    so the readout says so instead of reading as a stall.
 */
export type HoldReason = 'picking' | 'loading';

/** A hold, and the trigger word it is loading when it has one to name. */
export interface HoldState { reason: HoldReason; trigger?: string }

/** What the stream is holding for, in words — the same shape `stopLabel` gives a stop,
 *  and deliberately worded as a wait rather than an ending. */
export function holdLabel(hold: HoldState): string {
  if (hold.reason === 'loading') {
    return hold.trigger ? `holding — loading ${hold.trigger}` : 'holding — loading the model';
  }
  return 'holding — choosing a model';
}

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
  /** The nozzle change in progress, or `null` when there is none. */
  hold?: HoldState | null;
}

/** Fire, or don't — and when not, whether the stream is over and why. `stop: null`
 *  means "not now, not over": a piece is still in flight. The third shape is the same
 *  family — "not now, not over" — with a reason to show: the nozzle is being changed,
 *  and the stream resumes from exactly where it is parked. */
export type StreamDecision =
  | { fire: true }
  | { fire: false; stop: StopReason | null }
  | { fire: false; hold: HoldState };

/** Whether a decision is the non-terminal nozzle hold. The loop parks on this and keeps
 *  everything it is holding; it must never be folded into the `stop` branch. */
export function isHold(decision: StreamDecision): decision is { fire: false; hold: HoldState } {
  return decision.fire === false && 'hold' in decision;
}

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
 *     else is true — including while the stream is holding.
 *  2. `inFlight` is not a stop — it is "not yet". Exactly one piece is in flight at a
 *     time, because a loop that fires on a timer rather than on settlement spends at a
 *     rate nobody chose.
 *  3. A HOLD is the same family as `inFlight`: "not now, not over". It sits ABOVE the
 *     error, cap and funds checks precisely so a nozzle change can never be turned into
 *     a terminal stop on the way past them — the fired count, the cap and the run mode
 *     have to survive it (S6), and a hold rendered as a stop looks identical on screen
 *     for one second and is a different product by the second one.
 *  4. `consecutiveErrors`, then the cap, then funds. All three are still reached the
 *     moment the hold is released.
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
 * still in flight"; reverting the hold branch must fail "an uncommitted nozzle change
 * holds the stream instead of firing the next piece", and reverting the hold/stop
 * distinction must fail "a hold is NOT a stop".
 */
export function nextPieceDecision(input: StreamDecisionInput): StreamDecision {
  if (input.stopRequested) return { fire: false, stop: 'user' };
  if (input.inFlight) return { fire: false, stop: null };
  if (input.hold) return { fire: false, hold: input.hold };
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
  hold?: HoldState | null,
): string {
  const spent = quote ? ` · ~${impetusTotal(quote.impetus, fired)} impetus this stream` : '';
  const made = `${fired} ${fired === 1 ? 'piece' : 'pieces'}`;
  if (phase === 'idle') return 'idle';
  // A reopened session that is not riding carries no fired count and no spend of its own —
  // both belong to the stream that made its pieces, which ended. What this line has to say
  // is that there is something here to come back to, so it says that and nothing more.
  if (phase === 'resumed') return "resumable · this session's pieces are below · launch to make more";
  // A hold carries the SAME figures a running stream carries — the count and the spend
  // are what a stop would reset, so showing them unchanged is how the readout says this
  // is a wait and not an ending.
  if (phase === 'holding') {
    return `${holdLabel(hold ?? { reason: 'picking' })} · ${made}${spent} · the stream resumes where it is`;
  }
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

/** What a terminal announcement reads off the run it fetched — narrowed so a caller
 *  can hand over a run record without constructing an entire `Run`. */
export interface TerminalRun {
  exitus?: Record<string, unknown> | null;
  failure?: { code: string; message: string };
  cost?: string;
}

/** One update to the state a run's subscribers hold, as a terminal produces it. */
export interface TerminalPatch {
  terminal: 'complete' | 'failed';
  exitus?: Record<string, unknown> | null;
  error?: string;
  charged?: string;
}

/**
 * How a run's terminal is announced to whoever is subscribed to it.
 *
 * A `complete` is announced only once the run has been fetched, so `terminal` and
 * `exitus` reach the subscriber in ONE update. A subscriber may stop listening the
 * moment it is told the run is terminal — the stream's tile does exactly that, because
 * its watcher is mounted only while the piece is running, and a watcher kept alive per
 * finished piece would be an open stream per finished piece — so a terminal announced
 * ahead of its outputs has nobody left to deliver them to.
 *
 * A `failed` has no output to wait for: it is announced immediately, and the run record
 * is fetched afterwards only to add the failure message and the charge. A failure
 * therefore never parks its caller on a fetch.
 *
 * Lives here rather than in `runStream.ts` because it is pure — no React, no transport —
 * and this is the module the hermetic web tests can reach.
 * Non-vacuity: announcing a `complete` before the fetch must fail "a completed piece's
 * media reaches the tile even though the piece stops being 'running' the moment it
 * completes"; awaiting the fetch before announcing a `failed` must fail "a failed run
 * still marks its piece failed and still releases the loop".
 */
export async function announceTerminal(
  kind: 'complete' | 'failed',
  runId: string,
  fetchRun: (id: string) => Promise<{ run: TerminalRun }>,
  emit: (patch: TerminalPatch) => void,
): Promise<void> {
  const read = () => fetchRun(runId).then(({ run }) => run).catch(() => null);

  if (kind === 'failed') {
    emit({ terminal: 'failed' });
    const r = await read();
    if (r) emit({ terminal: 'failed', error: r.failure?.message, charged: r.cost ?? '0' });
    return;
  }

  const r = await read();
  emit({ terminal: 'complete', exitus: r?.exitus ?? null });
}

/**
 * Fold a finished run back into the piece that started it, wherever it sits — on
 * screen or still held. This is the whole result path: the piece's own subscription
 * reports terminal, and the image it produced is rendered in place.
 * Non-vacuity: reverting this to return `state` unchanged must fail "a fired piece
 * appears in Muse without leaving the screen".
 *
 * A terminal carrying no renderable output is not a finished piece: `ready` with no
 * media renders as the waiting state, and the tile would sit on "generating…" with
 * nothing left watching it. Such a terminal is carried as a failure instead, which is
 * a state the tile can say out loud.
 * Non-vacuity: dropping that guard must fail "a terminal with no output does not mark
 * a piece ready-with-no-media".
 */
export function applyRunResult(state: StreamState, runId: string, result: RunResult): StreamState {
  if (!result.terminal) return state;
  const fold = (p: StreamPiece): StreamPiece => {
    if (p.runId !== runId) return p;
    if (result.terminal === 'failed') {
      return { ...p, status: 'failed', error: result.error ?? 'this piece failed' };
    }
    const media = mediaFromOutput(result.exitus ?? null);
    if (!media) {
      return { ...p, status: 'failed', media: null, error: result.error ?? 'this piece finished without an image' };
    }
    return { ...p, status: 'ready', media };
  };
  return { pieces: state.pieces.map(fold), pending: state.pending.map(fold) };
}

/**
 * What the screen does with a run that has reached terminal: the result is folded into
 * the piece FIRST, and the stream loop is released SECOND. The loop requests the next
 * piece on settlement, so releasing ahead of the fold puts the next request in flight
 * while the finished piece is not yet on screen.
 * Non-vacuity: swapping the two calls must fail "the stream loop is released only after
 * the finished piece's media has been folded in".
 */
export function settlePieceResult(
  runId: string,
  result: RunResult,
  fold: (runId: string, result: RunResult) => void,
  release?: (result: RunResult) => void,
): void {
  fold(runId, result);
  release?.(result);
}

// ── The live run readout (noema-273) ─────────────────────────────────────────
// A run reports what it is doing while it does it, and every surface watching a live
// pod says so. The vocabulary of that readout is pure — no React, no transport — and
// lives here rather than in `./runStream`, which owns the hook and the SSE handle:
// this module is the one the hermetic web tests can import, so what the readout
// DECIDES is gated rather than merely typechecked. `./runStream` re-exports all of it,
// so a surface reading the readout off the stream module is unchanged.

/** Every phase a runner reports as it works. */
export type Phasis =
  | 'queued' | 'provisioning' | 'pulling' | 'attesting' | 'downloading'
  | 'installing' | 'loading' | 'warming' | 'executing' | 'uploading'
  | 'finalizing' | 'cancelling' | 'done' | 'failed';

/** One live frame off a run: where it is, and what it is doing there. */
export interface Progressus {
  phase: Phasis;
  target?: string;
  message?: string;
  progress?: { done: number; total?: number; unit: string };
  etaMs?: number;
}

// The five stages the timeline shows, in lifecycle order. Every Phasis maps into
// exactly one of these (kept coarse — the fine phase rides in the active sub-line).
export const STAGE_LABELS = ['admitted', 'provisioned pod', 'generating', 'upload → R2', 'settle ledger'];

export function phaseToStage(phase: Phasis): number {
  switch (phase) {
    case 'queued': return 0;
    case 'provisioning': case 'pulling': case 'attesting':
    case 'downloading': case 'installing': case 'loading': case 'warming': return 1;
    case 'executing': return 2;
    case 'uploading': return 3;
    case 'finalizing': case 'cancelling': return 4;
    case 'done': case 'failed': return 5;
    default: return 1;
  }
}

// The sub-line for the active stage: prefer the runner's human message, else its
// typed progress measurement, else the raw phase name.
export function measure(p?: Progressus): string {
  if (!p) return '…';
  if (p.message) return p.message;
  if (p.progress) {
    const { done, total, unit } = p.progress;
    return total ? `${done} / ${total} ${unit}` : `${done} ${unit}`;
  }
  return p.target ? `${p.phase} · ${p.target}` : p.phase;
}

/** What a piece's own subscription knows about the run behind it, as the stream
 *  reduces it: the coarse stage, and the latest frame if one has arrived. */
export interface PieceProgress {
  stageIdx: number;
  progressus?: Progressus;
}

/** The tile line is one line on a ~145px tile, so the sub-line is trimmed rather
 *  than wrapped away the stage it belongs to. */
export const TILE_READOUT_MAX = 46;

function trim(line: string, max: number): string {
  return line.length <= max ? line : `${line.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/**
 * What one tile says while its piece is in flight — the single line where a static
 * status used to sit. The run is already streaming its phases into the browser; this
 * is the rule that turns the frame the piece holds into words on the tile.
 *
 * Four decisions, in this order, and each is a proof in tests/unit/web/muse.test.ts:
 *   • a failed piece reads its error — failure outranks progress, because a phase
 *     under a piece that is not coming back is the wrong thing to read;
 *   • a piece that has landed reports no phase at all — a finished tile still saying
 *     `executing` is the same untruth pointed the other way;
 *   • a running piece reads its live phase, coarse stage plus the runner's own
 *     sub-line, trimmed to the tile;
 *   • a running piece with no frame yet reads as the first stage rather than blank —
 *     silence is precisely the state this replaces.
 *
 * `etaMs` rides on the frame and is deliberately NOT rendered: nothing has calibrated
 * it, and a countdown that is wrong reads worse than no countdown.
 */
export function pieceReadout(
  piece: Pick<StreamPiece, 'status' | 'error'>,
  progress?: PieceProgress,
): string {
  if (piece.status === 'failed') return piece.error ?? 'this piece failed';
  if (piece.status !== 'running') return '';
  const idx = Math.min(Math.max(Math.trunc(progress?.stageIdx ?? 0) || 0, 0), STAGE_LABELS.length - 1);
  const stage = STAGE_LABELS[idx];
  if (!progress?.progressus) return stage;
  const detail = measure(progress.progressus);
  if (!detail || detail === '…' || detail === stage) return stage;
  return trim(`${stage} · ${detail}`, TILE_READOUT_MAX);
}

/**
 * The same live state, shaped for the shared stageline the expanded piece draws — the
 * component the rest of the product already uses, fed from the subscription the piece
 * ALREADY has. A piece is watched by exactly one stream while it runs, and expanding
 * it does not open a second one.
 */
export function pieceStageline(
  piece: Pick<StreamPiece, 'status'>,
  progress?: PieceProgress,
): { stageIdx: number; progressus?: Progressus; terminal: 'complete' | 'failed' | null } {
  if (piece.status === 'failed') return { stageIdx: 0, terminal: 'failed' };
  if (piece.status !== 'running') return { stageIdx: STAGE_LABELS.length, terminal: 'complete' };
  return {
    stageIdx: Math.min(Math.max(Math.trunc(progress?.stageIdx ?? 0) || 0, 0), STAGE_LABELS.length - 1),
    progressus: progress?.progressus,
    terminal: null,
  };
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

// ── Coming back to a session (noema-263) ─────────────────────────────────────
// The stream is state the screen holds, so a mount starts it empty — but every piece the
// session fired is in the session's own ledger, with the lineage that produced it. A
// screen that resumes a session can therefore rebuild its stream from the ledger instead
// of showing nothing, which is the same hydrate-on-mount shape the rest of the app uses.
//
// A REBUILD IS A READ. Nothing here fires a run or reads a balance: the pieces come back,
// and the launch control stays the only thing that spends.

/** How many rows of rebuilt tiles a resumed session comes back with. One screen's worth:
 *  past this the existing scroll shows the rest, and a session that has been riding an
 *  infinite stream can hold hundreds of pieces — one run fetch each. */
export const REHYDRATE_ROWS = 4;

/** The rebuild's bound: the widest grid this screen lays out, four rows deep. */
export const REHYDRATE_LIMIT = STREAM_MAX_COLUMNS * REHYDRATE_ROWS;

/**
 * The recorded pieces a resumed session rebuilds: newest first, matching the grid's own
 * order, never more than `limit` of them, and without the ones the session recorded as
 * dismissed — ✕ took those off the scroll, and a rebuild that put them back would undo a
 * decision the ledger is holding.
 *
 * Non-vacuity: dropping the bound must fail "rehydrate asks for no more than the newest N
 * pieces"; carrying the dismissed ones back must fail "a rebuilt tile keeps the reaction,
 * the dismissal and the saved flag the session recorded".
 */
export function rehydratePieces(view: MuseSessionView, limit: number = REHYDRATE_LIMIT): MusePiece[] {
  const bound = Math.max(0, Math.trunc(limit));
  const kept: MusePiece[] = [];
  for (let i = view.pieces.length - 1; i >= 0 && kept.length < bound; i -= 1) {
    const piece = view.pieces[i]!;
    if (piece.dismissed) continue;
    kept.push(piece);
  }
  return kept;
}

/**
 * The stream a resumed session comes back as.
 *
 * Every rebuilt tile starts as `running`, because that is what is true until its run has
 * been asked: a recorded piece stores no media, so a rebuilt tile resolves its image from
 * its own run exactly as a live one does, and a piece whose run has not reached terminal
 * is watched again from there rather than being called finished.
 *
 * The prompt is recomposed from the recorded lineage through the same template the roll
 * composed it with. A model trigger is not a fragment and is not in the lineage, so a
 * rebuilt prompt names the fragments the piece was drawn from and nothing else.
 *
 * The reaction, the dismissal and the saved flag are NOT rebuilt onto the tile: they are
 * read off the session wherever the tile is rendered (`reactionOf`, `savedOf`), which is
 * already the rule — the ledger is the record and the tile is not a second copy of it.
 *
 * Non-vacuity: returning `EMPTY_STREAM` must fail "returning to a session rebuilds its
 * recorded pieces as tiles".
 */
export function rehydrateStream(view: MuseSessionView, limit: number = REHYDRATE_LIMIT): StreamState {
  return {
    pieces: rehydratePieces(view, limit).map((p) => streamPiece(p.runId, composeTemplate(p.fragments), p.fragments)),
    pending: [],
  };
}

/**
 * What a fetched run says about the tile rebuilt from it: a terminal to announce through
 * `announceTerminal`, or `null` for a run that is still going.
 *
 * A piece that was in flight when the page went away is the row that matters here — the
 * run keeps going on the pod after the client stops watching, so it may have finished, and
 * it may equally still be running. Both answers come from the run itself.
 *
 * Non-vacuity: folding a non-terminal run in as terminal must fail "a piece whose run has
 * not reached terminal comes back as still generating and is watched again".
 */
export function terminalOf(status: RunStatus | undefined): 'complete' | 'failed' | null {
  return status === 'complete' || status === 'failed' ? status : null;
}

/**
 * The phase a resumed session reads as. A session whose ledger holds pieces is *resumable*:
 * `idle` renders the screen as a fresh configuration, which says the opposite of what the
 * ledger holds. It is a readout and nothing more — resuming fires nothing, and the launch
 * control is still the only thing that spends.
 *
 * Non-vacuity: returning `'idle'` unconditionally must fail "a resumed session that is not
 * streaming reads as resumable rather than as a fresh configuration".
 */
export function resumePhase(state: StreamState): StreamPhase {
  return state.pieces.length > 0 ? 'resumed' : 'idle';
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

// ── Adding images to the moodboard (noema-260) ───────────────────────────────
// The second exit off a thin floor, beside the manual add above. Where a written
// fragment widens the floor directly and for free, an image widens it through the
// chain the rest of the product already has: the upload joins the set (free), a
// caption pass reads the set, and a decompose turns those captions into fragments.
//
// Everything below is pure. The screen does the uploading and the requesting; what
// is decided here is what the user is told BEFORE either metered step is pressed,
// and when the second one is refused.

/** The least a dataset has to be for the readouts below to hold: media ids, whether each
 *  item is archived, and the caption passes over them. Structural on purpose — `Dataset`
 *  satisfies it, and so does a fixture, so nothing here needs the whole record. */
export interface CaptionedSet {
  media: ReadonlyArray<{ id: string } & Archivable>;
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
 * An archived item is not counted: it has left the working set, and a caption pass no
 * longer reads it.
 *
 * Non-vacuity: deriving this from anything but the caption map — a stored coverage
 * string, the media count alone — must fail "a dataset with 2 media absent from the
 * chosen captionset reports 2 uncaptioned".
 */
export function uncaptionedCount(dataset: CaptionedSet, captionsetId: string | null): number {
  const media = liveRecords(dataset.media);
  const set = captionsetId ? dataset.captionsets.find((c) => c.id === captionsetId) : undefined;
  const captions = set?.captions;
  if (!captions) return media.length;
  return media.filter((m) => {
    const text = captions[m.id];
    return typeof text !== 'string' || text.trim() === '';
  }).length;
}

/** The coverage of the chosen pass as words, for the line above the two metered
 *  actions. A pass whose caption map is not carried says so rather than reporting a
 *  gap it cannot see. */
export function captionCoverageLine(dataset: CaptionedSet, captionsetId: string | null): string {
  const total = liveRecords(dataset.media).length;
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
  const total = liveRecords(dataset.media).length;
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

/**
 * What a caption pass will cover, as the number the control carries.
 *
 * A CAPTION PASS READS THE WHOLE SET. It captions every media item the dataset holds,
 * not the ones that were just appended, and every image in it is one metered call. So
 * the figure on the control is the size of the SET after the append — 7 + 2 quotes a
 * nine-image pass — and it is derived from the set alone: there is no appended count in
 * this signature to quote instead.
 *
 * Understating this is the one error this surface is not allowed to make: a control that
 * says two while nine are billed is a price the user did not agree to.
 *
 * Non-vacuity: quoting the appended delta must fail "the caption control quotes the
 * WHOLE set after an append, not the delta".
 */
export function captionPassLabel(dataset: Pick<CaptionedSet, 'media'>): string {
  const total = liveRecords(dataset.media).length;
  return `Caption all ${total} ${total === 1 ? 'image' : 'images'} →`;
}

/** The sentence under the caption control: what the pass covers and that it is metered
 *  like any other run. Same figure as the label, from the same place. */
export function captionPassNote(dataset: Pick<CaptionedSet, 'media'>): string {
  const total = liveRecords(dataset.media).length;
  return `a caption pass captions every image in the set, not only the ones just added — this one is `
    + `${total} ${total === 1 ? 'image' : 'images'} · billed like any other run`;
}

// ── The caption run rides the URL (noema-321) ────────────────────────────────
// A caption pass unmounts the instant you navigate away, and with it the only handle the
// screen held on the run — bare `useState`, gone with the component. The pass finishes fine
// server-side; there was just nothing left on screen that could ever watch it again. Carrying
// the run id in `?run=` makes it a page you can return to, refresh, or share the back button
// through, and re-attach is purely client-side: `useRunStream` already knows how to pick a
// run up from an id and fall back to polling.
export const CAPTION_RUN_PARAM = 'run';

/** Read `?run=` off a screen's search params. Blank or absent both read as no run — a `?run=`
 *  with nothing after the `=` is not a run id. */
export function captionRunParam(search: URLSearchParams): string | null {
  const v = search.get(CAPTION_RUN_PARAM);
  return v && v.trim() !== '' ? v : null;
}

/** `search` with `?run=` set to `runId`, or removed when `runId` is `null` — a NEW
 *  `URLSearchParams`, for `setSearchParams(withCaptionRunParam(search, id), { replace: true })`.
 *  Replace, not push: landing on or leaving a run is not a step the back button should retrace. */
export function withCaptionRunParam(search: URLSearchParams, runId: string | null): URLSearchParams {
  const next = new URLSearchParams(search);
  if (runId) next.set(CAPTION_RUN_PARAM, runId);
  else next.delete(CAPTION_RUN_PARAM);
  return next;
}

// ── The archive controls (noema-267) ─────────────────────────────────────────
// Ask once, then do it, then offer it back. Three rules, pure, so the screen makes no
// judgement of its own:
//
//   ASK ONCE. The first press on a destructive-looking control asks; only a second press on
//   the SAME target carries it out. Not a modal essay and not a typed confirmation — the
//   confirmation is the control itself, restated as a question, which is reachable on a phone
//   where a hover affordance is not.
//
//   OFFER IT BACK. An archive is followed by an undo affordance for a short window. This is
//   what makes the whole gesture humane, and it is why the server half ships restore in the
//   same breath as archive.
//
//   SAY WHAT ARCHIVE MEANS, ONCE. The user is entitled to know this is recoverable and is not
//   erasure, in one line, where the action lives.

/** What an archive control acts on: the whole set, or one image in it. */
export type ArchiveTarget =
  | { kind: 'dataset'; datasetId: string }
  | { kind: 'media'; datasetId: string; mediaId: string };

/** Whether two targets name the same thing — what "press the same control again" means. */
export function isSameTarget(a: ArchiveTarget | null | undefined, b: ArchiveTarget): boolean {
  if (!a || a.kind !== b.kind || a.datasetId !== b.datasetId) return false;
  return a.kind === 'media' && b.kind === 'media' ? a.mediaId === b.mediaId : true;
}

/** Archive, in the product's own words — one line, rendered where the action lives. */
export const ARCHIVE_MEANING =
  'archiving is not erasing: an archived set leaves your lists and cannot be used, everything that '
  + 'already referenced it keeps working, and you can bring it back.';

/** The question a first press asks, in the words of the thing it would archive. */
export function archiveQuestion(target: ArchiveTarget): string {
  return target.kind === 'dataset'
    ? 'archive this set? press again'
    : 'remove this image? press again';
}

/** Ask, or carry it out. */
export type ArchiveStep =
  | { ask: true; question: string }
  | { ask: false; archive: ArchiveTarget };

/**
 * One press on an archive control, given whatever the screen is already asking about.
 *
 * A press on a control that is not the one being asked about ASKS — including a press on a
 * different image while another image's question is open, so a stray tap can never archive
 * something the user was not looking at.
 *
 * Non-vacuity: returning the archive on a first press must fail "archiving asks once before it
 * is done".
 */
export function archiveStep(pending: ArchiveTarget | null, target: ArchiveTarget): ArchiveStep {
  if (!isSameTarget(pending, target)) return { ask: true, question: archiveQuestion(target) };
  return { ask: false, archive: target };
}

/** How long an archive stays takeable-back on screen. Long enough to read the line and change
 *  your mind, short enough that it is not mistaken for the state of the set. A restore route
 *  exists either way — the window is the OFFER, never the only way back. */
export const ARCHIVE_UNDO_WINDOW_MS = 30_000;

/** An archive that just happened: what it was, and when. */
export interface ArchiveDone { target: ArchiveTarget; at: number }

/** The undo affordance: what it says, what the button says, and what a press restores. */
export interface ArchiveUndo { line: string; label: string; target: ArchiveTarget }

/**
 * The offer to take an archive back, or `null` when there is nothing on offer.
 *
 * Non-vacuity: dropping the offer must fail "an archive offers to be taken back".
 */
export function undoOffer(done: ArchiveDone | null, nowMs: number): ArchiveUndo | null {
  if (!done) return null;
  const elapsed = nowMs - done.at;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > ARCHIVE_UNDO_WINDOW_MS) return null;
  return done.target.kind === 'dataset'
    ? { line: 'this set is archived — it has left your datasets.', label: 'take it back', target: done.target }
    : { line: 'that image has left the set.', label: 'take it back', target: done.target };
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

// ── The nozzle: choosing a LoRA, and what every piece then carries (noema-246) ─
// S5 puts the model on a control of its own, beside the flow and away from the steer
// keyboard. The floor is fuel and a floor edit changes which fragments the next draw
// may pull; this is the nozzle, and changing it changes what the pod loads.
//
// TWO MECHANISMS, BOTH REQUIRED, and they are not alternatives:
//
//   `pinnedModels` on the run request says WHICH weights the run may have — the same
//   top-level field `ProposalCard.tsx` already sends, carrying `intellaId` (the
//   unambiguous half of the field's documented "intellaId or slug").
//
//   THE TRIGGER WORD IN THE PROMPT is what actually applies them:
//   `src/crystal/loraResolver.ts` scans the prompt text and rewrites a known trigger
//   into a `<lora:name:weight>` tag for the pod's loader.
//
// A pin with no trigger downloads weights that are never applied — full price, no
// effect — and a trigger with no pin names weights the run was never given. Hence two
// separate proofs in the tests below rather than one.
//
// THE TRIGGER IS NOT A FLOOR FRAGMENT. It goes into the prompt string and nowhere
// else: never onto the cutting floor, never steerable, and never into a piece's
// recorded lineage — lineage is what a reaction reweights (S4), and a ♡ that could
// reweight a trigger word would let a reaction steer the nozzle.

/**
 * THE NOZZLE HOLDS A STACK. A stream may carry more than one LoRA at a time, and this
 * module carries no cap on how many: the run request's `pinnedModels` is a list, the
 * compiler resolves every ref in it against the caller's own models and the public
 * catalog, and nothing on that path bounds the count.
 *
 * No bound is invented here either. What stacking costs is time — a longer weight
 * download and a longer diffusion per piece — and what it costs in quality, or on the
 * pod, is not something this control can measure. A number picked here would be a guess
 * wearing the clothes of a limit. If a bound is ever established, it belongs where it
 * can be measured and this control should read it rather than restate it.
 */

/** The weight band the control offers. The resolver itself takes any weight — these are
 *  the CONTROL's bounds. The floor is deliberately above zero: `trigger:0.0` silences a
 *  LoRA in the resolver, which would leave the run pinning weights it never applies. */
export const LORA_WEIGHT_MIN = 0.1;
export const LORA_WEIGHT_MAX = 2;

/** The chosen nozzle: which weights to pin, and the trigger word that applies them.
 *  `weight` is `null` until the user sets one, which fires the LoRA at its own
 *  `defaultWeight` — the resolver's behaviour for a bare trigger. */
export interface LoraChoice {
  intellaId: string;
  nomen: string;
  trigger: string;
  weight: number | null;
}

/** The nozzle: an ordered list of choices. Order is the order the user stacked them,
 *  and it is the order the trigger words are written into the prompt. */
export type LoraStack = readonly LoraChoice[];

/**
 * What every nozzle-reading function takes. A single choice IS a stack of one, so the
 * one-model call sites read exactly as they did — the stack is the general case, not a
 * second API beside it.
 */
export type NozzleInput = LoraChoice | LoraStack | null | undefined;

/**
 * The nozzle as a list, de-duplicated by `intellaId` and with anything unusable dropped.
 *
 * DE-DUPLICATION IS NOT COSMETIC: the compiler de-dupes pinned refs on its own, so a
 * stack that carried the same model twice would show the user something the run will not
 * do. A card with no trigger word is dropped for the reason `loraChoiceOf` refuses it —
 * weights that are downloaded and never applied are a paid run with no effect.
 */
export function loraStack(nozzle: NozzleInput): LoraChoice[] {
  if (!nozzle) return [];
  const list: readonly LoraChoice[] = Array.isArray(nozzle)
    ? (nozzle as readonly LoraChoice[])
    : [nozzle as LoraChoice];
  const out: LoraChoice[] = [];
  const seen = new Set<string>();
  for (const choice of list) {
    if (!choice || !choice.intellaId) continue;
    if (!(choice.trigger ?? '').trim()) continue;
    if (seen.has(choice.intellaId)) continue;
    seen.add(choice.intellaId);
    out.push(choice);
  }
  return out;
}

/**
 * A catalog card as a choice, or `null` when it cannot be one.
 *
 * A card with no trigger word is not offerable: it could be pinned, but nothing in the
 * prompt would ever apply it, so it is a paid run with no effect. Refusing it in the
 * picker costs nothing; discovering it costs a piece.
 */
export function loraChoiceOf(card: ModelCard): LoraChoice | null {
  const trigger = (card.trigger ?? '').trim();
  if (!trigger || !card.intellaId) return null;
  return { intellaId: card.intellaId, nomen: card.nomen || card.intellaId, trigger, weight: null };
}

/**
 * The LoRAs on offer for the selected flow: the caller's own models first, then the
 * public catalog, de-duplicated by `intellaId`.
 *
 * SCOPED TO THE FLOW'S `familia` — the base-model family the flow runs on, read off its
 * own description. A LoRA trained on another base is a paid run that cannot work, so it
 * is not offered at all. With no `familia` in hand there is no scope to filter by and
 * the catalog is EMPTY rather than unscoped: an unscoped list is exactly the list that
 * contains the run that cannot work.
 *
 * Non-vacuity: dropping the `familia` filter must fail "the catalog offered is scoped to
 * the selected modus's familia".
 */
export function loraCatalog(
  ownModels: readonly ModelCard[],
  publicModels: readonly ModelCard[],
  familia: string | null | undefined,
): ModelCard[] {
  if (!familia) return [];
  const out: ModelCard[] = [];
  const seen = new Set<string>();
  for (const card of [...ownModels, ...publicModels]) {
    if (card.genus !== 'lora') continue;
    if (card.basis !== familia) continue;
    if (!loraChoiceOf(card)) continue;
    if (seen.has(card.intellaId)) continue;
    seen.add(card.intellaId);
    out.push(card);
  }
  return out;
}

/** Why there is no catalog to show, or `null` when there is one. Said in words rather
 *  than rendered as an empty list, because "no modus selected" and "this base has no
 *  LoRAs" are different facts and only one of them is the user's to fix. */
export function loraCatalogReason(
  modusId: string | null,
  familia: string | null | undefined,
  offered: number,
): string | null {
  if (!modusId) return 'choose a workflow first — a model is scoped to the workflow it runs on';
  if (!familia) return "this workflow doesn't name a base model, so there is no scoped catalog to offer";
  if (offered <= 0) return `no LoRA with a trigger word is available for ${familia}`;
  return null;
}

/**
 * Stacking a LoRA onto the nozzle, or taking it back off: the same control both adds and
 * removes, so a card already on the stack is removed by choosing it again.
 *
 * TWO REFUSALS RIDE HERE, and both are the stack's own rather than the picker's:
 *
 *  - **`familia` scope.** A LoRA trained on another base is a paid run that cannot work.
 *    `loraCatalog` already declines to OFFER one; this declines to ACCEPT one, so the
 *    scope holds for every entry of the stack and not only for what the list happens to
 *    show. With no `familia` in hand there is no scope to check against and nothing can
 *    be stacked, which is the same answer `loraCatalog` gives to the same question.
 *  - **No duplicates.** The same `intellaId` cannot be stacked onto itself; choosing it
 *    again removes it. The compiler would de-dupe a repeated ref anyway, so a stack that
 *    displayed it twice would be describing a run that does not exist.
 *
 * Non-vacuity: dropping the familia check must fail "a LoRA outside the flow's familia
 * cannot enter the stack"; accumulating a repeat must fail "the same LoRA cannot be
 * stacked onto itself".
 */
export function chooseLora(
  current: NozzleInput,
  card: ModelCard,
  familia: string | null | undefined,
): LoraChoice[] {
  const stack = loraStack(current);
  const next = loraChoiceOf(card);
  if (!next) return stack;
  if (!familia || card.basis !== familia) return stack;
  const held = stack.some((c) => c.intellaId === next.intellaId);
  if (held) return stack.filter((c) => c.intellaId !== next.intellaId);
  return [...stack, next];
}

/**
 * Setting ONE entry's weight, leaving every other entry exactly as it was.
 *
 * A stack whose entries share a weight field is worse than no stack: the user sets 0.8
 * on one model and silently moves another they are already paying for. Each entry
 * carries its own `weight`, and an entry that has never been given one stays `null` —
 * "the LoRA's own default" — rather than inheriting its neighbour's.
 *
 * Non-vacuity: writing the weight onto every entry must fail "each stacked LoRA carries
 * its own weight, and an unset weight stays unset rather than inheriting its
 * neighbour's".
 */
export function setLoraWeight(
  current: NozzleInput,
  intellaId: string,
  value: number | null | undefined,
): LoraChoice[] {
  return loraStack(current).map((c) =>
    c.intellaId === intellaId ? { ...c, weight: loraWeight(value) } : c,
  );
}

/** Whether two nozzles differ — in which models they carry, in what order, or in the
 *  weight any one of them is carried at. What the screen holds the stream for. */
export function nozzleChanged(before: NozzleInput, after: NozzleInput): boolean {
  const a = loraStack(before);
  const b = loraStack(after);
  if (a.length !== b.length) return true;
  return a.some((c, i) => c.intellaId !== b[i].intellaId || (c.weight ?? null) !== (b[i].weight ?? null));
}

/** The trigger words the hold is loading, for the readout that names them. `undefined`
 *  when there is nothing on the nozzle, which is what `HoldState.trigger` omits. */
export function nozzleTriggerLabel(nozzle: NozzleInput): string | undefined {
  const stack = loraStack(nozzle);
  return stack.length === 0 ? undefined : stack.map((c) => c.trigger).join(' + ');
}

/** A weight the control will emit: inside the band, or `null` for "the LoRA's own
 *  default", which is what a bare trigger word means to the resolver. */
export function loraWeight(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(LORA_WEIGHT_MAX, Math.max(LORA_WEIGHT_MIN, value));
}

/**
 * The trigger as it is written into a prompt.
 *
 * The resolver's syntax is NOT re-implemented here — this emits one of the two forms it
 * already documents and reads: a bare `trigger` (applied at the LoRA's own
 * `defaultWeight`) or `trigger:0.8` (an explicit override). Everything else the
 * resolver understands — the `!`/`.` modifiers, explicit `<lora:…>` tags, the silencing
 * `:0.0` — stays the resolver's and is never generated here.
 */
export function triggerToken(choice: LoraChoice): string {
  const weight = loraWeight(choice.weight);
  return weight == null ? choice.trigger : `${choice.trigger}:${weight}`;
}

/**
 * The prompt a piece is actually fired with: the drawn prompt, led by the trigger word
 * of EVERY LoRA on the nozzle. With nothing on the nozzle it is the drawn prompt,
 * unchanged.
 *
 * EVERY entry's trigger, not the first one's. A pinned model whose trigger never reaches
 * the prompt is exactly the paid-run-with-no-effect that `loraChoiceOf` refuses a
 * triggerless card to avoid — stacking three and writing one reproduces it twice over,
 * at full price, per piece.
 *
 * The triggers are prepended and comma-separated, which is a delimiter the resolver's
 * own tokenizer splits on, so each word is reachable by its scan wherever the drawn
 * prompt happens to begin.
 *
 * Non-vacuity: returning `prompt` unchanged must fail "a piece fired under a LoRA
 * carries that LoRA's trigger word in its prompt"; writing only the first entry's
 * trigger must fail "the prompt carries every stacked LoRA's trigger word".
 */
export function promptWithTrigger(prompt: string, nozzle: NozzleInput): string {
  const stack = loraStack(nozzle);
  if (stack.length === 0) return prompt;
  const body = prompt.trim();
  const tokens = stack.map(triggerToken).join(', ');
  return body ? `${tokens}, ${body}` : tokens;
}

/**
 * A standing instruction that rides EVERY prompt fired on this nozzle, blanket the way
 * the model choice does — set once, and every piece from then on carries it until it is
 * changed, unlike a steer, which is sent once and lands on the floor. It is client
 * state on the same terms as the model choice: it does not survive a reload, and it
 * never writes the floor, restamps a fragment, or opens a `SteerState`.
 */
export interface AffixInput {
  prefix?: string | null;
  suffix?: string | null;
}

function hasAffix(affix: AffixInput | null | undefined): boolean {
  return !!((affix?.prefix ?? '').trim() || (affix?.suffix ?? '').trim());
}

/** The affix in words, for the nozzle's own collapsed line — `undefined` when nothing is
 *  riding, so a bare nozzle summary reads exactly as it did before this item. Abbreviated
 *  rather than wrapped, the same way the tile readout is (`TILE_READOUT_MAX`). */
const AFFIX_READOUT_MAX = 28;

export function affixSummaryLine(affix?: AffixInput | null): string | undefined {
  if (!hasAffix(affix)) return undefined;
  const prefix = (affix?.prefix ?? '').trim();
  const suffix = (affix?.suffix ?? '').trim();
  const parts: string[] = [];
  if (prefix) parts.push(`prefix “${trim(prefix, AFFIX_READOUT_MAX)}”`);
  if (suffix) parts.push(`suffix “${trim(suffix, AFFIX_READOUT_MAX)}”`);
  return parts.join(' · ');
}

/**
 * The prompt a piece is actually fired with, the standing affix composed in ON TOP of
 * `promptWithTrigger`'s own trigger-leading rule — never through it. A LoRA trigger
 * token always leads the final prompt; the affix composes AROUND that block, never
 * displacing, duplicating or reordering a trigger. The prefix sits immediately after
 * the trigger tokens (or leads the prompt when there is no LoRA chosen) and before the
 * drawn text; the suffix always trails everything, after the drawn text.
 *
 * Empty means untouched: with no prefix and no suffix this returns exactly what
 * `promptWithTrigger` returns, unmodified — so every existing call site is unaffected
 * until an affix is actually set.
 *
 * Non-vacuity: dropping the affix on either the stream or the manual path must fail "a
 * fired piece carries the standing prefix and suffix"; reverting the empty-affix guard
 * must fail "an empty prefix and suffix leave the prompt byte-identical"; reverting the
 * ordering must fail "every LoRA trigger token is still present, exactly once, and
 * still leads the prompt".
 */
export function promptWithAffix(prompt: string, nozzle: NozzleInput, affix?: AffixInput | null): string {
  if (!hasAffix(affix)) return promptWithTrigger(prompt, nozzle);

  const stack = loraStack(nozzle);
  const tokens = stack.length > 0 ? stack.map(triggerToken).join(', ') : '';
  const prefix = (affix?.prefix ?? '').trim();
  const suffix = (affix?.suffix ?? '').trim();
  const body = prompt.trim();

  const lead = [tokens, prefix, body].filter((part) => part.length > 0).join(', ');
  return suffix ? (lead ? `${lead}, ${suffix}` : suffix) : lead;
}

/** The weights the run is given, by `intellaId` — the unambiguous half of the field's
 *  documented "intellaId or slug", picked once and used consistently. */
export function pinnedModelsFor(nozzle: NozzleInput): string[] {
  return loraStack(nozzle).map((c) => c.intellaId);
}

/**
 * The run request for ONE fired piece: the prompt carrying the trigger and the standing
 * affix, and the pinned weights the trigger resolves against.
 *
 * ONE COMPOSER FOR BOTH PATHS, and the name says so rather than naming the stream. A
 * piece fired by hand off a rolled card (`Muse.tsx#doFire`) and a piece fired by the
 * stream loop take the same route and are composed here, not twice: the nozzle is one
 * control on one screen, and a path that read it while its neighbour did not would make
 * the model beside the prompt mean two different things.
 *
 * BOTH HALVES OR NEITHER. `ignitionRequest` above stays exactly as it is — a mined
 * fragment's own trigger is still never lifted into `pinnedModels`, because that would
 * attach a model the user never chose. This path pins only what the user picked on the
 * nozzle control.
 *
 * NOTHING IS RESHAPED WHEN THERE IS NO NOZZLE. With an empty stack and no affix this is
 * `ignitionRequest(modusId, prompt)` exactly — the same keys and the same prompt string —
 * so a hand fire with no model chosen sends what it sent before.
 *
 * Non-vacuity: dropping `pinnedModels` must fail "a piece fired under a LoRA names it in
 * pinnedModels"; pinning only the first entry must fail "a piece fired under two LoRAs
 * names BOTH in pinnedModels"; reshaping the empty-nozzle request must fail "a hand-fired
 * piece with an empty stack sends what it sends today".
 */
export function firedRunRequest(
  modusId: string,
  prompt: string,
  nozzle: NozzleInput,
  affix?: AffixInput | null,
): RunRequest {
  const request = ignitionRequest(modusId, promptWithAffix(prompt, nozzle, affix));
  const pinned = pinnedModelsFor(nozzle);
  return pinned.length > 0 ? { ...request, pinnedModels: pinned } : request;
}

/** rth's rider on the nozzle stack (noema-276 shipped no cap, which is the ruling; this
 *  is the one readout it was still missing): a stack this deep is a longer COLD START,
 *  not a worse result and not anything refused — the stack still fires at any size, this
 *  only names the wait more plainly once it is long enough to be worth naming twice. */
export const DEEP_STACK_WARMUP_THRESHOLD = 4;

/** What the readout says while the first piece under a newly chosen nozzle is being
 *  made. The pod fetches the weights before it can make anything with them, so the first
 *  piece can be slow; said in words, it is a wait rather than a stall. A stack makes this
 *  matter MORE, not less — several sets of weights are fetched before the first piece —
 *  so the note names how many are coming down, and past `DEEP_STACK_WARMUP_THRESHOLD`
 *  it names the cold start explicitly rather than leaving the reader to infer it from a
 *  count. */
export function loraWarmupNote(nozzle: NozzleInput): string | null {
  const stack = loraStack(nozzle);
  if (stack.length === 0) return null;
  const names = stack.map((c) => c.nomen).join(' + ');
  if (stack.length === 1) {
    return `first piece under ${names} may be slow — the pod fetches its weights before it can use them`;
  }
  if (stack.length < DEEP_STACK_WARMUP_THRESHOLD) {
    return `first piece under ${names} may be slow — the pod fetches all ${stack.length} sets of weights before it can use them`;
  }
  return `first piece under ${names} may be slow — a stack this deep means a longer cold start, fetching all ${stack.length} sets of weights before the pod can use any of them`;
}

/** The chosen nozzle in one line, trigger word included: S5 asks for the trigger to be
 *  visible on the chosen model and not only in the picker, because it is the part a user
 *  has to see to trust that the model is being applied at all. */
export function loraChoiceLine(nozzle: NozzleInput): string {
  const stack = loraStack(nozzle);
  if (stack.length === 0) return 'no model — the workflow’s own base only';
  return stack
    .map((choice) => {
      const weight = loraWeight(choice.weight);
      return `${choice.nomen} · trigger ${choice.trigger}${weight == null ? '' : ` · weight ${weight}`}`;
    })
    .join(' + ');
}

// ── The setup survives a reload (noema-287) ─────────────────────────────────
//
// A session's PIECES come back and, until this item, its SETUP did not: the flow, the
// run shape, the nozzle stack and the standing affix were plain screen state with
// hardcoded initials, so a reload returned the user to a session with its work intact
// and its engine reset to defaults.
//
// IT LIVES ON THE SESSION, SERVER-SIDE, hydrated on mount — the shape this screen
// already uses for the floor. The alternative is a browser store, and it is wrong here
// for the reason the floor is not in one: a session is a durable, owner-scoped,
// resumable record, so a setup held in one browser would disagree with the session the
// moment it was opened anywhere else. `src/crystal/muse/session.ts` carries the setup
// as a field of the PURE session value rather than of the persistence envelope, whose
// four fields are declared not to change.
//
// TWO RULES MAKE IT SAFE, and both are gated below.
//
//   HYDRATING IS NOT FIRING. Everything here is a pure read: no function in this
//   section makes a request, prices anything, or produces a run. A restored setup
//   leaves the screen exactly where choosing it by hand leaves it — armed, priced by
//   the ordinary quote path, and spending nothing until launch is pressed.
//
//   A MODEL THAT IS NO LONGER THERE IS NAMED, NOT DROPPED. A stored stack can cite a
//   model that has been deleted, or a private one the catalog no longer offers.
//   `resolveNozzle` resolves the stack against the catalog and hands back what it could
//   not restore, by name, so the screen can say it. Firing under fewer models than the
//   line claims is a wrong image at full price.
//
// The infinite-mode acknowledgement is not persisted and is not restored: it is consent
// for one sitting, and there is no field for it anywhere on this path.

/** The run shape a fresh configuration starts on, and the one a session with no stored
 *  setup comes back to. */
export const DEFAULT_STREAM_CONFIG: StreamConfig = { mode: 'batched', cap: 12, acknowledged: false };

/** The screen state a setup is written from and restored into. */
export interface SetupState {
  modusId: string | null;
  config: StreamConfig;
  nozzle: NozzleInput;
  affix?: AffixInput | null;
}

/**
 * The setup as it is sent to the session.
 *
 * `acknowledged` IS NOT WRITTEN, and it is not an omission that a later reader should
 * tidy up: an infinite-mode acknowledgement is consent for the sitting that gave it, so
 * a stored one would come back on the next mount and let a reload arrive already
 * agreed to a run that has no count to stop it. The wire type has no field for it and
 * the server's normalizer has none either — this is the first of the three places that
 * refuse it.
 *
 * Non-vacuity: writing the acknowledgement must fail "a restored session comes back
 * UNACKNOWLEDGED".
 */
export function setupOf(state: SetupState): MuseSetup {
  const stack = loraStack(state.nozzle);
  const prefix = (state.affix?.prefix ?? '').trim();
  const suffix = (state.affix?.suffix ?? '').trim();
  return {
    ...(state.modusId ? { modusId: state.modusId } : {}),
    mode: state.config.mode,
    cap: Math.max(1, Math.trunc(state.config.cap)),
    ...(stack.length > 0
      ? {
          nozzle: stack.map((choice) => {
            const weight = loraWeight(choice.weight);
            return {
              intellaId: choice.intellaId,
              nomen: choice.nomen,
              trigger: choice.trigger,
              ...(weight == null ? {} : { weight }),
            };
          }),
        }
      : {}),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

/** A setup read back off a session. The stack is still UNRESOLVED — it is a list of
 *  stored entries until `resolveNozzle` matches it against the catalog. */
export interface RestoredSetup {
  modusId: string | null;
  config: StreamConfig;
  nozzle: MuseNozzleEntry[];
  affix: AffixInput;
}

/**
 * The setup a resumed session comes back with.
 *
 * A PURE READ. It takes a session view and returns screen state: it makes no request,
 * asks for no price, and cannot start the stream loop — restoring a setup is free, and
 * the launch control is still the only thing that spends.
 *
 * `acknowledged` is forced to `false` here whatever the session carries. The field is
 * not written (`setupOf`), has no place in the wire type, and is dropped by the
 * server's normalizer — this is the last of the three refusals, and it is the one that
 * holds even for a session written before those existed.
 *
 * Non-vacuity: returning a stored acknowledgement must fail "a restored session comes
 * back UNACKNOWLEDGED"; making a request from here must fail "hydrating fires no run
 * and no quote".
 */
export function hydrateSetup(view: MuseSessionView | null | undefined): RestoredSetup {
  const setup = (view?.setup ?? {}) as MuseSetup & { acknowledged?: unknown };
  const cap = typeof setup.cap === 'number' && Number.isFinite(setup.cap)
    ? Math.max(1, Math.trunc(setup.cap))
    : DEFAULT_STREAM_CONFIG.cap;
  return {
    modusId: setup.modusId ?? null,
    config: {
      mode: setup.mode === 'infinite' ? 'infinite' : 'batched',
      cap,
      // Consent for one sitting. Never restored, whatever arrives.
      acknowledged: false,
    },
    nozzle: [...(setup.nozzle ?? [])],
    affix: {
      ...(setup.prefix ? { prefix: setup.prefix } : {}),
      ...(setup.suffix ? { suffix: setup.suffix } : {}),
    },
  };
}

/** A restored stack, and what could not be restored. */
export interface ResolvedNozzle {
  /** The entries that resolved against the live catalog, in their stored order. */
  stack: LoraChoice[];
  /** The names of the entries that did not, in their stored order. */
  missing: string[];
}

/**
 * A stored stack resolved against the catalog that is actually on offer.
 *
 * EVERY ENTRY IS RE-RESOLVED, never trusted as stored. A stack is stored with the
 * model's id, name and trigger word, and any of the three can go stale: the model may
 * have been deleted, made private, or re-triggered since. The card the catalog offers
 * now is the one that fires, so the restored choice is built from that card and the
 * stored entry contributes only its weight and its position.
 *
 * The `familia` scope is checked here for the same reason `chooseLora` checks it: a
 * LoRA trained on another base is a paid run that cannot work, and a restored stack
 * must not be a way around a refusal the picker enforces.
 *
 * AN ENTRY THAT DOES NOT RESOLVE IS RETURNED BY NAME, NOT DROPPED. Silently firing
 * under fewer models than the stored line claims is a wrong image at full price, every
 * piece, with nothing on screen saying so.
 *
 * Non-vacuity: dropping the unresolved entries instead of returning them must fail "a
 * restored stack naming a model that is gone SAYS SO".
 */
export function resolveNozzle(
  entries: readonly MuseNozzleEntry[] | null | undefined,
  offer: readonly ModelCard[],
  familia: string | null | undefined,
): ResolvedNozzle {
  const stack: LoraChoice[] = [];
  const missing: string[] = [];
  const byId = new Map<string, ModelCard>();
  for (const card of offer) byId.set(card.intellaId, card);

  for (const entry of entries ?? []) {
    const card = byId.get(entry.intellaId);
    const choice = card ? loraChoiceOf(card) : null;
    if (!card || !choice || !familia || card.basis !== familia) {
      missing.push(entry.nomen || entry.intellaId);
      continue;
    }
    stack.push({ ...choice, weight: loraWeight(entry.weight ?? null) });
  }
  return { stack, missing };
}

/** What the screen says about the entries a resume could not put back, or `null` when
 *  every entry came back. Named plainly: the user is about to fire under a stack that
 *  is shorter than the one they left, and the price does not go down with it. */
export function missingNozzleNote(missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  const names = missing.join(', ');
  return missing.length === 1
    ? `${names} is no longer available on this workflow — it is NOT on the nozzle, and pieces will fire without it`
    : `${names} are no longer available on this workflow — they are NOT on the nozzle, and pieces will fire without them`;
}

// ── The controls get out of the way, on the user's hand, at any time (noema-264, noema-282) ──
//
// On a wide viewport the configuration, the nozzle and the steer dock read as chrome
// around the grid. On a narrow one they are most of the viewport, and the stream — the
// thing the user launched and is paying for — is what they scroll past the menu to see.
//
// The rule is here, and pure, because this is where it can be gated: the hermetic web
// tests run from the repo root under `tsx --test` with no react in scope, so a rule that
// lived in `Muse.tsx` could not be asserted at all.

/** The three blocks that collapse to a summary line. The launch/stop control, the price
 *  readout and the infinite acknowledgement are NOT in this list and never collapse:
 *  they are what starts, stops and prices the stream. */
export type MuseControl = 'configuration' | 'nozzle' | 'steer';

/** The user's hand on each control. `'open'` or `'closed'` PINS it against the auto
 *  rule below, in either direction, at any phase — including before a stream has begun.
 *  No entry (the common case) leaves the auto rule to decide. Only the user's hand ever
 *  writes here; the auto rule reads `hand` but never writes it. */
export type ControlHand = Partial<Record<MuseControl, 'open' | 'closed'>>;

export interface ControlCollapseInput {
  /** Where the stream is. */
  phase: StreamPhase;
  /** How many pieces are on the stream right now. */
  pieces: number;
  /** The controls the user has pinned open or closed by hand. */
  hand: ControlHand;
}

export interface ControlCollapse {
  configuration: boolean;
  nozzle: boolean;
  steer: boolean;
}

/** A stream that has something to show: pieces already on it, or a loop riding toward
 *  the first one. Until then there is nothing for the controls to be in the way of. */
function streamHasBegun(input: Pick<ControlCollapseInput, 'phase' | 'pieces'>): boolean {
  if (input.pieces > 0) return true;
  return input.phase === 'running' || input.phase === 'holding' || input.phase === 'stopping';
}

/**
 * Which launcher controls — configuration, nozzle, and the steer dock — are collapsed
 * to their summary lines.
 *
 * Four properties, and each is load-bearing:
 *
 *  - A stream with pieces on it collapses all three. The grid gets the viewport.
 *  - A session with nothing on it opens EXPANDED. Collapsing an idle screen would hide
 *    the only control that starts anything, which is the one thing a fresh screen is for.
 *  - The collapse is a DEFAULT, never a lock: a control the user pinned open stays open
 *    while the stream rides, and nothing re-collapses it under their hand.
 *  - The pin runs the OTHER way too, and at any phase: a control the user pinned closed
 *    stays closed even before the stream has begun. Configuring a run is exactly when
 *    the banner is tallest, and exactly when the user must be able to fold it.
 *
 * Non-vacuity: reverting the collapse must fail "a stream with pieces on it collapses
 * the configuration, the nozzle and the steer dock to their summary lines"; reverting
 * the idle branch must fail "a session with nothing on it opens with every control
 * expanded"; reverting the open-pin must fail "pinning a control open keeps it expanded
 * while the stream rides"; reverting the closed-pin must fail "a control can be
 * collapsed by hand with zero pieces fired".
 */
export function collapsedControls(input: ControlCollapseInput): ControlCollapse {
  const begun = streamHasBegun(input);
  const resolve = (control: MuseControl): boolean => {
    const pin = input.hand[control];
    if (pin === 'open') return false;
    if (pin === 'closed') return true;
    return begun;
  };
  return {
    configuration: resolve('configuration'),
    nozzle: resolve('nozzle'),
    steer: resolve('steer'),
  };
}

/** The user's hand pinning one control open or closed. This is the only place a control
 *  is ever set to `'closed'` or `'open'` — the auto rule above never writes `hand`, so a
 *  pin persists through every phase the stream moves through until the user's hand
 *  changes it again. */
export function setControlHand(hand: ControlHand, control: MuseControl, open: boolean): ControlHand {
  const next: 'open' | 'closed' = open ? 'open' : 'closed';
  return hand[control] === next ? hand : { ...hand, [control]: next };
}

/**
 * The collapsed nozzle in one line: the model that is loaded AND the weight it is
 * loaded at.
 *
 * This is not `loraChoiceLine`, which omits the weight when none is set. A collapsed row
 * exists to answer "what is firing right now" without being opened, and "at its own
 * default" is an answer where a missing clause is not — the user is mid-stream and
 * spending against whatever this says.
 *
 * A STACK IS NAMED, NEVER COUNTED. "3 models" answers a question nobody asked: the
 * trigger word is on this line because it is the part a user has to see to trust that a
 * model is reaching the prompt at all, and a count carries none of it. Every entry is
 * named with its trigger and its weight; where the row runs out of room the ELISION is
 * the stylesheet's, on text that is already there.
 *
 * Non-vacuity: dropping the weight clause must fail "a collapsed nozzle still names the
 * model that is loaded and its weight"; dropping the affix clause must fail "the
 * collapsed nozzle line names the standing affix when one is set".
 */
export function nozzleSummaryLine(nozzle: NozzleInput, affix?: AffixInput | null): string {
  const stack = loraStack(nozzle);
  const base = stack.length === 0
    ? 'no model — the workflow’s own base only'
    : stack
      .map((choice) => {
        const weight = loraWeight(choice.weight);
        const at = weight == null ? 'its own default weight' : `weight ${weight}`;
        return `${choice.nomen} · trigger ${choice.trigger} · ${at}`;
      })
      .join(' + ');
  const affixLine = affixSummaryLine(affix);
  return affixLine ? `${base} · ${affixLine}` : base;
}

/** The collapsed configuration in one line: what it is firing through, in which run
 *  mode, and — batched — how many pieces that mode is bounded by. */
export function configSummaryLine(config: StreamConfig, workflow: string | null): string {
  const run = config.mode === 'infinite' ? 'infinite' : `batched · ${config.cap} pieces`;
  const flow = (workflow ?? '').trim();
  return `${flow || 'no workflow'} · ${run}`;
}

/**
 * The collapsed steer dock in one line: the floor line it already shows expanded, or
 * the failure if the last steer sent did not land.
 *
 * A collapsed control that hides a failure is worse than one that never collapses — the
 * user is mid-stream and spending against a steer they cannot see failed. `failure`
 * outranks the floor line for exactly that reason.
 *
 * Non-vacuity: dropping the failure branch must fail "a collapsed steer dock still says
 * a steer failed".
 */
export function steerDockSummaryLine(input: { floorLine: string; failure: string | null }): string {
  if (input.failure) return `steer failed — ${input.failure}`;
  return input.floorLine;
}

// ── The banner is ONE line while a stream is live (noema-286) ───────────────
//
// `collapsedControls` folds three blocks to three summary lines, and three summary
// lines plus the floor readout, the launch row, the cold-start note and the estimate
// footnote is still most of a phone viewport. Nothing had ever owned the banner's
// COMBINED height: each line arrived with its own item and each is defensible alone.
//
// So the fold is owned here, at the banner, and the unit it is measured in is LINES.
// Folded, the banner is one row that answers only what is running, how far along it is
// and what it is costing. Everything else is one press away — one, never two, and never
// behind a scroll.

/** Every line the banner can render. The ids are what `Muse.tsx` renders against, so a
 *  line that is not in `RunBanner.lines` is not on the screen at all. */
export type BannerLineId = 'run' | 'configuration' | 'nozzle' | 'floor' | 'estimate' | 'warmup';

export interface BannerLine {
  id: BannerLineId;
  text: string;
}

export interface RunBannerInput extends ControlCollapseInput {
  /** The banner's own press. `false` is the folded state; the user's press opens the
   *  detail, and it is a separate hand from the per-control pins in `hand`. */
  detail: boolean;
  config: StreamConfig;
  workflow: string | null;
  nozzle: NozzleInput;
  /** The standing prefix/suffix (noema-284), if one is set. It rides EVERY prompt, so it
   *  is part of what the user is spending against and belongs on the same line the model
   *  does — folded it is signalled, opened it is quoted. */
  affix?: AffixInput | null;
  /** The live status and price readout, as `streamStatusLine` composed it. */
  status: string;
  /** The floor readout the launcher carries, without its control. */
  floorLine: string;
  /** The models the pod has yet to fetch weights for. */
  warmup: NozzleInput;
  /** How many pieces have LANDED — a fired piece that is still running has not. */
  landed: number;
  /** Whether there is a quote, i.e. whether the `~` has anything to explain. */
  quoted: boolean;
}

export interface RunBanner {
  /** The lines the banner renders, in order. */
  lines: BannerLine[];
  /** Whether the control that ends the spend is rendered. True for every live phase,
   *  folded or not: nothing may fold away the stop. */
  stop: boolean;
  /** The banner's own control, or `null` before a stream has begun — there is nothing
   *  to fold away from a screen that has not launched anything. */
  press: 'more' | 'less' | null;
  folded: boolean;
}

/** The estimate footnote. It explains the `~` and never changes, which is what makes it
 *  a candidate for the fold rather than an exemption from it. */
export const ESTIMATE_NOTE =
  '~ is an estimate: the figure is the run’s reservation, and the server prices and charges every piece when it settles.';

/** How many pieces have come back. A piece is fired into the stream as `running` and
 *  landed when its run reaches a terminal, so this is not `pieces.length` — and the
 *  difference is the whole lifetime of the cold-start note. */
export function landedPieces(state: StreamState): number {
  const done = (p: StreamPiece): boolean => p.status !== 'running';
  return state.pieces.filter(done).length + state.pending.filter(done).length;
}

/**
 * The nozzle as the folded banner carries it: named at one, COUNTED at two or more.
 *
 * This reverses `nozzleSummaryLine`'s stated rule, deliberately and only at depth. That
 * rule — a stack is named, never counted — was written when a nozzle was one model, and
 * it is right there: one name and one trigger is a clause. At three it is a paragraph,
 * and a paragraph is the thing this item exists to remove.
 *
 * The reason the old rule existed does NOT go away: a user mid-stream is spending
 * against whatever this line says. So the count is only ever one press from the names,
 * their triggers and their weights — `nozzleSummaryLine` is unchanged and is what the
 * opened banner shows.
 *
 * Non-vacuity: naming the stack here must fail "a three-model stack folds without naming
 * all three".
 */
export function nozzleFoldLine(nozzle: NozzleInput, affix?: AffixInput | null): string {
  const stack = loraStack(nozzle);
  const base = stack.length === 0
    ? 'the workflow’s own base only'
    : stack.length === 1
      ? `${stack[0].nomen} · trigger ${stack[0].trigger}`
      : `${stack.length} models stacked`;
  // A standing affix rides every prompt, so a folded banner that does not admit it exists
  // is the bill the user cannot read (noema-284). The WORDS are one press away with the
  // model names; what folding may not do is hide that there are any.
  return hasAffix(affix) ? `${base} · standing text` : base;
}

/**
 * What the banner renders, as a list of lines.
 *
 * Folded (a stream has begun and the user has not pressed for the detail) that list is
 * ONE line, and the cold-start note while it is alive. Opened, it is the same summary
 * lines the launcher showed before, each still carrying its own control.
 *
 * Three things are settled here and each is load-bearing:
 *
 *  - **The status leads the folded line.** It carries the count and the spend, it is
 *    the one thing that never folds, and it is first so that the stylesheet's elision
 *    falls on the configuration tail — which is one press away — rather than on the
 *    price, which is not recoverable by pressing anything.
 *  - **The cold-start note is a claim about the FIRST piece.** It lives until a piece
 *    lands and not one moment longer; after that it is furniture on the tallest part of
 *    the screen. It is not folded while it lives — a warning the user must press to
 *    find is a warning that arrives after the wait it was explaining.
 *  - **The estimate footnote folds.** It explains the `~` and never changes, so it is
 *    the clearest candidate for the press; the `~` itself stays on the folded line.
 *
 * What is NOT here, and stays where it is in `Muse.tsx`: the launch/stop control, the
 * infinite acknowledgement, and every error and refusal line. A control that ends the
 * spend, a gate that has to be ticked, and a failure the user is spending against are
 * not furniture and are never behind a press.
 *
 * Non-vacuity: dropping the fold must fail "a running stream renders ONE banner line,
 * not one per control"; dropping the landed check must fail "the cold-start note is gone
 * once a piece has landed"; folding the stop must fail "stop is rendered while the banner
 * is folded".
 */
export function runBanner(input: RunBannerInput): RunBanner {
  const begun = streamHasBegun(input);
  const folded = begun && !input.detail;
  const collapsed = collapsedControls(input);
  const config = configSummaryLine(input.config, input.workflow);

  const lines: BannerLine[] = [
    {
      id: 'run',
      text: folded ? `${input.status} · ${config} · ${nozzleFoldLine(input.nozzle, input.affix)}` : input.status,
    },
  ];
  if (!folded) {
    if (collapsed.configuration) lines.push({ id: 'configuration', text: config });
    if (collapsed.nozzle) lines.push({ id: 'nozzle', text: nozzleSummaryLine(input.nozzle, input.affix) });
    lines.push({ id: 'floor', text: input.floorLine });
    if (input.quoted) lines.push({ id: 'estimate', text: ESTIMATE_NOTE });
  }

  // The note warns that the first piece may be slow. Once one has landed the wait it
  // described is over and the sentence is answering a question nobody is still asking.
  const warmup = input.phase === 'running' && input.landed === 0 ? loraWarmupNote(input.warmup) : null;
  if (warmup) lines.push({ id: 'warmup', text: warmup });

  return {
    lines,
    stop: input.phase === 'running' || input.phase === 'holding' || input.phase === 'stopping',
    press: begun ? (input.detail ? 'less' : 'more') : null,
    folded,
  };
}

/** The viewport the phone layout starts at. Declared here and used by `Muse.tsx` to pick
 *  the picker's chrome, so the query the script switches on is the same string the
 *  stylesheet switches on — `muse.css`'s `@media (max-width: 640px)` block must be kept
 *  in step with this value. */
export const MUSE_NARROW_VIEWPORT = '(max-width: 640px)';

// ── The session history (noema-274) ─────────────────────────────────────────
// `listMuseSessions` has been the resume lookup and nothing else: the screen took the
// most recently changed session off it and dropped the rest, so every earlier session a
// dataset carried was unaddressable from the product. The rules below are what a history
// is made of — an ordered list, a readout per row, a client-side search, and the entry
// rule that decides what a visit does when it arrives.
//
// EVERYTHING HERE IS A READ. A recorded piece stores its lineage and its flags, not its
// image; the image is resolved from the piece's own run when a session is opened, through
// the same rehydrate path a resumed session already takes. Listing sessions fetches no
// run at all — a session with sixty pieces must not cost sixty run reads to render one
// row — so a row is built from counts and lineage text only.
//
// BROWSING IS NOT WORKING. `MuseSessions.save` restamps `mutatum`, and `mutatum` is both
// this list's sort key and what `latestSession` resumes by, so any write to an older
// session moves the resume pointer onto it. Opening a session from the history is
// therefore a read of one named session and writes nothing. Work done inside an opened
// session — a reaction, a save, a launch — does restamp it, which is correct: that is the
// session becoming the most recently worked one.

/** One session as the history lists it. Built from the session view alone — no run is
 *  fetched to produce a row. */
export interface SessionRow {
  id: string;
  /** When the session was spawned, and when it was last worked, as the wire carries them. */
  natum: string;
  mutatum: string;
  /** Recorded pieces, and how many of them were put back into the set. */
  pieces: number;
  saved: number;
  /** True when the session recorded no pieces at all. Such a session is still listed. */
  empty: boolean;
  /** The distinct fragment texts across every piece's lineage, in first-seen order —
   *  what the session is remembered by, and what a search reads. */
  lineage: string[];
  /** The row's readout. An empty session says it is empty rather than showing a blank. */
  line: string;
}

/** What one row says about itself. A session that recorded nothing says so out loud:
 *  it is the case a history most needs to answer, and a row that rendered a bare `0`
 *  answers it with silence.
 *  Non-vacuity: returning the piece-count sentence for an empty session must fail "a
 *  session that recorded no pieces is still listed, and says so". */
function sessionRowLine(pieces: number, saved: number): string {
  if (pieces === 0) return 'nothing was recorded in this session';
  const p = `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`;
  return saved > 0 ? `${p} · ${saved} saved back into the set` : `${p} · none saved`;
}

/** One session, as a row. */
export function sessionRow(view: MuseSessionView): SessionRow {
  const seen = new Set<string>();
  const lineage: string[] = [];
  let saved = 0;
  for (const piece of view.pieces) {
    if (piece.saved) saved += 1;
    for (const f of piece.fragments) {
      const text = f.text.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      lineage.push(text);
    }
  }
  return {
    id: view.id,
    natum: view.natum,
    mutatum: view.mutatum,
    pieces: view.pieces.length,
    saved,
    empty: view.pieces.length === 0,
    lineage,
    line: sessionRowLine(view.pieces.length, saved),
  };
}

/**
 * The history: every session off this dataset, most recently worked first.
 *
 * The order is `mutatum` descending — the same key `latestSession` resumes by, so the
 * first row of the history is the session a bare visit to the muse door lands in, and
 * the list reads as the work does.
 *
 * A session that recorded no pieces is NOT filtered out. It is the session a user is
 * most likely hunting for — a run that produced nothing is exactly the run they cannot
 * account for — and a history that hides it answers the question with silence.
 *
 * Non-vacuity: dropping the sort must fail "sessions are listed most recently worked
 * first"; filtering the empty ones must fail "a session that recorded no pieces is still
 * listed, and says so".
 */
export function sessionHistory(sessions: readonly MuseSessionView[]): SessionRow[] {
  return sessions
    .map(sessionRow)
    .sort((a, b) => (a.mutatum < b.mutatum ? 1 : a.mutatum > b.mutatum ? -1 : 0));
}

/**
 * Whether a row answers a search.
 *
 * A session is remembered by what it made, so the primary field is the fragment TEXT in
 * its pieces' lineages — the words the prompts were assembled from. The dates it was
 * spawned and last worked, and its readout (which carries the counts), match too, so
 * "saved" or a day finds a session as readily as a subject does.
 *
 * Filtering happens entirely on what `listMuseSessions` already returned; no route
 * surface changes for search, and nothing is fetched to answer a keystroke. An empty
 * query matches everything.
 *
 * Non-vacuity: dropping the lineage field must fail "a search matches a session by the
 * text of a fragment in a piece's lineage".
 */
export function matchesSessionQuery(row: SessionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.lineage.some((text) => text.toLowerCase().includes(q))) return true;
  if (row.line.toLowerCase().includes(q)) return true;
  return row.natum.toLowerCase().includes(q) || row.mutatum.toLowerCase().includes(q);
}

/** The history as the search leaves it, in the same order. */
export function filterSessionHistory(rows: readonly SessionRow[], query: string): SessionRow[] {
  return rows.filter((row) => matchesSessionQuery(row, query));
}

/** What a search that matched nothing says, or `null` while there is something to show. */
export function sessionSearchEmptyNote(rows: readonly SessionRow[], query: string): string | null {
  if (rows.length > 0) return null;
  return query.trim()
    ? 'no session matches that — search runs over the fragments each piece was drawn from'
    : 'no muse sessions off this dataset yet';
}

/** The quiet line the dataset screen carries beside its muse door: how many sessions
 *  this dataset has, and nothing else. `null` when there are none — the door alone is
 *  the whole story then. */
export function sessionCountLine(sessions: readonly MuseSessionView[]): string | null {
  const n = sessions.length;
  if (n === 0) return null;
  return `${n} muse ${n === 1 ? 'session' : 'sessions'} off this dataset`;
}

/**
 * How a visit to the muse screen finds its session.
 *
 * - `read` — the visit named a session, so that one session is READ by id. Nothing is
 *   listed, nothing is spawned, and nothing is written: the named session's `mutatum`
 *   stays exactly where it was, so a later bare visit still resumes whatever it
 *   resumed before.
 * - `resume` — a bare visit, which is the door the dataset screen has always opened:
 *   list the dataset's sessions, resume the most recently worked, spawn one when there
 *   is none.
 *
 * The session travels as a QUERY parameter rather than a path segment: `/datasets/:id/muse`
 * already exists and means "resume", it is the link the dataset screen and every existing
 * bookmark carry, and its meaning is unchanged by this item. A query adds an addressable
 * name for one session without redefining a live route.
 *
 * Non-vacuity: resolving a named session through the resume path instead must fail
 * "opening an older session does not change which session a bare visit resumes".
 */
export type SessionEntry = { kind: 'read'; sessionId: string } | { kind: 'resume' };

/** The query parameter that names a session on the muse route. */
export const SESSION_PARAM = 'session';

export function sessionEntry(param: string | null | undefined): SessionEntry {
  const id = (param ?? '').trim();
  return id ? { kind: 'read', sessionId: id } : { kind: 'resume' };
}

/**
 * Whether merely arriving through this entry writes to a session that already exists.
 *
 * Always false, and that is the rule rather than an observation: a write restamps
 * `mutatum`, and `mutatum` is the resume pointer, so a history that touched a session
 * because the user looked at it would silently move the door. (A `resume` on a dataset
 * with no session at all spawns one, which creates a session rather than restamping an
 * older one.)
 */
export function entryStampsSession(_entry: SessionEntry): boolean {
  return false;
}

/** The link that opens one named session. */
export function sessionHref(datasetId: string, sessionId: string): string {
  return `/datasets/${encodeURIComponent(datasetId)}/muse?${SESSION_PARAM}=${encodeURIComponent(sessionId)}`;
}

/** The history's own route, off the dataset's muse door. */
export function sessionHistoryHref(datasetId: string): string {
  return `/datasets/${encodeURIComponent(datasetId)}/muse/sessions`;
}

/**
 * What a rebuilt tile shows when its run cannot be read.
 *
 * A recorded piece holds its lineage but not its image, so a rebuild resolves each
 * image from that piece's own run — and a run that no longer resolves is a state, not a
 * crash. The piece keeps its place and its lineage and says the image could not be read;
 * a rebuild that left the tile on `running` would sit on "generating…" forever with
 * nothing watching it.
 *
 * Non-vacuity: leaving an unreadable run untouched must fail "a piece whose run cannot
 * be read still renders, and says the image could not be read".
 */
export function unreadableRun(): RunResult {
  return { terminal: 'failed', error: 'the image for this piece could not be read' };
}

// ── Activity bands (noema-326) ────────────────────────────────────────────────
// Pure helpers over `GET /v1/me/activity` rows (types + fetch live in `./api`) for
// the Activity screen's "running now" / "recently finished" bands and the rail
// badge. This file is the Muse-specific engine's front end elsewhere; these
// functions are unrelated to it — kept here because it's the client's designated
// non-component home for pure display logic (`Status.tsx`/`Rail.tsx` are the UI).

/**
 * Split one activity page into the two bands the Activity screen renders:
 * in-flight rows first (newest first, same order the read returns), then
 * settled rows. Order within each band is preserved from the input.
 *
 * Non-vacuity: a finished row landing in `running` (or vice versa) must fail —
 * every assertion below checks band MEMBERSHIP, not just band length.
 */
export function partitionActivity(rows: ActivityRow[]): { running: ActivityRow[]; finished: ActivityRow[] } {
  const running: ActivityRow[] = [];
  const finished: ActivityRow[] = [];
  for (const row of rows) (row.status === 'running' ? running : finished).push(row);
  return { running, finished };
}

/**
 * The rail's Activity badge count: how many rows are in flight right now.
 *
 * Non-vacuity: a badge that shows with zero in-flight rows must fail — this is
 * tested at zero explicitly, not just at a positive count.
 */
export function activityBadgeCount(rows: ActivityRow[]): number {
  return rows.reduce((n, row) => (row.status === 'running' ? n + 1 : n), 0);
}

// Kind → label copy — the same nouns the app already uses elsewhere (dataset/caption
// job/derive screens); no new vocabulary introduced for the Activity read.
const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  training: 'training',
  caption: 'caption pass',
  decompose: 'decompose',
  generation: 'generation',
};

/** Plain-English label for an activity row's kind. */
export function activityKindLabel(kind: ActivityKind): string {
  return ACTIVITY_KIND_LABEL[kind];
}

/**
 * The link back to what a row produced, or `undefined` when the door doesn't resolve
 * to a real in-app route — a door-less row renders without a link, never a dead one.
 *
 * Only two door shapes have an actual route today: a dataset (training/caption/
 * decompose all door through the source dataset, which is where its captionsets and
 * trained models are found) and a generation's raw media URL. `modelId`/`captionsetId`
 * alone have no standalone page, so they don't produce a link by themselves.
 */
export function activityDoorHref(row: Pick<ActivityRow, 'kind' | 'door'>): string | undefined {
  const door: ActivityDoor | undefined = row.door;
  if (!door) return undefined;
  if (row.kind === 'generation') return door.mediaUrl;
  return door.datasetId ? `/datasets/${encodeURIComponent(door.datasetId)}` : undefined;
}

/** Link text for `activityDoorHref`'s target, per kind. */
export function activityDoorLabel(kind: ActivityKind): string {
  return kind === 'generation' ? 'view media' : 'view dataset';
}
