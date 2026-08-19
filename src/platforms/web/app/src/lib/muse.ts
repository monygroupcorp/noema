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
import { CATEGORIES, type Category, type Garden } from '../../../../../crystal/muse/taxonomy.js';
import { mediaFromOutput, type Media } from './media';
import type {
  Fragment,
  FragmentCategory,
  DatasetMediaItem,
  FlowSummary,
  FlowDescription,
  RunRequest,
} from './api';

export { buildGarden, gardenCounts, rollReport, formatRoll, CATEGORIES };
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

/** An ignition's state on one roll: what was quoted, and for which prompt text. */
export type IgnitionQuote = { modusId: string; prompt: string; impetus: string };

/**
 * Whether the fire button may be armed. The cost is shown first and firing is the second
 * action, so a run is never created from a screen with no number on it: there must be a
 * quote, and it must be a quote for exactly the flow and the prompt text now on screen.
 * The prompt is editable (noema-229), so a quote goes stale the moment it is edited —
 * an armed button after an edit would charge for one prompt and generate another.
 * Non-vacuity: dropping the quote requirement must fail "the cost is shown before the
 * run is created".
 */
export function canFire(
  quote: IgnitionQuote | null,
  modusId: string | null,
  prompt: string,
  blockReason: string | null,
): boolean {
  if (!modusId || blockReason) return false;
  if (prompt.trim() === '') return false;
  if (!quote) return false;
  return quote.modusId === modusId && quote.prompt === prompt;
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

/** The three gestures a tile carries (V8a): the two steers plus declutter. They are
 *  rendered inert here — a reaction writes to the session, which is a later rung —
 *  and inert is shown as disabled rather than as a control that silently does nothing. */
export const TILE_GESTURES: ReadonlyArray<{ key: string; glyph: string; label: string }> = [
  { key: 'up', glyph: '♡', label: 'more like this' },
  { key: 'down', glyph: '\u{1F622}', label: 'less like this' },
  { key: 'dismiss', glyph: '✕', label: 'dismiss' },
];

/** The rail the expanded view carries: the tile's three, plus the gestures that are
 *  considered rather than made at speed (V8a). Inert for the same reason. */
export const EXPANDED_GESTURES: ReadonlyArray<{ key: string; glyph: string; label: string }> = [
  ...TILE_GESTURES,
  { key: 'laugh', glyph: '\u{1F602}', label: 'noted — steers nothing' },
  { key: 'save', glyph: '↓', label: 'save this piece' },
];
