import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { type MuseReaction } from '../../lib/api';
import { useRunStream } from '../../lib/runStream';
import { Stageline } from '../../components/RunStageline';
import {
  categoryColor,
  gestureBlock,
  gestureBlockLine,
  gestureTitle,
  lineageOf,
  pieceReadout,
  pieceStageline,
  EXPANDED_GESTURES,
  TILE_GESTURES,
  type GestureGate,
  type PieceProgress,
  type RunResult,
  type StreamPiece,
} from '../../lib/muse';

/** Headless: one piece's subscription to its own run. Reports terminal upward once,
 *  where `applyRunResult` folds the produced media into the piece. Split out so a held
 *  piece — one that has no tile on screen yet — is still watched.
 *  The subscription ends at terminal (a watcher per finished piece would be an open
 *  stream per finished piece), so the terminal it reports has to carry the run's
 *  outputs already — see `announceTerminal` in lib/runStream.ts. */
export function RunWatcher({ runId, onResult, onProgress }: {
  runId: string;
  onResult: (runId: string, r: RunResult) => void;
  onProgress: (runId: string, live: PieceProgress) => void;
}) {
  const { stageIdx, progressus, terminal, exitus, error } = useRunStream(runId);
  // Every frame this subscription already receives is reported upward, so the piece's
  // tile can say what the pod is doing. Reporting stops at terminal — the run's last
  // word is its result, not a phase.
  useEffect(() => {
    if (terminal) return;
    onProgress(runId, { stageIdx, progressus });
  }, [runId, stageIdx, progressus, terminal, onProgress]);
  useEffect(() => {
    if (!terminal) return;
    onResult(runId, { terminal, exitus, error });
  }, [runId, terminal, exitus, error, onResult]);
  return null;
}

/** What every rail — the tile's and the expanded view's — does with one gesture: the two
 *  steers and 😂 are reactions on the piece, ✕ is a dismissal, and ↓ puts the piece back
 *  into the set. Save is offered only where its rail carries it — the expanded view — so
 *  the tile passes no handler and the gesture reads as unavailable rather than silent.
 *
 *  Every button carries a `title`, and a refused one carries the REASON it is refused
 *  (`gestureBlock` -> `gestureTitle`) rather than its own label. The gating is unchanged:
 *  `disabled` is true in exactly the cases it was true in before — a refusal gains words
 *  here, it is never relaxed. */
function railProps(
  key: string,
  runId: string,
  gate: GestureGate,
  label: string,
  reaction: MuseReaction | undefined,
  onReact: (runId: string, reaction: MuseReaction) => void,
  onDismiss: (runId: string) => void,
  saved = false,
  onSave?: (runId: string) => void,
): { disabled: boolean; className: string; onClick?: () => void; title: string } {
  const REACTIONS: Record<string, MuseReaction> = { up: 'up', down: 'down', laugh: 'note' };
  const asReaction = REACTIONS[key];
  const block = gestureBlock(gate);
  if (asReaction) {
    return {
      disabled: !!block,
      className: `muse-gesture${reaction === asReaction ? ' on' : ''}`,
      onClick: () => onReact(runId, asReaction),
      title: gestureTitle(block, label),
    };
  }
  if (key === 'dismiss') {
    return {
      disabled: !!block,
      className: 'muse-gesture',
      onClick: () => onDismiss(runId),
      title: gestureTitle(block, label),
    };
  }
  if (!onSave) {
    return {
      disabled: true,
      className: 'muse-gesture',
      title: gestureTitle(gestureBlock({ ...gate, offered: false }), label),
    };
  }
  // A piece already in the set is shown as saved and is not offered again: the dataset is
  // append-only, so a second save would put the same media in twice.
  const saveBlock = gestureBlock({ ...gate, saved });
  return {
    disabled: !!saveBlock,
    className: `muse-gesture${saved ? ' on' : ''}`,
    onClick: () => onSave(runId),
    title: gestureTitle(saveBlock, label),
  };
}

/** One tile in the stream. Roughly 145px on a phone, which fits three targets legibly —
 *  the two steers and declutter (V8a). They write to the session; a piece the session
 *  ledger does not hold cannot be reacted to, and its rail is disabled with the reason on
 *  the control rather than left unexplained. The tile has no room for a sentence, so the
 *  reason rides the `title` here and is rendered in full in the expanded view.
 *  The rest of the rail lives in the expanded view. */
