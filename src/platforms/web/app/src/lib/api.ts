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

// A vestigium (trace) — the indexed record of a completed generation. Mirrors the
// backend's Vestigium shape (src/types/vestigium.ts), web-relevant fields only.
export interface VestigiumImpressio { auctorImpressio?: 'amor' | 'risus' | 'maeror'; amor: number; risus: number; maeror: number }
export interface Vestigium {
  id: string;
  promptum: string;
  imagoUrl?: string;
  intellaIds?: string[];
  natum: string;
  genus: string;
  impressio?: VestigiumImpressio;
}

// GET /api/vestigia/projection response — feeds Space.tsx's real-data mode.
export interface VestigiaProjectionPoint { id: string; p: [number, number, number]; cluster: number }
export interface VestigiaProjectionCluster { label: string; color: string; count: number }
export interface VestigiaProjection {
  points: VestigiaProjectionPoint[];
  clusters: VestigiaProjectionCluster[];
  n: number;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
}

// Thrown when the BYO-secret store isn't configured server-side (SECRETA_MASTER_KEY unset).
// The backend answers the connect/disconnect endpoints with an "not available on this
// deployment" internal error; the UI treats this as "unavailable", not a real failure.
export class SecretsUnavailableError extends Error {}
async function jSecret(res: Response): Promise<SecretView> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (/not available on this deployment/i.test(text)) throw new SecretsUnavailableError('BYO secrets are unavailable here');
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<SecretView>;
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

// ── Active Arcanum purse — the anonymous bearer token runs spend from ────────
// A Vault-minted purse the user has chosen to pay with. Distinct from every other
// identity path: when set, createRun() sends it as `x-bursa-token`. Single active
// pointer (localStorage `noema-active-purse`); Vault's "use this purse" sets it, and
// the Card run surface shows a "paying with purse …" indicator + a clear affordance.
const ACTIVE_PURSE_KEY = 'noema-active-purse';
export function setActivePurse(token: string | null): void {
  if (token) localStorage.setItem(ACTIVE_PURSE_KEY, token);
  else localStorage.removeItem(ACTIVE_PURSE_KEY);
}
export function getActivePurse(): string | null {
  return localStorage.getItem(ACTIVE_PURSE_KEY);
}

// ── Multi-session store (JWT) — layered OVER the anon commitment ─────────────
// The Twitter model: one browser holds several named logins at once, keyed by
// animaId, with a single ACTIVE pointer. When an account is active its token is
// sent as `Authorization: Bearer <token>` and the backend resolves it to that
// animaId, so every /v1 call is identified with no other change. No active
// account (all signed out) → the anon commitment path. There is NO new backend:
// each account is already an independent soul; this is purely a client store.
//
// The API layer only ever reads the ACTIVE token via getSession(), so authHeaders
// / readHeaders are unchanged — the multi-account machinery lives above them.
// expiresAt = absolute ms epoch (issued-at + expiresIn), so a later switch can tell
// "instant if unexpired" from "refresh-then-activate" without tracking issued-at separately.
export interface StoredAccount { animaId: string; token: string; username?: string; expiresAt?: number }
export interface SessionStore { accounts: StoredAccount[]; activeAnimaId: string | null }

const STORE_KEY = 'noema-sessions';
// Pre-multi-account single-token keys (state/session.tsx before this change).
const LEGACY_TOKEN_KEY = 'noema-session';
const LEGACY_NAME_KEY = 'noema-session-username';

// A transient token used while a session isn't yet in the store: during legacy
// migration (no animaId known until refresh) and during switch-with-refresh (the
// target's stale token must sign its own refresh call). Cleared once adopted.
let pendingToken: string | null = null;
export function setPendingToken(token: string | null) { pendingToken = token; }

function readStore(): SessionStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<SessionStore>;
      if (v && Array.isArray(v.accounts)) return { accounts: v.accounts, activeAnimaId: v.activeAnimaId ?? null };
    }
  } catch { /* fall through to empty */ }
  return { accounts: [], activeAnimaId: null };
}
function writeStore(s: SessionStore) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }

export function getAccounts(): SessionStore { return readStore(); }

// The active account's token — what every /v1 call carries. pendingToken covers
// the brief window before a fresh/switched session lands in the store.
export function getSession(): string | null {
  const s = readStore();
  const active = s.accounts.find((a) => a.animaId === s.activeAnimaId);
  return active?.token ?? pendingToken;
}

// Upsert an account by animaId and make it active (register / login / refresh / switch-refresh).
export function upsertAccount(acc: StoredAccount): SessionStore {
  const s = readStore();
  const rest = s.accounts.filter((a) => a.animaId !== acc.animaId);
  const next: SessionStore = { accounts: [...rest, acc], activeAnimaId: acc.animaId };
  writeStore(next);
  pendingToken = null;
  return next;
}

// Point at an already-stored account (instant switch; token assumed live).
export function setActiveAnimaId(animaId: string | null): SessionStore {
  const s = readStore();
  const next: SessionStore = { ...s, activeAnimaId: s.accounts.some((a) => a.animaId === animaId) ? animaId : null };
  writeStore(next);
  return next;
}

// Drop the active account; activate the next remaining (or null → anon). Returns the new store.
export function dropActiveAccount(): SessionStore {
  const s = readStore();
  const rest = s.accounts.filter((a) => a.animaId !== s.activeAnimaId);
  const next: SessionStore = { accounts: rest, activeAnimaId: rest[rest.length - 1]?.animaId ?? null };
  writeStore(next);
  return next;
}

// Sign out of every account → the anon commitment path.
export function clearAllAccounts(): SessionStore {
  const empty: SessionStore = { accounts: [], activeAnimaId: null };
  writeStore(empty);
  return empty;
}

