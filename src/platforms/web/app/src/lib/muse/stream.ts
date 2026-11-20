// The stream (noema-238) — where a fired piece lands, and how a run's terminal is folded
// back into it. Thin composition over `src/crystal/muse`; no logic is reimplemented here
// (see the note at the top of `../muse.ts`).

import { mediaFromOutput, type Media } from '../media';
import type { Fragment } from '../api';

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