export function PieceTile({
  piece, progress, onExpand, onResult, onProgress, reaction, gate, onReact, onDismiss,
}: {
  piece: StreamPiece;
  progress: PieceProgress | undefined;
  onExpand: (runId: string) => void;
  onResult: (runId: string, r: RunResult) => void;
  onProgress: (runId: string, live: PieceProgress) => void;
  reaction: MuseReaction | undefined;
  gate: GestureGate;
  onReact: (runId: string, reaction: MuseReaction) => void;
  onDismiss: (runId: string) => void;
}) {
  return (
    <div className={`muse-tile ${piece.status}`}>
      {piece.status === 'running' && <RunWatcher runId={piece.runId} onResult={onResult} onProgress={onProgress} />}
      <button
        type="button"
        className="muse-tile-shot"
        onClick={() => onExpand(piece.runId)}
        title={piece.prompt}
      >
        {piece.media ? (
          piece.media.kind === 'video'
            ? <video className="muse-tile-media" src={piece.media.url} muted loop playsInline />
            : <img className="muse-tile-media" src={piece.media.url} alt="" loading="lazy" />
        ) : (
          <span className="muse-tile-wait mono">{pieceReadout(piece, progress)}</span>
        )}
      </button>
      <div className="muse-tile-rail">
        {TILE_GESTURES.map((g) => {
          const rail = railProps(g.key, piece.runId, gate, g.label, reaction, onReact, onDismiss);
          return (
            <button key={g.key} type="button" {...rail} aria-label={rail.title}>
              {g.glyph}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The expanded piece: the full action rail and the lineage — the fragments that
 *  produced it (V8). 😂 lives here rather than on the tile: it is recorded and it steers
 *  nothing (S4/V9), so it is not one of the three gestures made at speed. */
export function ExpandedPiece({
  piece, progress, onClose, reaction, gate, onReact, onDismiss, saved, onSave,
}: {
  piece: StreamPiece;
  progress: PieceProgress | undefined;
  onClose: () => void;
  reaction: MuseReaction | undefined;
  gate: GestureGate;
  onReact: (runId: string, reaction: MuseReaction) => void;
  onDismiss: (runId: string) => void;
  saved: boolean;
  onSave: (runId: string) => void;
}) {
  const pieceBlock = gestureBlock(gate);
  return (
    <div className="muse-expanded" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-expanded-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-expanded-shot">
          {piece.media ? (
            piece.media.kind === 'video'
              ? <video src={piece.media.url} controls playsInline />
              : <img src={piece.media.url} alt="" />
          ) : (
            /* The expanded piece has room for the real thing: the same five-stage readout
               every other watching surface draws, fed from the subscription this piece's
               tile already holds — expanding a piece opens no second stream. */
            <div>
              <Stageline stream={pieceStageline(piece, progress)} />
              {piece.status === 'failed' && (
                <span className="muse-tile-wait mono">{pieceReadout(piece, progress)}</span>
              )}
            </div>
          )}
        </div>

        <div className="muse-expanded-rail">
          {EXPANDED_GESTURES.map((g) => {
            const rail = railProps(g.key, piece.runId, gate, g.label, reaction, onReact, onDismiss, saved, onSave);
            return (
              <button key={g.key} type="button" {...rail} aria-label={rail.title}>
                {g.glyph}
              </button>
            );
          })}
          <button type="button" className="btn ghost sm muse-expanded-close" onClick={onClose}>Close</button>
        </div>

        {/* The expanded view has the room the tile does not, so the reason a rail is
            refused is a sentence here rather than only a tooltip. It is the PIECE's
            state — the one every gesture on this rail shares — so it is read from the
            gate without the per-gesture `saved`, which the save button carries itself. */}
        {pieceBlock && (
          <div className="muse-gesture-reason mono" role="status">{gestureBlockLine(pieceBlock)}</div>
        )}

        <div className="muse-expanded-prompt mono">{piece.prompt}</div>

        <div className="gc-l">lineage</div>
        <div className="muse-roll-frags mono">
          {lineageOf(piece).map((f, i) => (
            <span key={i} className="muse-roll-frag" style={{ borderColor: categoryColor(f.category) }}>
              [{f.category}] {f.text}{f.trigger ? ` <- ${f.trigger}` : ''}
            </span>
          ))}
        </div>

        <div className="muse-expanded-foot">
          <Link className="mono" to={`/run?id=${piece.runId}`}>open run view →</Link>
        </div>
      </div>
    </div>
  );
}
