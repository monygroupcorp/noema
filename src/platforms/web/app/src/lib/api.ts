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

  // ── Collections (Collectio) — a batch-gen over a Tractus grid ────────────────
  // Owner-scoped by the caller commitment. Create LAUNCHES generation of `total`
  // pieces (real compute) — always a deliberate, confirmed action.
  listCollections: () => fetch('/v1/collectiones', { headers: { 'x-commitment': commitment() } })
    .then(j<{ collections: Collection[] }>),
  getCollection: (id: string) => fetch(`/v1/collectiones/${id}`, { headers: { 'x-commitment': commitment() } })
    .then(j<{ collection: Collection }>),
  createCollection: (body: CreateCollectionRequest) =>
    fetch('/v1/collectiones', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ collection: Collection }>),
  getCollectionRarity: (id: string) => fetch(`/v1/collectiones/${id}/rarity`, { headers: { 'x-commitment': commitment() } })
    .then(j<{ rarity: RarityReport }>),
  listCollectionPieces: (id: string, review: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    fetch(`/v1/collectiones/${id}/pieces?review=${review}`, { headers: { 'x-commitment': commitment() } })
      .then(j<{ pieces: CollectionPiece[] }>),
  approvePiece: (id: string, actumId: string) =>
    fetch(`/v1/collectiones/${id}/pieces/${actumId}/approve`, { method: 'POST', headers: anonHeaders() }).then(j<{ ok: true }>),
  rejectPiece: (id: string, actumId: string) =>
    fetch(`/v1/collectiones/${id}/pieces/${actumId}/reject`, { method: 'POST', headers: anonHeaders() }).then(j<{ ok: true }>),
  pauseCollection: (id: string) => fetch(`/v1/collectiones/${id}/pause`, { method: 'POST', headers: anonHeaders() }).then(j<{ collection: Collection }>),
  resumeCollection: (id: string) => fetch(`/v1/collectiones/${id}/resume`, { method: 'POST', headers: anonHeaders() }).then(j<{ collection: Collection }>),
  cancelCollection: (id: string) => fetch(`/v1/collectiones/${id}/cancel`, { method: 'POST', headers: anonHeaders() }).then(j<{ collection: Collection }>),
  extendCollection: (id: string, count: number) =>
    fetch(`/v1/collectiones/${id}/extend`, { method: 'POST', headers: anonHeaders(), body: JSON.stringify({ count }) }).then(j<{ collection: Collection }>),
  // Draft authoring: replace a draft's trait grid (re-derives provenance), then fire it.
  patchCollectionTractus: (id: string, tractus: Tractus[]) =>
    fetch(`/v1/collectiones/${id}/tractus`, { method: 'PATCH', headers: anonHeaders(), body: JSON.stringify({ tractus }) }).then(j<{ collection: Collection }>),
  fireCollection: (id: string) =>
    fetch(`/v1/collectiones/${id}/fire`, { method: 'POST', headers: anonHeaders() }).then(j<{ collection: Collection }>),

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
  // GET /v1/editiones/:id — poll a publication (author-scoped) to watch an async
  // settle land: an archive ZIP build finishing (`externalRef` = the download url),
  // or a public surface being gated (→ rejected).
  getEdition: (id: string) => fetch(`/v1/editiones/${id}`, { headers: { 'x-commitment': commitment() } })
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
  // Signed upload (R2). Returns a presigned PUT url + the permanent public url.
  signUpload: (body: { filename: string; contentType: string; bucketName?: string }) =>
    fetch('/api/v1/storage/uploads/sign', { method: 'POST', headers: anonHeaders(), body: JSON.stringify(body) })
      .then(j<{ signedUrl: string; permanentUrl: string; key?: string }>),

  // ── Account settings (Consuetudinum, owner-keyed / anon-capable) ─────────────
  // GET /v1/me — appearance (Profile) + generation defaults (Preferences) + bindings.
  getMe: () => fetch('/v1/me', { headers: { 'x-commitment': commitment() } }).then(j<MeView>),
  setAppearance: (appearance: Appearance) =>
    fetch('/v1/me/appearance', { method: 'PUT', headers: anonHeaders(), body: JSON.stringify(appearance) }).then(j<{ appearance: Appearance }>),
  setGeneratio: (generatio: Generatio) =>
    fetch('/v1/me/generatio', { method: 'PUT', headers: anonHeaders(), body: JSON.stringify(generatio) }).then(j<{ generatio: Generatio }>),
  getAffines: (modusId: string) =>
    fetch(`/v1/me/affines/${encodeURIComponent(modusId)}`, { headers: { 'x-commitment': commitment() } }).then(j<{ affines: Record<string, unknown> }>),
  setAffines: (modusId: string, affines: Record<string, unknown>) =>
    fetch(`/v1/me/affines/${encodeURIComponent(modusId)}`, { method: 'PUT', headers: anonHeaders(), body: JSON.stringify({ affines }) }).then(j<{ affines: Record<string, unknown> }>),
};

