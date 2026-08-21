// ── Live run observation over SSE (GET /v1/runs/:id/stream) ───────────────────
// Shared by Run.tsx (dedicated run-detail view) and Card.tsx (the dispatch page a
// caller actually watches immediately after starting a run). The server emits
// `data:`-only frames (no event: field) in four shapes: an initial `snapshot`,
// then a stream of `progress` (carrying a Progressus), and a terminal `complete` /
// `failed`. Terminal events carry NO exitus — the run is fetched for its outputs
// on completion, mirroring the backend's own agent relay, and the terminal is
// announced together with those outputs in ONE state update (see `announceTerminal`)
// so a subscriber that stops listening at terminal still receives the media.
import { useEffect, useRef, useState } from 'react';
import { api, type Run as RunT, type SseHandle } from './api';
// The terminal-announcement rule is a pure function and lives with the stream's other
// pure rules in `./muse`, where the hermetic web tests gate it; this module owns the
// React state and the SSE handle it is driven from.
import { announceTerminal, phaseToStage } from './muse';

// The run readout's vocabulary — the coarse stages, the Phasis→stage mapping and the
// active sub-line — is pure and lives in `./muse` alongside the rest of the stream's
// pure rules, for the same reason `announceTerminal` does: that module is React-free,
// so the hermetic web tests can import it and gate what it decides. It is re-exported
// here so every surface that already reads the readout off this module keeps doing so.
export { STAGE_LABELS, phaseToStage, measure } from './muse';
export type { Phasis, Progressus } from './muse';

import type { Progressus } from './muse';

export interface RunEvent {
  kind: 'snapshot' | 'progress' | 'complete' | 'failed';
  terminal?: boolean;
  run?: RunT;
  progressus?: Progressus;
  status?: 'complete' | 'failed';
  costUsd?: number;
  executionMs?: number;
}

export interface RunStreamState {
  stageIdx: number;
  progressus?: Progressus;
  terminal: 'complete' | 'failed' | null;
  exitus: Record<string, unknown> | null;
  error?: string;
  modusId?: string;
  createdAt?: string;
  costUsd?: number;
  executionMs?: number;
  /** Credits charged — only meaningful once `terminal === 'failed'`; '0' on a
   * pre-execution failure (reservation released). */
  charged?: string;
  /** `now − createdAt` in whole seconds; 0 until the initial snapshot arrives. */
  elapsedSec: number;
}

const POLL_MS = 1500;
const POLL_MAX_TICKS = 80; // ~2 minutes of fallback polling before giving up

/**
 * Subscribe to a run's live event stream (SSE), falling back to polling
 * `GET /v1/runs/:id` if the stream errors before reaching a terminal state.
 * Elapsed is derived from the run's server-stamped `createdAt` — never a
 * client-mount clock — so it survives a refresh.
 */
export function useRunStream(id: string | undefined): RunStreamState {
  const [state, setState] = useState<RunStreamState>({ stageIdx: 0, terminal: null, exitus: null, elapsedSec: 0 });
  const createdAtRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    const runId = id;
    let live = true;
    createdAtRef.current = undefined;
    setState({ stageIdx: 0, terminal: null, exitus: null, elapsedSec: 0 });

    function applySnapshot(r: RunT) {
      if (r.createdAt) createdAtRef.current = r.createdAt;
      setState((s) => ({
        ...s,
        modusId: r.modusId,
        createdAt: r.createdAt,
        ...(r.status === 'complete' ? { stageIdx: 5, terminal: 'complete', exitus: r.exitus ?? null } : {}),
        ...(r.status === 'failed' ? { terminal: 'failed', error: r.failure?.message, charged: r.cost ?? '0' } : {}),
      }));
    }

    function startPoll() {
      let ticks = 0;
      const poll = () => {
        if (!live || ticks++ > POLL_MAX_TICKS) return;
        api.getRun(runId).then(({ run: r }) => {
          if (!live) return;
          if (r.status === 'complete' || r.status === 'failed') {
            applySnapshot(r);
            return;
          }
          setTimeout(poll, POLL_MS);
        }).catch(() => { if (live) setTimeout(poll, POLL_MS); });
      };
      poll();
    }

    let usingPoll = false;
    let retriedOnce = false;
    let es: SseHandle;

    function onMessage(e: { data: string }) {
      if (!live) return;
      let msg: RunEvent;
      try { msg = JSON.parse(e.data) as RunEvent; } catch { return; }

      if (msg.kind === 'snapshot') {
        if (msg.run) applySnapshot(msg.run);
        return;
      }
      if (msg.kind === 'progress' && msg.progressus) {
        setState((s) => ({ ...s, progressus: msg.progressus, stageIdx: phaseToStage(msg.progressus!.phase) }));
        return;
      }
      if (msg.kind === 'complete' || msg.kind === 'failed') {
        es.close();
        // A completed run is announced only once its outputs are in hand, so `terminal`
        // and `exitus` land in one update; the frame's own measurements ride along.
        const measured = msg.kind === 'complete'
          ? { stageIdx: 5, costUsd: msg.costUsd, executionMs: msg.executionMs }
          : {};
        void announceTerminal(msg.kind, runId, api.getRun, (patch) => {
          if (live) setState((s) => ({ ...s, ...measured, ...patch }));
        });
        return;
      }
    }

    // Reconnect story at parity with EventSource's implicit browser-level retry:
    // on a stream error before a terminal event, retry the fetch-based reader
    // once after 2s, then fall back to polling `getRun` until terminal.
    function onError() {
      if (!live || usingPoll) return;
      if (!retriedOnce) {
        retriedOnce = true;
        setTimeout(() => {
          if (!live || usingPoll) return;
          es = api.streamRun(runId);
          es.onmessage = onMessage;
          es.onerror = onError;
        }, 2000);
        return;
      }
      usingPoll = true;
      startPoll();
    }

    es = api.streamRun(runId);
    es.onmessage = onMessage;
    es.onerror = onError;

    return () => { live = false; es.close(); };
  }, [id]);

  // Elapsed clock — ticks once a second from the server-stamped createdAt until terminal.
  useEffect(() => {
    if (state.terminal || !state.createdAt) return;
    const createdMs = new Date(state.createdAt).getTime();
    const tick = () => setState((s) => ({ ...s, elapsedSec: Math.max(0, Math.round((Date.now() - createdMs) / 1000)) }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [state.createdAt, state.terminal]);

  return state;
}
