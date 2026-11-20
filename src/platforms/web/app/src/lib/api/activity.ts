import { j } from './core';
import { readHeaders } from './session';

// A settled run in spend history (GET /v1/me/runs) — mirrors the backend SettledRun.
export interface SettledRun {
  id: string;
  modusId: string;
  modusLabel: string;
  status: 'settled';
  cost: string;       // impetus, stringified
  costUsd: number;    // derived on read
  settledAt?: string;
  createdAt?: string;
}
// A page of settled runs + lifetime running total (GET /v1/me/runs).
export interface RunsPage {
  runs: SettledRun[];
  nextCursor?: string;
  runningTotal: { impetus: string; usd: number };
}

// ActivityKind/Status/Door/Row/Page mirror the backend's activity read (allocutio/api/types.ts)
// as local literal types/interfaces — the web app doesn't import backend source, same convention
// as `CanonVerb` above. What a run produced (`generation` is the catch-all).
export type ActivityKind = 'training' | 'caption' | 'decompose' | 'generation';
// In-flight, or settled successfully.
export type ActivityStatus = 'running' | 'settled' | 'released';
// The way back to what a run produced: id references into the canonical asset stores. Every
// field is optional — a field the run did not produce is absent rather than guessed.
export interface ActivityDoor {
  modelId?: string;
  datasetId?: string;
  captionsetId?: string;
  mediaUrl?: string;
}
// One run in the owner's activity read (GET /v1/me/activity).
export interface ActivityRow {
  actumId: string;
  kind: ActivityKind;
  modusId: string;
  modusLabel?: string;
  status: ActivityStatus;
  createdAt?: string;
  settledAt?: string;
  /** When the run released (failed/cancelled — nothing charged). Present only when status is 'released'. */
  releasedAt?: string;
  door?: ActivityDoor;
  /** Where an in-flight run waiting for a warm pod stands in line; absent once it dispatches. */
  queue?: { place: number; depth: number };
}
// A page of the owner's activity — in-flight, settled, and released runs, newest first.
// In-flight and released rows ride the first page only; `nextCursor` walks settled history.
export interface ActivityPage {
  activity: ActivityRow[];
  nextCursor?: string;
}

const activityApi = {
  // GET /v1/me/runs — the caller's settled spend history (owner-scoped, paginated, newest
  // first) + lifetime running total. Anon-capable (commitment-keyed). costUsd is derived.
  listRuns: (opts: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams({ status: 'settled' });
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit) q.set('limit', String(opts.limit));
    return fetch(`/v1/me/runs?${q.toString()}`, { headers: readHeaders() }).then(j<RunsPage>);
  },
  // GET /v1/me/activity — the caller's in-flight + settled runs in one newest-first
  // projection, each row carrying its kind and a door to the artifact it produced.
  // Owner-scoped (identified or anon-commitment), cursor-paginated like listRuns.
  activity: (opts: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return fetch(`/v1/me/activity${qs ? `?${qs}` : ''}`, { headers: readHeaders() }).then(j<ActivityPage>);
  },

  // GET /v1/me/activity — the caller's ACTIVITY: in-flight runs and settled runs in one read,
  // newest first (noema-325). In-flight rows ride the first page only.
  listActivity: (opts: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return fetch(`/v1/me/activity${qs ? `?${qs}` : ''}`, { headers: readHeaders() }).then(j<ActivityPage>);
  },
};

export default activityApi;

// ── Shared activity poll (noema-326) ──────────────────────────────────────────
// Rail's badge and Status's running/finished bands read ONE poll, not two: a plain
// module-level store (subscribe + cached snapshot), the same shape as `pins.ts`'s
// usePins store (localStorage there, a fetch + interval here) MINUS the React hook
// itself — this file stays framework-free like the rest of its exports (it is
// imported for its types by the hermetic test tree, which cannot resolve 'react');
// callers wrap these two functions in their own `useSyncExternalStore`. This is the
// app's ONE recurring poll — deliberately slow (60s-class) and paused while hidden.
const ACTIVITY_POLL_MS = 60_000;
let activitySnapshot: { rows: ActivityRow[]; loaded: boolean } = { rows: [], loaded: false };
let activityListeners = new Set<() => void>();
let activityTimer: ReturnType<typeof setInterval> | null = null;

function setActivitySnapshot(rows: ActivityRow[]) {
  activitySnapshot = { rows, loaded: true };
  activityListeners.forEach((fn) => fn());
}

function fetchActivityOnce() {
  activityApi.activity({ limit: 20 })
    .then((p) => setActivitySnapshot(p.activity))
    .catch(() => { /* keep last-known rows; the next tick tries again */ });
}

function ensureActivityPolling() {
  if (activityTimer) return;
  fetchActivityOnce();
  activityTimer = setInterval(() => {
    if (document.visibilityState === 'visible') fetchActivityOnce();
  }, ACTIVITY_POLL_MS);
}

/** Subscribe to the shared activity store — for `useSyncExternalStore`'s first arg. */
export function subscribeActivity(fn: () => void): () => void {
  activityListeners.add(fn);
  ensureActivityPolling();
  return () => {
    activityListeners.delete(fn);
    if (activityListeners.size === 0 && activityTimer) {
      clearInterval(activityTimer);
      activityTimer = null;
    }
  };
}

/** The shared activity store's current snapshot — for `useSyncExternalStore`'s 2nd/3rd arg.
 *  `loaded` distinguishes "not fetched yet" from "fetched, zero rows" so a caller doesn't
 *  flash an empty state before the first response lands. */
export function getActivitySnapshot(): { rows: ActivityRow[]; loaded: boolean } {
  return activitySnapshot;
}