// Account settings (mirror the backend Consuetudo shapes).
export interface Appearance { avatarUrl?: string; bannerUrl?: string; backgroundUrl?: string; accent?: string; look?: string }
export interface Generatio {
  style?: string;
  negativePrompt?: string;
  outputFormat?: string;
  telegramDeliverAs?: 'album' | 'individual';
  autoApplyModels?: string[];
}
export interface MeView {
  appearance?: Appearance;
  generatio?: Generatio;
  bindings: Array<{ verb: string; modusId: string }>;
}

export interface DatasetSummary { id: string; name: string; images?: number; updatedAt?: string }

// Collection (Collectio) projection — mirrors the backend CollectionSchema.
export type CollectionStatus = 'draft' | 'pending' | 'running' | 'complete' | 'cancelled';
export interface Collection {
  id: string;
  nomen?: string;
  status: CollectionStatus;
  modusId: string;
  total: number;
  provenanceHash: string;
  owners?: Array<{ animaId: string; weight: number }>;
  tractus?: Tractus[];
  reviewEnabled?: boolean;
  completed: number;
  failed: number;
  rejected: number;
  cost?: string;
  createdAt?: string;
  completedAt?: string;
}
// One option within a trait axis; `value` is injected into the flow's aditus port.
// `excludes` blocks named labels in OTHER axes; `tags` group options for motif-level exclusion.
export interface TractusValor { value: string; label?: string; rarity?: number; promptFragment?: string; excludes?: string[]; tags?: string[] }
// One axis of variation — the aditus port to vary and its options.
export interface Tractus { porta: string; label?: string; valores: TractusValor[] }
export interface CreateCollectionRequest {
  modusId: string;
  total: number;
  tractus: Tractus[];
  nomen?: string;
  aditusBase?: Record<string, unknown>;
  reviewEnabled?: boolean;
  draft?: boolean;
}
// Realized-vs-target rarity report (GET /v1/collectiones/:id/rarity).
export interface RarityValor { value: string; targetRarity: number; realizedCount: number; realizedRarity: number }
export interface RarityAxis { trait_type: string; valores: RarityValor[] }
export interface RarityReport { totalPieces: number; axes: RarityAxis[] }
// One piece in the curation queue (GET /v1/collectiones/:id/pieces).
export interface CollectionPiece {
  actumId: string;
  review: 'pending' | 'approved' | 'rejected' | 'none';
  output?: Record<string, unknown>;
  attributes?: Array<{ trait_type: string; value: string }>;
}

// The account snapshot (GET /v1/me/status) — mirrors the backend StatusView.
// gens = ACTIVE gens (queued + running), not all-time history.
export interface GenEntry {
  actumId: string;
  modusLabel: string;
  studio: { id: string; hostLabel: string; isOwn: boolean } | null;
  status: 'nascens' | 'agens';
  elapsedMs?: number;
  etaMs?: number;
}
export interface StudioEntry {
  studioId: string;
  materiaId: string;
  label: string;
  status: 'idle' | 'running' | 'provisioning' | 'terminated' | 'draining';
  warmRemainingMs?: number;
  guestsToday: number;
  netImpetus: string; // bigint stringified by the backend
  netUsd: number;
}
export interface JoinableEntry { studioId: string; label: string; hostLabel: string; queueDepth: number }
export interface MeStatus {
  balanceImpetus: string;
  balanceUsd: number;
  gens: GenEntry[];
  studios: StudioEntry[];
  joinable: JoinableEntry[];
  takenAt: string;
}