// One-time migration of the pre-multi-account single token. If the new store is
// empty but a legacy token exists, hand it back (animaId unknown until refresh)
// and clear the legacy keys so this runs exactly once. The provider refreshes it
// into a real account. Returns null when there's nothing to migrate.
export function takeLegacySession(): { token: string; username?: string } | null {
  const store = readStore();
  if (store.accounts.length) return null;
  const token = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!token) return null;
  const username = localStorage.getItem(LEGACY_NAME_KEY) ?? undefined;
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.removeItem(LEGACY_NAME_KEY);
  return { token, username };
}

// Write headers (POST/PUT/PATCH): content-type + bearer if signed in, else the anon commitment.
const authHeaders = (): Record<string, string> => {
  const s = getSession();
  return { 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s}` } : { 'x-commitment': commitment() }) };
};
// Read headers (GET): bearer if signed in, else the anon commitment (no content-type).
const readHeaders = (): Record<string, string> =>
  getSession() ? { authorization: `Bearer ${getSession()}` } : { 'x-commitment': commitment() };

// ── Fetch-based SSE reader ─────────────────────────────────────────────────
// EventSource can't send auth headers, so authed SSE routes need a hand-rolled
// reader over `fetch` + a `ReadableStream`. Surfaces the minimal shape callers
// (useRunStream) need: a message callback and a way to close. The server emits
// plain `data: <json>\n\n` frames (no `event:` field) — see RunEventHub.
export interface SseHandle {
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((err: unknown) => void) | null;
  close: () => void;
}

export function sseStream(url: string, headers: Record<string, string>): SseHandle {
  const handle: SseHandle = { onmessage: null, onerror: null, close: () => {} };
  const controller = new AbortController();
  let closed = false;
  handle.close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
  };

  (async () => {
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(`sse http ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''))
            .join('\n');
          if (data) handle.onmessage?.({ data });
        }
      }
      if (!closed) throw new Error('sse stream ended');
    } catch (err) {
      if (closed) return; // intentional close (e.g. AbortError) — not a failure
      handle.onerror?.(err);
    }
  })();

  return handle;
}

// Session envelope returned by verify-email/login/refresh.
export interface Session { token: string; tokenType: 'Bearer'; expiresIn: number }
export interface AuthResult { session: Session; animaId: string }

// Auth errors carry the backend's `error.code` so screens can branch (auth.invalid,
// conflict.registration, input.malformed, …).
export class AuthApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
  }
}
async function jAuth<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new AuthApiError(body?.error?.code ?? `http.${res.status}`, body?.error?.message ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

// Generic `/v1` request errors — the wire shape every non-auth route throws on 4xx/5xx
// (`{ error: { code, message, details? } }`, see allocutio/api/errors.ts ApiError). Carries
// `details` (e.g. Tabula publish's `{ code, vinculumId }`) so screens can branch on the
// specific failure, not just the HTTP status.
export class ApiRequestError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
async function jApi<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
    throw new ApiRequestError(body?.error?.code ?? `http.${res.status}`, body?.error?.message ?? res.statusText, res.status, body?.error?.details);
  }
  return res.json() as Promise<T>;
}

// ── Tabula (canvas workspace, ADR-0008 follow-up) — mirrors types/tabula.ts ──────
export interface TabulaNodus { id: string; modusId: string; x: number; y: number; aditus: Record<string, unknown> }
export interface TabulaVinculum {
  id: string; fonteNodusId: string; fontePorta: string; scopusNodusId: string; scopusPorta: string; discordantia: boolean;
}
export type TabulaVisibility = 'privata' | 'communis' | 'publica';
export type TabulaStatus = 'draft' | 'published' | 'archivata';
export interface Tabula {
  id: string;
  nomen: string;
  descriptio?: string;
  nodi: TabulaNodus[];
  vincula: TabulaVinculum[];
  modusId?: string;
  status: TabulaStatus;
  visibilitas: TabulaVisibility;
  fonteId?: string;
  templateId?: string;
  followTemplate?: boolean;
  natum: string;
  mutatum: string;
}

