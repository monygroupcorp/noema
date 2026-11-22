// Coming back to a session (noema-263) — rebuilding the stream from a session's own ledger
// on mount. A REBUILD IS A READ: nothing here fires a run or reads a balance.

import { composeTemplate } from '../../../../../../crystal/muse/weaver.js';
import { CATEGORIES } from '../../../../../../crystal/muse/taxonomy.js';
import type { FragmentCategory, MusePiece, MuseSessionView, RunStatus } from '../api';
import { streamPiece, type StreamPiece, type StreamState } from './stream';
import { STREAM_MAX_COLUMNS } from './run-readout';
import type { StreamPhase } from './launch';

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

