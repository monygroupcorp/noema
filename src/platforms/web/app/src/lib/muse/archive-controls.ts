// The archive controls (noema-267): ask once, then do it, then offer it back.

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

