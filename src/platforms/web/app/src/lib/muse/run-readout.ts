// The live run readout (noema-273) — the vocabulary a run's progress is rendered through.
// Pure: no React, no transport. `../runStream` re-exports all of it, so a surface reading
// the readout off the stream module is unchanged.

import type { StreamPiece } from './stream';

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

/** Where a run waiting for a warm pod stands: 1-based place, and the depth of its line. */
export interface QueuePlace { place: number; depth: number }

/**
 * Does this run still hold a place in the warm-pod line, and where?
 *
 * The place arrives two ways and this reconciles them. The stream's opening snapshot
 * carries it as a field, which is how a watcher joining late — a reload, a second tab —
 * learns the run is waiting at all. After that the line reports itself on the ordinary
 * progress rail: a `queued` frame whose measurement is `place` of `depth`, re-sent to
 * everyone still waiting each time the line moves. The frame is the fresher of the two,
 * so it wins.
 *
 * What CLEARS the place is the run moving on: a frame reporting any phase but `queued`
 * means a pod took it, and a terminal means it is over. Both matter more than they look,
 * because this is what gates the offer to stop waiting — a run already generating on a
 * pod must not be shown a button that says it is still in a line.
 */
export function queuePlace(
  known: QueuePlace | undefined,
  latest: Progressus | undefined,
  terminal: 'complete' | 'failed' | null,
): QueuePlace | undefined {
  if (terminal) return undefined;
  if (latest && latest.phase !== 'queued') return undefined;
  const p = latest?.progress;
  if (p && p.total !== undefined) return { place: p.done, depth: p.total };
  return known;
}

/**
 * How a place in the line reads on screen. Deliberately the same sentence `/status` says
 * in chat, so a user watching one run on two surfaces is not told two different things.
 */
export function queueLabel(at: QueuePlace): string {
  return `Waiting for a warm pod — ${at.place} of ${at.depth} in line`;
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

export function trim(line: string, max: number): string {
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
