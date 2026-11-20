import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  applyRunResult,
  settlePieceResult,
  type PieceProgress,
  type RunResult,
  type StreamState,
} from '../../lib/muse';

/** What each running piece is reporting, and the waiters the stream loop parks on until
 *  a piece settles. `setStream` is the screen's own state setter, which React keeps
 *  stable for the life of the component. */
export function usePieceSettlement(setStream: Dispatch<SetStateAction<StreamState>>) {
  // A piece's run reaching terminal is also what releases the stream loop: the next
  // piece is requested on SETTLEMENT, never on a timer, so the loop parks on a promise
  // that this resolves. One waiter per run, removed as it is resolved. The result is
  // folded into the piece before the loop is released — `settlePieceResult` owns that
  // ordering, and it is gated in tests/unit/web/muse.test.ts.
  const settlers = useRef(new Map<string, (r: RunResult) => void>());

  // What each running piece's own subscription is currently reporting (noema-273). The
  // pod is already streaming its phases into this browser; this is where the tile and
  // the expanded view read them from, so twelve pieces in flight are twelve pieces
  // saying what they are doing — off ONE subscription each, the one the watcher for
  // that piece already holds.
  const [progress, setProgress] = useState<Record<string, PieceProgress>>({});
  const onPieceProgress = useCallback((runId: string, live: PieceProgress) => {
    setProgress((m) => {
      const held = m[runId];
      if (held && held.stageIdx === live.stageIdx && held.progressus === live.progressus) return m;
      return { ...m, [runId]: live };
    });
  }, []);

  const onPieceResult = useCallback((runId: string, result: RunResult) => {
    const waiting = settlers.current.get(runId);
    if (waiting) settlers.current.delete(runId);
    // The run is over: its last frame is not a state anyone should still be shown, and
    // holding it would grow one entry per finished piece for the life of the session.
    setProgress((m) => {
      if (!(runId in m)) return m;
      const next = { ...m };
      delete next[runId];
      return next;
    });
    settlePieceResult(
      runId,
      result,
      (id, r) => setStream((s) => applyRunResult(s, id, r)),
      waiting,
    );
  }, []);

  return { settlers, progress, onPieceProgress, onPieceResult };
}
