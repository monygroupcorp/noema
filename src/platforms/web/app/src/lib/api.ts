// Typed client for the Crystal /v1 API. Endpoints proven in the spike research.
// Phase 0: structure + a few live calls; screens still mostly use local mock data
// until each is wired. Dev server proxies /v1 + /api to the backend.

import type { Editio, FeedFilter, FeedItem, PublishRequest } from './editio';

export interface FlowSummary { id: string; nomen?: string; versio?: string; categoria?: unknown }
export interface JsonSchema {
  type: string;
  properties?: Record<string, { type: string; format?: string; default?: unknown; description?: string; title?: string }>;
  required?: string[];
}
export interface FlowDescription { id: string; nomen: string; versio: string; input: JsonSchema; output?: JsonSchema }

export type RunStatus = 'pending' | 'running' | 'complete' | 'failed';
export interface Run {
  id: string;
  status: RunStatus;
  modusId: string;
  exitus?: Record<string, unknown>;
  failure?: { code: string; message: string };
  cost?: string;
  createdAt?: string;
}

export interface RunRequest {
  modusId?: string;
  verb?: string;
  aditus: Record<string, unknown>;
  maxImpetus?: string;
  studioId?: string;
  commitment?: string;
  bursaToken?: string;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
}

// Anonymous self-asserting spend identity (arcanum commitment). Stable per browser session.
// For quotes it just identifies the caller; real spend is validated downstream against a funded note.
export function commitment(): string {
  let c = localStorage.getItem('noema-commitment');
  if (!c) {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    c = '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('noema-commitment', c);
  }
  return c;
}

const anonHeaders = () => ({ 'content-type': 'application/json', 'x-commitment': commitment() });

export const api = {
  listFlows: () => fetch('/v1/flows').then(j<{ flows: FlowSummary[] }>),
  getFlow: (id: string) => fetch(`/v1/flows/${id}`).then(j<FlowDescription>),
  quote: (body: Pick<RunRequest, 'modusId' | 'verb' | 'aditus'>) =>
    fetch('/v1/runs/quote', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ impetus: string; recipient?: string }>),
  createRun: (body: RunRequest) =>
    fetch('/v1/runs', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ run: Run }>),
  getRun: (id: string) => fetch(`/v1/runs/${id}`).then(j<{ run: Run }>),
  // SSE — returns an EventSource the caller subscribes to.
  streamRun: (id: string) => new EventSource(`/v1/runs/${id}/stream`),
  meStatus: () => fetch('/v1/me/status', { headers: { 'x-commitment': commitment() } }).then(j<MeStatus>),

  // ── Publishing (Editio) — feed read + publish/retract write ──────────────────
  // GET /v1/feed — public, NO auth. Newest-first published, public-surface editions.
  feed: (filter: FeedFilter = {}) => {
    const q = new URLSearchParams();
    if (filter.visibility) q.set('visibility', filter.visibility);
    if (filter.destination) q.set('destination', filter.destination);
    if (filter.limit != null) q.set('limit', String(filter.limit));
    const qs = q.toString();
    return fetch(`/v1/feed${qs ? `?${qs}` : ''}`).then(j<{ feed: FeedItem[] }>);
  },
  // POST /v1/editiones — publish an artifact. Public surfaces return a `pending`
  // edition (async moderation) → it goes live once the worker settles it.
  publish: (body: PublishRequest) =>
    fetch('/v1/editiones', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ edition: Editio }>),
  retract: (id: string) =>
    fetch(`/v1/editiones/${id}/retract`, { method: 'POST', headers: anonHeaders() })
      .then(j<{ edition: Editio }>),

  // ── Training (modus.aitoolkit-training) — thin reads; launches go via createRun ──
  // Dataset list/create live under the internal data API (/v1/data/*). Kept thin:
  // the builder launches a training as a normal run, these only feed the picker/cost.
  listDatasets: () => fetch('/v1/data/datasets', { headers: { 'x-commitment': commitment() } })
    .then(j<{ datasets: DatasetSummary[] }>),
  trainingCost: (body: { steps: number; baseModel?: string; images?: number }) =>
    fetch('/v1/data/trainings/calculate-cost', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ impetus?: string; usd?: number }>),
  // Signed upload for dataset images.
  signUpload: (body: { filename: string; contentType: string }) =>
    fetch('/api/v1/storage/uploads/sign', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ url: string; fields?: Record<string, string>; key?: string }>),
};

export interface DatasetSummary { id: string; name: string; images?: number; updatedAt?: string }

export interface MeStatus {
  balanceImpetus: string;
  balanceUsd: number;
  gens: unknown[];
  studios: unknown[];
}