export const api = {
  listFlows: () => fetch('/v1/flows').then(j<{ flows: FlowSummary[] }>),
  getFlow: (id: string) => fetch(`/v1/flows/${id}`).then(j<FlowDescription>),
  quote: (body: Pick<RunRequest, 'modusId' | 'verb' | 'aditus'>) =>
    fetch('/v1/runs/quote', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ impetus: string; recipient?: string }>),
  // The ONLY route that spends an anonymous purse: when a Vault purse is active, the run
  // request carries ONLY the bursa token — `{ content-type, x-bursa-token }` — and NO
  // identity header (no `authorization`, no `x-commitment`). The server short-circuits on
  // the bursa token and ignores identity anyway (widgetRouter.ts:310 — token-only is the
  // house anonymous contract); attaching a session bearer or the stable anon commitment
  // would let logs/proxies correlate an anonymous spend back to a session or pseudonym.
  // No active purse → the normal identity/anon-commitment path (authHeaders), untouched;
  // every other route keeps authHeaders() regardless.
  createRun: (body: RunRequest) => {
    const purse = getActivePurse();
    const headers = purse
      ? { 'content-type': 'application/json', 'x-bursa-token': purse }
      : authHeaders();
    return fetch('/v1/runs', { method: 'POST', headers, body: JSON.stringify(body) }).then(j<{ run: Run }>);
  },
  getRun: (id: string) => fetch(`/v1/runs/${id}`, { headers: readHeaders() }).then(j<{ run: Run }>),
  // SSE — a fetch-based reader, NOT an EventSource. EventSource cannot send headers, and
  // the server route is owner-scoped auth (bearer/x-commitment header only) — a plain
  // EventSource is a structural 401 for every caller. `readHeaders()` covers both a
  // signed-in bearer and the anon commitment. Token stays in a header, never a query
  // param (query params leak into access logs/history).
  streamRun: (id: string) => sseStream(`/v1/runs/${id}/stream`, readHeaders()),
  meStatus: () => fetch('/v1/me/status', { headers: readHeaders() }).then(j<MeStatus>),

  // GET /api/vestigia — the caller's own recent vestigia (traces), newest first.
  listVestigia: (limit?: number) => {
    const q = limit ? `?limit=${limit}` : '';
    return fetch(`/api/vestigia${q}`, { headers: readHeaders() }).then(j<{ vestigia: Vestigium[]; count: number }>);
  },
  // GET /api/vestigia/projection — PCA-to-3D + k-means projection of the caller's
  // own vestigia, feeding Space.tsx's real-data mode.
  vestigiaProjection: (embedding: 'promptum' | 'imago' = 'promptum') =>
    fetch(`/api/vestigia/projection?embedding=${embedding}`, { headers: readHeaders() }).then(j<VestigiaProjection>),
  // DELETE /api/vestigia/:id — remove-from-space (owner-scoped; 404 for foreign/absent).
  // Hard-deletes the exploration-surface entry only; the underlying spend/Actum history
  // is untouched.
  removeVestigium: (id: string) =>
    fetch(`/api/vestigia/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() }).then(j<{ ok: true }>),
  // POST /api/vestigia/:id/impressio — set (or clear with null) the caller's OWN reaction
  // on their own vestigium. Owner-scoped, same 404 contract as removeVestigium.
  setVestigiumImpressio: (id: string, impressio: 'amor' | 'risus' | 'maeror' | null) =>
    fetch(`/api/vestigia/${encodeURIComponent(id)}/impressio`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ impressio }) })
      .then(j<{ vestigium: Vestigium }>),

  // GET /v1/me/runs — the caller's settled spend history (owner-scoped, paginated, newest
  // first) + lifetime running total. Anon-capable (commitment-keyed). costUsd is derived.
  listRuns: (opts: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams({ status: 'settled' });
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit) q.set('limit', String(opts.limit));
    return fetch(`/v1/me/runs?${q.toString()}`, { headers: readHeaders() }).then(j<RunsPage>);
  },

  // ── Deposit / buy-points (Funding) — public, no auth ─────────────────────────
  // GET /v1/deposit/config — the CreditVault address + canonical points-per-USD +
  // default funding rate + supported chains. Static; drives the buy-credits UI.
  getDepositConfig: () => fetch('/v1/deposit/config').then(j<DepositConfig>),
  // POST /v1/deposit/quote — how many impetus points `amount` base units of `token`
  // buys right now. INFORMATIONAL: the on-chain deposit webhook re-prices + credits
  // authoritatively (equal to this) at deposit time. token = 20-byte hex address
  // (0x000…000 for native ETH); amount = raw base units (wei / token-decimals) string.
  depositQuote: (body: { chainId: number | string; token: string; amount: string }) =>
    fetch('/v1/deposit/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(j<DepositQuote>),
  // GET /v1/deposit/mine — the caller's OWN deposits, scoped to their linked wallets (auth
  // required). Real depositum status (confirmatum/processatum) — the settle-watch UI polls
  // this instead of hoping the balance moves.
  myDeposits: () => fetch('/v1/deposit/mine', { headers: readHeaders() }).then(j<{ deposits: MyDeposit[] }>),

  // ── Fiat pack checkout (Stripe) — identified accounts only ───────────────────
  // POST /v1/payments/checkout — create a hosted Stripe Checkout session for one of the
  // fixed credit packs (starter_10/standard_25/plus_50/studio_100). Server-authoritative:
  // the impetus credited is the pack constant, applied later by the signature-verified
  // webhook on payment completion — never computed client-side. 401
  // payments.identity_required for an anon/purse caller (a fiat pack can't fund a purse).
  createCheckoutSession: (body: { packId: string; successUrl?: string; cancelUrl?: string }) =>
    fetch('/v1/payments/checkout', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<CheckoutSession>),

  // ── Collections (Collectio) — a batch-gen over a Tractus grid ────────────────
  // Owner-scoped by the caller commitment. Create LAUNCHES generation of `total`
  // pieces (real compute) — always a deliberate, confirmed action.
  listCollections: () => fetch('/v1/collectiones', { headers: readHeaders() })
    .then(j<{ collections: Collection[] }>),
  getCollection: (id: string) => fetch(`/v1/collectiones/${id}`, { headers: readHeaders() })
    .then(j<{ collection: Collection }>),
  createCollection: (body: CreateCollectionRequest) =>
    fetch('/v1/collectiones', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ collection: Collection }>),
  getCollectionRarity: (id: string) => fetch(`/v1/collectiones/${id}/rarity`, { headers: readHeaders() })
    .then(j<{ rarity: RarityReport }>),
  listCollectionPieces: (id: string, review: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') =>
    fetch(`/v1/collectiones/${id}/pieces?review=${review}`, { headers: readHeaders() })
      .then(j<{ pieces: CollectionPiece[] }>),
  approvePiece: (id: string, actumId: string) =>
    fetch(`/v1/collectiones/${id}/pieces/${actumId}/approve`, { method: 'POST', headers: authHeaders() }).then(j<{ ok: true }>),
  rejectPiece: (id: string, actumId: string) =>
    fetch(`/v1/collectiones/${id}/pieces/${actumId}/reject`, { method: 'POST', headers: authHeaders() }).then(j<{ ok: true }>),
  pauseCollection: (id: string) => fetch(`/v1/collectiones/${id}/pause`, { method: 'POST', headers: authHeaders() }).then(j<{ collection: Collection }>),
  resumeCollection: (id: string) => fetch(`/v1/collectiones/${id}/resume`, { method: 'POST', headers: authHeaders() }).then(j<{ collection: Collection }>),
  cancelCollection: (id: string) => fetch(`/v1/collectiones/${id}/cancel`, { method: 'POST', headers: authHeaders() }).then(j<{ collection: Collection }>),
  extendCollection: (id: string, count: number) =>
    fetch(`/v1/collectiones/${id}/extend`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ count }) }).then(j<{ collection: Collection }>),
  // Draft authoring: replace a draft's trait grid (re-derives provenance), then fire it.
  patchCollectionTractus: (id: string, tractus: Tractus[]) =>
    fetch(`/v1/collectiones/${id}/tractus`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ tractus }) }).then(j<{ collection: Collection }>),
  fireCollection: (id: string) =>
    fetch(`/v1/collectiones/${id}/fire`, { method: 'POST', headers: authHeaders() }).then(j<{ collection: Collection }>),

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
    fetch('/v1/editiones', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ edition: Editio }>),
  // GET /v1/editiones/:id — poll a publication (author-scoped) to watch an async
  // settle land: an archive ZIP build finishing (`externalRef` = the download url),
  // or a public surface being gated (→ rejected).
  getEdition: (id: string) => fetch(`/v1/editiones/${id}`, { headers: readHeaders() })
    .then(j<{ edition: Editio }>),
  retract: (id: string) =>
    fetch(`/v1/editiones/${id}/retract`, { method: 'POST', headers: authHeaders() })
      .then(j<{ edition: Editio }>),

  // ── Feed moderation review (Editio held-queue, spec §4) ──────────────────────
  // GET /v1/editiones/review — the review queue. An author sees their OWN held items
  // ("your publish is under review"); the platform admin (me.admin) sees ALL of them.
  // approve/reject/confirm-csam are PLATFORM-ADMIN ONLY server-side (403 otherwise).
  listReviewQueue: () => fetch('/v1/editiones/review', { headers: readHeaders() })
    .then(j<{ editions: Editio[] }>),
  // Clear a moderation hold → the item re-settles and publishes.
  approveEdition: (id: string) =>
    fetch(`/v1/editiones/${id}/approve`, { method: 'POST', headers: authHeaders() }).then(j<{ edition: Editio }>),
  // Decline a held publication → terminal 'rejected'. Files NO report.
  rejectEdition: (id: string) =>
    fetch(`/v1/editiones/${id}/reject`, { method: 'POST', headers: authHeaders() }).then(j<{ edition: Editio }>),
  // Affirmatively confirm a held item is CSAM → reject + file the NCMEC report. The only
  // review action that reports; a legal duty on human confirmation (18 U.S.C. §2258A).
  confirmCsam: (id: string) =>
    fetch(`/v1/editiones/${id}/confirm-csam`, { method: 'POST', headers: authHeaders() }).then(j<{ edition: Editio }>),

  // ── Admin workspace (credits-only, read-only observability) ──────────────────
  // GET /v1/admin/revenue — already-live platform-admin report; no client method existed
  // until the admin workspace hub. GET /v1/admin/cogs — the new read-only COGS pair.
  // Both server-gated regardless of the me.admin UI reveal.
  getRevenueReport: () => fetch('/v1/admin/revenue', { headers: readHeaders() }).then(j<RevenueReport>),
  getCogsReport: () => fetch('/v1/admin/cogs', { headers: readHeaders() }).then(j<CogsReport>),

  // ── Owned Bursa purses (delegation, §7) — identified accounts only ───────────
  // A purse converts part of your Signum balance into a shareable bearer token; runs
  // spend it via /v1/runs (x-bursa-token). You see the balance drain, never who spent it.
  // All four require a signed-in anima (401/403 for anon/purse callers).
  listPurses: () => fetch('/v1/purses', { headers: readHeaders() }).then(j<{ purses: Purse[] }>),
  mintPurse: (body: { credits: number; label?: string; fundFromAgentId?: string }) =>
    fetch('/v1/purses', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<Purse>),
  reclaimPurse: (token: string) =>
    fetch(`/v1/purses/${encodeURIComponent(token)}/reclaim`, { method: 'POST', headers: authHeaders() })
      .then(j<{ ok: boolean; refunded: string }>),
  revokePurse: (token: string) =>
    fetch(`/v1/purses/${encodeURIComponent(token)}/revoke`, { method: 'POST', headers: authHeaders() })
      .then(j<{ ok: boolean; refunded: string }>),

  // ── Training (modus.aitoolkit-training) — thin reads; launches go via createRun ──
  // Dataset list/create live under the internal data API (/v1/data/*). Kept thin:
  // the builder launches a training as a normal run, these only feed the picker/cost.
  listDatasets: () => fetch('/v1/data/datasets', { headers: readHeaders() })
    .then(j<{ datasets: DatasetSummary[] }>),
  trainingCost: (body: { steps: number; baseModel?: string; images?: number }) =>
    fetch('/v1/data/trainings/calculate-cost', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ impetus?: string; usd?: number }>),
  // Signed upload (R2). Returns a presigned PUT url + the permanent public url.
  signUpload: (body: { filename: string; contentType: string; bucketName?: string }) =>
    fetch('/api/v1/storage/uploads/sign', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ signedUrl: string; permanentUrl: string; key?: string }>),

  // ── Owned models (Model shelf) — the caller's private imports + trained LoRAs ─
  // GET /v1/me/models — owner-scoped, newest first. Anon-capable (commitment-keyed).
  listMyModels: () => fetch('/v1/me/models', { headers: readHeaders() }).then(j<{ models: ModelCard[] }>),
  // POST /v1/models/import — import a model/LoRA by URL as a PRIVATE, owner-scoped model
  // (Civitai page / HF repo / direct .safetensors). Usable in your flows at once; never on
  // the public catalog until a separate publish promotion passes moderation.
  importModel: (body: { url: string; genus?: 'lora' | 'model' }) =>
    fetch('/v1/models/import', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ model: ModelCard }>),
  // PUT /v1/models/:id/license — PLATFORM-ADMIN ONLY (403 otherwise): set an explicit
  // { license, commercialUse } or { reclassify: true } to re-derive from the base string.
  setModelLicense: (id: string, body: { license?: string; commercialUse?: ModelCard['commercialUse']; reclassify?: boolean }) =>
    fetch(`/v1/models/${encodeURIComponent(id)}/license`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ model: ModelCard }>),

  // ── Teams (Sodalitas) — a fellowship of Animae that co-owns work ─────────────
  // All member-scoped; identified accounts only. Founder is the first member.
  listTeams: () => fetch('/v1/teams', { headers: readHeaders() }).then(j<{ teams: Team[] }>),
  getTeam: (id: string) => fetch(`/v1/teams/${encodeURIComponent(id)}`, { headers: readHeaders() }).then(j<{ team: Team }>),
  createTeam: (body: { nomen: string; members?: string[] }) =>
    fetch('/v1/teams', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<{ team: Team }>),
  addTeamMember: (id: string, animaId: string) =>
    fetch(`/v1/teams/${encodeURIComponent(id)}/members`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ animaId }) }).then(j<{ team: Team }>),
  removeTeamMember: (id: string, animaId: string) =>
    fetch(`/v1/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(animaId)}`, { method: 'DELETE', headers: authHeaders() }).then(j<{ team: Team }>),

  // ── Projects (Provincia) — an account-owned workspace lens ───────────────────
  // Owner-scoped; identified accounts only (the anon path keeps a local mock).
  // Holdings are id references (datasetIds/modelIds/collectionIds), never copies.
  listProjects: () => fetch('/v1/me/projects', { headers: readHeaders() }).then(j<{ projects: RemoteProject[] }>),
  createProject: (body: { name: string; desc?: string; glyph?: string; color?: string; teamId?: string }) =>
    fetch('/v1/me/projects', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<{ project: RemoteProject }>),
  updateProject: (id: string, patch: { name?: string; desc?: string; glyph?: string; color?: string; teamId?: string | null }) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) }).then(j<{ project: RemoteProject }>),
  deleteProject: (id: string) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() }).then((r) => { if (!r.ok) throw new Error(`delete failed: ${r.status}`); }),
  fileAsset: (id: string, kind: 'dataset' | 'model' | 'collection', assetId: string) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}/holdings`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind, assetId }) }).then(j<{ project: RemoteProject }>),
  unfileAsset: (id: string, kind: 'dataset' | 'model' | 'collection', assetId: string) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}/holdings/${kind}/${encodeURIComponent(assetId)}`, { method: 'DELETE', headers: authHeaders() }).then(j<{ project: RemoteProject }>),

  // ── Sponsorships (Sponsio, ADR-0011 §2) — a standing capped top-up pledge ────
  // Identified accounts only (401 for anon/purse). Mounted at /v1/sponsorships.
  listSponsorships: () => fetch('/v1/sponsorships', { headers: readHeaders() }).then(j<{ sponsorships: Sponsorship[] }>),
  createSponsorship: (body: { beneficiaryAnimaId: string; grant: string; cadence: SubsidyCadence; balanceCap?: string; capTotal?: string }) =>
    fetch('/v1/sponsorships', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<{ sponsorship: Sponsorship }>),
  pauseSponsorship: (id: string) =>
    fetch(`/v1/sponsorships/${encodeURIComponent(id)}/pause`, { method: 'POST', headers: authHeaders() }).then(j<{ sponsorship: Sponsorship }>),
  resumeSponsorship: (id: string) =>
    fetch(`/v1/sponsorships/${encodeURIComponent(id)}/resume`, { method: 'POST', headers: authHeaders() }).then(j<{ sponsorship: Sponsorship }>),

  // ── Studios — a leased warm pod, metered from your balance ───────────────────
  // POST returns a `provisioning` handle immediately; poll GET /v1/studios/:id until
  // status leaves `provisioning`. maxImpetus IS the session budget — the studio
  // drain-terminates at the cap. Runs target it via POST /v1/runs { studioId }.
  listFundamenta: () => fetch('/v1/fundamenta').then(j<{ fundamenta: Fundamentum[] }>),
  listStudios: () => fetch('/v1/studios', { headers: readHeaders() }).then(j<{ studios: StudioView[] }>),
  getStudio: (id: string) =>
    fetch(`/v1/studios/${encodeURIComponent(id)}`, { headers: readHeaders() }).then(j<{ studio: StudioView }>),
  provisionStudio: (body: { fundamentumId?: string; models?: string[]; warmMs?: number; maxImpetus?: string; runtime?: string }) =>
    fetch('/v1/studios', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ studio: StudioView }>),
  // End the lease deliberately — owner-scoped, idempotent (double-release returns the
  // same terminal view, 200).
  releaseStudio: (id: string) =>
    fetch(`/v1/studios/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
      .then(j<{ studio: StudioView }>),

  // ── TEE private sessions — sealed compute over the caller's own tunnel ───────
  // The browser generates the WireGuard keypair; only the PUBLIC key goes up. Poll
  // GET until status='ready' (phase carries the live cold-start progress), then the
  // /tee WASM client drives the tunnel with the private key. DELETE ends the pod.
  provisionTee: (body: { wgClientPublicKey: string; gpuClass?: string; maxImpetus?: string }) =>
    fetch('/v1/sessions/tee', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ session: TeeSessionView }>),
  getTeeSession: (id: string) =>
    fetch(`/v1/sessions/tee/${encodeURIComponent(id)}`, { headers: readHeaders() }).then(j<{ session: TeeSessionView }>),
  endTeeSession: (id: string) =>
    fetch(`/v1/sessions/tee/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() })
      .then((r) => { if (!r.ok && r.status !== 404) throw new Error(`end session failed: ${r.status}`); }),

  // ── Account settings (Consuetudinum, owner-keyed / anon-capable) ─────────────
  // GET /v1/me — appearance (Profile) + generation defaults (Preferences) + bindings.
  getMe: () => fetch('/v1/me', { headers: readHeaders() }).then(j<MeView>),
  setAppearance: (appearance: Appearance) =>
    fetch('/v1/me/appearance', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(appearance) }).then(j<{ appearance: Appearance }>),
  setGeneratio: (generatio: Generatio) =>
    fetch('/v1/me/generatio', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(generatio) }).then(j<{ generatio: Generatio }>),
  // PUT /v1/me/bindings/:verb — rebind a canon verb (e.g. `make`) to a chosen flow. Auth
  // required (bearer purses can't rebind). Powers the Preferences default-flow picker.
  setBinding: (verb: string, modusId: string) =>
    fetch(`/v1/me/bindings/${encodeURIComponent(verb)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ modusId }) }).then(j<{ verb: string; modusId: string }>),
  getAffines: (modusId: string) =>
    fetch(`/v1/me/affines/${encodeURIComponent(modusId)}`, { headers: readHeaders() }).then(j<{ affines: Record<string, unknown> }>),
  setAffines: (modusId: string, affines: Record<string, unknown>) =>
    fetch(`/v1/me/affines/${encodeURIComponent(modusId)}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ affines }) }).then(j<{ affines: Record<string, unknown> }>),

  // ── BYO gated-origin secrets (Secretarium, owner-keyed / anon-capable) ───────
  // Connect a Civitai/HuggingFace token so gated imports scrape + download. The token
  // is sealed server-side and NEVER echoed back — presence-only (`getMe().secrets`).
  // Anon callers get a `warning` on connect (linking a named account deanonymizes them).
  putSecret: (provider: string, token: string, idleDays?: number) =>
    fetch(`/v1/me/secrets/${provider}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ token, idleDays }) }).then(jSecret),
  removeSecret: (provider: string) =>
    fetch(`/v1/me/secrets/${provider}`, { method: 'DELETE', headers: authHeaders() }).then(jSecret),

  // ── Arcanum (anonymous ZK credit rail) — mounted at /arcanum, NOT /v1 ────────
  // The client holds the note SECRET (never transmitted). NOTE: the signed-in issue path
  // below currently also sends the raw nullifier — see its comment. The bearer token and
  // Groth16 proof are the only other things these calls carry. See lib/arcanum.ts.
  arcanum: {
    // Prover discovery: where to fetch wasm/zkey + whether the ceremony is finalized.
    // ready:false → the whole mint path stays disabled (no fiction), link to /ceremony.
    config: () => fetch('/arcanum/config').then(j<ArcanumConfig>),
    // Convert identified balance → anonymous note. Signed-in path only (authHeaders →
    // Bearer). Client generates (nullifier, secret); the SECRET stays local, but the
    // server route requires commitment+nullifier TOGETHER, so the raw nullifier IS sent
    // here. That lets the server compute nullifierHash and link this authenticated funder
    // to the note's eventual spend — a known privacy limitation of the signed-in path,
    // tracked for a commitment-only (blind) issuance change (money-code spec gate). The
    // server inserts the leaf and returns the Merkle path. 501 if it can't resolve an
    // identity (anon caller). valor is a decimal-bigint string.
    issue: (body: { valor: string; commitment: string; nullifier: string }) =>
      fetch('/arcanum/issue', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
        .then(j<ArcanumIssuance>),
    // Fresh Merkle inclusion proof for a leaf (root moves as the tree grows — re-fetch
    // right before proving so the proof's root matches the current tree root).
    treeProof: (leafIndex: number) =>
      fetch(`/arcanum/tree/proof/${leafIndex}`).then(j<{ proof: ArcanumMerkleProofView }>),
    // Look up a leaf by its commitment. Used to RECOVER a note's leafIndex when the /issue
    // response was lost after the server already settled the debit and inserted the leaf —
    // without this the note (secret held locally) would be stuck at leafIndex -1. 404 until
    // the commitment is in the tree (e.g. issuance actually failed before settling).
    getLeaf: (commitment: string) =>
      fetch(`/arcanum/tree/leaf/${encodeURIComponent(commitment)}`)
        .then(j<{ leaf: { commitment: string; leafIndex: number; valor: string; insertedAt?: string } }>),
    // Redeem a spend proof once → mint an anonymous bearer purse. The note's nullifier is
    // burned server-side; 409 if it was already spent (idempotent — treat as already-minted).
    mintPurse: (arcanumProof: unknown) =>
      fetch('/arcanum/purse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arcanumProof }) })
        .then(j<{ token: string; credits: string }>),
    // Live balance for a purse token. 404 once it doesn't exist / was never minted.
    getPurse: (token: string) =>
      fetch(`/arcanum/purse/${encodeURIComponent(token)}`).then(j<{ token: string; credits: string; createdAt?: string }>),
  },

  // ── Fiat auth (username/password rail) ───────────────────────────────────────
  // Anonymous username+password — NO email. Register logs you in immediately (mints a
  // session). These deliberately do NOT send a commitment (a named account is a different
  // soul than the anon purse); refresh carries the bearer. Errors surface via AuthApiError.code.
  // Account recovery (forgot password) is via backup channels bound in the profile, not email.
  auth: {
    register: (username: string, password: string) =>
      fetch('/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
        .then(jAuth<AuthResult>),
    login: (username: string, password: string) =>
      fetch('/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
        .then(jAuth<AuthResult>),
    refresh: () =>
      fetch('/v1/auth/session/refresh', { method: 'POST', headers: { authorization: `Bearer ${getSession() ?? ''}` } })
        .then(jAuth<AuthResult>),

    // ── Wallet backup / recovery channel ───────────────────────────────────────
    // challenge → sign the returned `statement` → link (authed, binds to your soul) or
    // recover (public, logs into the soul the wallet is bound to). listWallets is authed.
    walletChallenge: (address: string) =>
      fetch('/v1/auth/wallet/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })
        .then(jAuth<{ token: string; statement: string }>),
    walletLink: (challengeToken: string, signature: string) =>
      fetch('/v1/auth/wallet/link', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ challengeToken, signature }) })
        .then(jAuth<{ address: string; moved?: boolean }>),
    walletRecover: (challengeToken: string, signature: string) =>
      fetch('/v1/auth/wallet/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeToken, signature }) })
        .then(jAuth<AuthResult>),
    listWallets: () =>
      fetch('/v1/auth/wallet', { headers: readHeaders() }).then(jAuth<{ wallets: string[] }>),

    // ── Telegram backup / recovery channel ─────────────────────────────────────
    // challenge (authed) → open the deepLink in Telegram + tap Start to bind. status (authed)
    // reflects whether it's linked. recover (public) redeems a code the bot handed the user.
    telegramChallenge: () =>
      fetch('/v1/auth/telegram/challenge', { method: 'POST', headers: authHeaders(), body: '{}' })
        .then(jAuth<{ code: string; deepLink?: string; botUsername?: string }>),
    telegramStatus: () =>
      fetch('/v1/auth/telegram', { headers: readHeaders() }).then(jAuth<{ linked: boolean }>),
    telegramRecover: (code: string) =>
      fetch('/v1/auth/telegram/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
        .then(jAuth<AuthResult>),
  },

  // ── Tabulae (canvas workspaces) — owner-scoped CRUD + publish-to-Modus ───────
  // Anon-capable throughout (commitment-keyed, same as the rest of authoring) —
  // no sign-in required to author or publish a spell.
  listTabulae: () => fetch('/v1/tabulae', { headers: readHeaders() }).then(jApi<{ tabulae: Tabula[] }>),
  createTabula: (body: { nomen: string; descriptio?: string; visibilitas?: TabulaVisibility }) =>
    fetch('/v1/tabulae', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(jApi<{ tabula: Tabula }>),
  getTabula: (id: string) => fetch(`/v1/tabulae/${id}`, { headers: readHeaders() }).then(jApi<{ tabula: Tabula }>),
  updateTabula: (id: string, patch: Partial<Pick<Tabula, 'nomen' | 'descriptio' | 'nodi' | 'vincula' | 'visibilitas'>>) =>
    fetch(`/v1/tabulae/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(patch) })
      .then(jApi<{ tabula: Tabula }>),
  deleteTabula: (id: string) =>
    fetch(`/v1/tabulae/${id}`, { method: 'DELETE', headers: authHeaders() }).then(jApi<{ ok: true }>),
  // Compile the canvas graph into a compositus Modus, immediately runnable via
  // POST /v1/runs. A cycle / port-type-mismatch graph 400s `input.invalid_graph`
  // with `details.{code,vinculumId}` naming the offending wire (errors.ts).
  publishTabula: (id: string) =>
    fetch(`/v1/tabulae/${id}/publish`, { method: 'POST', headers: authHeaders() }).then(jApi<{ modusId: string }>),
  // GET /v1/me/flows — the caller's own registered flows (owner-scoped), the canvas
  // node picker's "mine" twin of the canonical GET /v1/flows list above.
  listMyFlows: () => fetch('/v1/me/flows', { headers: readHeaders() }).then(jApi<{ flows: FlowSummary[] }>),
};

// Account settings (mirror the backend Consuetudo shapes).
export interface Appearance { avatarUrl?: string; bannerUrl?: string; backgroundUrl?: string; accent?: string; look?: string }
export interface Generatio {
  style?: string;
  negativePrompt?: string;
  outputFormat?: string;
  telegramDeliverAs?: 'album' | 'individual';
  autoApplyModels?: string[];
  defaultProjectId?: string;
}
// BYO gated-origin credential providers (mirror the server `SecretProvider` union).
export type SecretProvider = 'civitai' | 'huggingface';
export const SECRET_PROVIDERS: SecretProvider[] = ['civitai', 'huggingface'];
export const SECRET_PROVIDER_LABEL: Record<SecretProvider, string> = { civitai: 'Civitai', huggingface: 'HuggingFace' };

export interface MeView {
  appearance?: Appearance;
  generatio?: Generatio;
  bindings: Array<{ verb: string; modusId: string }>;
  // Per-provider connect state. Absent (undefined) or all-'absent' when the store is
  // unconfigured server-side — never carries the token itself.
  secrets?: Record<SecretProvider, 'connected' | 'absent'>;
  // Whether this deployment can store BYO secrets at all. false → connecting is unavailable
  // here (SECRETA_MASTER_KEY unset); hide/disable the panel proactively. Older servers omit it
  // (undefined) → treat as available and fall back to the reactive SecretsUnavailableError path.
  secretsAvailable?: boolean;
  // Whether this caller is the platform administrator (the moderation reviewer). Gates the
  // feed-review surface + its approve/reject controls. Server-authoritative; `true` only on
  // the platform session. Older servers omit it (undefined) → treated as not-admin.
  admin?: boolean;
}

// Admin revenue report (`GET /v1/admin/revenue`) — company-wide trailing-12mo USD revenue vs
// the tightest active conditional-license cap (the tripwire, ADR-0012/0013 §5). Read-only.
export interface RevenueReport {
  asOf: string;
  trailingUsdRevenueMicro: string;
  trailingUsdRevenue: string;
  band: 'clear' | 'watch' | 'warn' | 'breach';
  bindingCapUsd: number | null;
  activeConditionalLicenses: string[];
  lastAlertedBand: 'clear' | 'watch' | 'warn' | 'breach' | null;
}

// Admin COGS report (`GET /v1/admin/cogs`) — the read-only pair to RevenueReport: a
// trailing-window rollup of per-job costUsd off wide_events.
export interface CogsReport {
  asOf: string;
  sinceIso: string;
  costUsd: number;
  count: number;
}

// An owned Bursa purse (delegation, §7) — a shareable bearer token funded from your balance.
// `token` is the bearer credential (the invite code); `credits` is the remaining balance as a
// decimal string (bigint-as-string). `joinUrl` is present only for agent-funded mints.
export interface Purse {
  token: string;
  credits: string;
  createdAt: string;
  label?: string;
  status: 'active' | 'revoked';
  joinUrl?: string;
}

// Result of connecting/disconnecting a BYO secret (`PUT/DELETE /v1/me/secrets/:provider`).
// The token is NEVER included. `warning` is present only for anonymous (purse) callers.
export interface SecretView {
  provider: SecretProvider;
  status: 'connected' | 'absent';
  expiresAt?: string;
  warning?: string;
}

// ── Arcanum wire shapes (GET /arcanum/config, POST /arcanum/issue, /tree/proof) ──
// Prover discovery. ready=false when wasm or zkey isn't configured server-side — the
// Vault mint path stays disabled and links to the ceremony rather than faking readiness.
export interface ArcanumConfig { wasmUrl: string; zkeyUrl: string | null; depth: number; ready: boolean }
// What POST /arcanum/issue returns (mirror src/arcanum/types.ts ArcanumIssuance). We
// already hold valor locally; the load-bearing fields here are leafIndex + the Merkle path.
export interface ArcanumIssuance {
  note: { nullifierHash: string; commitment: string; leafIndex: number; valor: string; spent: boolean };
  merkleRoot: string;
  merklePathElements: string[];
  merklePathIndices: number[];
}
// A fresh Merkle inclusion proof (mirror src/arcanum/ArcanumTree.ts ArcanumMerkleProof).
export interface ArcanumMerkleProofView {
  root: string;
  leafIndex: number;
  pathElements: string[];
  pathIndices: number[];
}

export interface DatasetSummary { id: string; name: string; images?: number; updatedAt?: string }

// An owned model (GET /v1/me/models) — mirrors the backend ModelCard. Imports + trained
// LoRAs, owner-scoped. No royalty/run economics exist server-side yet.
export interface ModelCard {
  intellaId: string;
  nomen: string;
  genus: string;
  basis?: string;
  trigger?: string;
  description?: string;
  access?: 'public' | 'private';
  license?: string;
  commercialUse?: 'yes' | 'no' | 'conditional' | 'unknown';
}

// A team (Sodalitas) — GET/POST /v1/teams. Members co-own work; founder is the first member.
export interface Team {
  id: string;
  nomen: string;
  members: string[];
  founder: string;
  createdAt: string;
}

// A project (Provincia) as the server sees it — GET/POST /v1/me/projects. The durable,
// account-owned backbone: identity + holdings (id references). The web `Project` (lib/projects.ts)
// layers client-local view state (chats/canvases/favorites) on top of this.
export interface RemoteProject {
  id: string;
  owner: string;
  name: string;
  desc?: string;
  glyph?: string;
  color?: string;
  datasetIds: string[];
  modelIds: string[];
  collectionIds: string[];
  teamId?: string;
  createdAt: string;
  updatedAt: string;
}

// A sponsorship pledge (Sponsio) — GET/POST /v1/sponsorships. bigints ride as strings.
export type SubsidyCadence = 'weekly' | 'biweekly' | 'monthly';
export interface Sponsorship {
  id: string;
  sponsor: { animaId: string };
  beneficiarius: { animaId: string };
  subsidia: { grant: string; cadence: SubsidyCadence; balanceCap?: string };
  capTotal?: string;
  drippedTotal: string;
  lastDripCycle?: string;
  status: 'active' | 'paused' | 'exhausted';
  natum: string;
}

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
  // Dispatching new pieces is held (in-flight pieces still finish). Present + true only
  // while paused — absent means running normally. Survives a server restart.
  paused?: boolean;
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

// A compute substrate (GET /v1/fundamenta) — what a studio arms on.
export interface Fundamentum {
  id: string;
  nomen?: string;
  versio: string;
  runtime?: string;
  imageId: string;
  imageVersion: string;
  vramGb?: number;
}

// A hosted studio (GET/POST /v1/studios) — mirrors the backend StudioView.
// `studioId` is what POST /v1/runs { studioId } targets.
export interface StudioView {
  studioId: string;
  status: 'idle' | 'running' | 'provisioning' | 'draining' | 'terminated';
  budgetImpetus: string;
  podId?: string;
  gpu?: string;
  runtime?: string;
  imageRef?: string;
  warmUntil?: string;
  costPerHr?: number;
  impetusPerSecond?: string;
}

// A TEE private session (POST/GET /v1/sessions/tee) — mirrors the backend TeeSessionView.
// `phase` is the live cold-start progress (Phasis taxonomy) while status='provisioning'.
export type TeePhase =
  | 'queued' | 'provisioning' | 'pulling' | 'attesting' | 'downloading' | 'installing'
  | 'loading' | 'warming' | 'executing' | 'uploading' | 'finalizing' | 'cancelling'
  | 'done' | 'failed';
export interface TeeSessionView {
  sessionId: string;
  status: 'provisioning' | 'ready' | 'ended';
  phase?: TeePhase;
  error?: string;
  serverPublicKey?: string;
  endpoint?: string;
  proxyUrl?: string;
  tunnelIp?: string;
  gpuHours?: number;
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

// Deposit / buy-points config (GET /v1/deposit/config) — mirrors the backend DepositConfig.
export interface DepositConfig {
  depositAddress: string;
  // Canonical impetus points per 1 USD (gross, before the funding rate) — ≈ 2967.
  pointsPerUsd: number;
  // Default funding rate as a percent (70 = 70% of USD value converts to points).
  defaultFundingRatePct: number;
  chains: Array<{ chainId: number; name: string }>;
}
// The hosted Stripe Checkout session (POST /v1/payments/checkout) — mirrors the backend
// CheckoutResponseSchema. `url` is the hosted-checkout URL to redirect the caller to.
export interface CheckoutSession {
  url: string;
  sessionId: string;
}

// A deposit quote (POST /v1/deposit/quote) — informational; the webhook credit is authoritative.
export interface DepositQuote {
  chainId: number | string;
  token: string;
  amountRaw: string;
  grossUsd: string;
  grossUsdMicro: string;
  fundingRatePct: number;
  pointsQuoted: string;
  depositAddress: string;
}

// One of the caller's own deposits (GET /v1/deposit/mine) — owner-scoped, real status.
// Mirrors the backend MyDeposit — powers the settle-watch UI instead of hoping the balance moves.
export interface MyDeposit {
  id: string;
  chainId: number | string;
  txHash: string;
  valor: string;
  status: 'detectum' | 'confirmatum' | 'processatum' | 'fractum';
  natum: string;
}
