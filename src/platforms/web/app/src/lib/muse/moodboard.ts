// Adding images to the moodboard (noema-260) and the caption run riding the URL (noema-321).
// Pure helpers over what the two metered actions — append, caption — cost and refuse.

import { liveRecords, type Archivable } from './garden';
import type { AddDatasetMediaRequest } from '../api';

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

