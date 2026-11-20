// Garden/fragment pooling and rolling — the dataset-wide garden, curation, and the pure
// draw engine over it. Thin composition over `src/crystal/muse`; no logic is reimplemented
// here (see the note at the top of `../muse.ts`).

import { CATEGORIES, type Garden } from '../../../../../../crystal/muse/taxonomy.js';
import { rollReport, type RollReport } from '../../../../../../crystal/muse/roll.js';
import { rollFragments } from '../../../../../../crystal/muse/sampler.js';
import { composeTemplate, detectConflicts } from '../../../../../../crystal/muse/weaver.js';
import type { Fragment, FragmentCategory, DatasetMediaItem } from '../api';

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
export function regroup(fragments: readonly Fragment[]): Garden {
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
