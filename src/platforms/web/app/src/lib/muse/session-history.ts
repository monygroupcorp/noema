// The session history (noema-274): an ordered list of a dataset's own sessions, a readout
// per row, a client-side search, and the entry rule that decides what a visit does when it
// arrives. EVERYTHING HERE IS A READ.

import type { MuseSessionView } from '../api';
import type { RunResult } from './stream';

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
    ? 'No session matches that — search runs over the fragments each piece was drawn from'
    : 'No muse sessions off this dataset yet';
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

