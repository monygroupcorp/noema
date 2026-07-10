// ── Live run observation over SSE (GET /v1/runs/:id/stream) ───────────────────
// Shared by Run.tsx (dedicated run-detail view) and Card.tsx (the dispatch page a
// caller actually watches immediately after starting a run). The server emits
// `data:`-only frames (no event: field) in four shapes: an initial `snapshot`,
// then a stream of `progress` (carrying a Progressus), and a terminal `complete` /
// `failed`. Terminal events carry NO exitus — we fetch the run for its outputs
// on completion, mirroring the backend's own agent relay.
import { useEffect, useRef, useState } from 'react';
import { api, type Run as RunT } from './api';

export type Phasis =
  | 'queued' | 'provisioning' | 'pulling' | 'attesting' | 'downloading'
  | 'installing' | 'loading' | 'warming' | 'executing' | 'uploading'
  | 'finalizing' | 'cancelling' | 'done' | 'failed';

export interface Progressus {
  phase: Phasis;
  target?: string;
  message?: string;
  progress?: { done: number; total?: number; unit: string };
  etaMs?: number;
}

export interface RunEvent {
  kind: 'snapshot' | 'progress' | 'complete' | 'failed';
  terminal?: boolean;
  run?: RunT;
  progressus?: Progressus;
  status?: 'complete' | 'failed';
  costUsd?: number;
  executionMs?: number;
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
    const es = api.streamRun(runId);

    es.onmessage = (e) => {
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
      if (msg.kind === 'complete') {
        setState((s) => ({ ...s, stageIdx: 5, terminal: 'complete', costUsd: msg.costUsd, executionMs: msg.executionMs }));
        api.getRun(runId).then(({ run: r }) => { if (live) setState((s) => ({ ...s, exitus: r.exitus ?? null })); }).catch(() => {});
        es.close();
        return;
      }
      if (msg.kind === 'failed') {
        setState((s) => ({ ...s, terminal: 'failed' }));
        api.getRun(runId).then(({ run: r }) => {
          if (live) setState((s) => ({ ...s, error: r.failure?.message, charged: r.cost ?? '0' }));
        }).catch(() => {});
        es.close();
        return;
      }
    };
    es.onerror = () => {
      if (!live || usingPoll) return;
      // The browser retries transient drops itself; if it can't recover the
      // connection stays in a failed readyState — fall back to polling so a
      // watched run never just goes silent.
      if (es.readyState === EventSource.CLOSED) {
        usingPoll = true;
        es.close();
        startPoll();
      }
    };

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
