// Typed client for the Crystal /v1 API. Endpoints proven in the spike research.
// Phase 0: structure + a few live calls; screens still mostly use local mock data
// until each is wired. Dev server proxies /v1 + /api to the backend.

import type { Editio, EditionPreview, FeedFilter, FeedItem, PublishRequest } from './editio';

// Querela — an in-app report (bug/feature/feedback), noema-100's backend contract
// (src/types/Querela.ts). Mirrored here (not imported) — the web app doesn't import
// backend source (same convention as `CanonVerb` below).
export type QuerelaKind = 'bug' | 'feature' | 'feedback';
// Auto-captured client state at submit time — the user never types this. `runId`/`actumId`
// are populated only when the current route carries one (e.g. /train/run/:id); omitted
// otherwise. See ReportModal.tsx.
export interface QuerelaContext {
  route?: string;
  runId?: string;
  actumId?: string;
  userAgent?: string;
}

// The flow's canon verb, derived server-side at query time (`resolveCanonVerb`, noema-054).
// Mirrors the backend's `CanonVerb` union (src/crystal/verbResolver.ts) and the
// `FlowSummarySchema.modusGenus` enum (apiContract.ts) as a local literal type — the web
// app doesn't import backend source, so this list is kept in step with it by hand.
export type CanonVerb =
  | 'make' | 'effect' | 'animate' | 'direct' | 'render'
  | 'chat' | 'describe' | 'transcribe' | 'speak' | 'compose' | 'foley'
  | 'sculpt' | 'lift' | 'scan'
  | 'enhance';

// Optional here (unlike the server's required `modusGenus`) to match this file's existing
// convention of loosening required-on-the-wire fields to optional client-side (see `nomen`/
// `versio` above) — callers that construct a partial FlowSummary (e.g. Canvas.test.ts's
// dedupeFlows fixtures) shouldn't have to supply every field just to typecheck.
export interface FlowSummary { id: string; nomen?: string; versio?: string; categoria?: unknown; modusGenus?: CanonVerb }
export interface JsonSchema {
  type: string;
  properties?: Record<string, { type: string; format?: string; default?: unknown; description?: string; title?: string; optiones?: Array<{ value: string; label: string }> }>;
  required?: string[];
}
export interface FlowDescription { id: string; nomen: string; versio: string; input: JsonSchema; output?: JsonSchema; familia?: string }

export type RunStatus = 'pending' | 'running' | 'complete' | 'failed';

// A standing order — what the user ASKED FOR, as distinct from any one attempt at it. A
// training request survives an infrastructure failure: the order keeps attempting, hourly,
// until it lands or its window closes. Mirrors the server's `RunOrder` projection, so a
// screen reads `state` and never the failure sentence.
export type RunOrderState = 'attempting' | 'scheduled' | 'fulfilled' | 'stopped' | 'cancelled';
export interface RunOrder {
  id: string;
  state: RunOrderState;
  reason?: 'fulfilled' | 'failed' | 'exhausted' | 'cancelled';
  attempts: number;
  attemptsRemaining: number;
  nextAttemptAt?: string;
  until?: string;
  latestRunId?: string;
}

export interface Run {
  id: string;
  status: RunStatus;
  modusId: string;
  exitus?: Record<string, unknown>;
  failure?: { code: string; message: string };
  cost?: string;
  createdAt?: string;
  order?: RunOrder;
}

export interface RunRequest {
  modusId?: string;
  verb?: string;
  aditus: Record<string, unknown>;
  maxImpetus?: string;
  studioId?: string;
  commitment?: string;
  bursaToken?: string;
  // Chosen loras/models (intellaId or slug) — accepted top-level by apiRouter.ts's
  // POST /v1/runs (not nested in aditus). Wired from a concierge ProposalCard's
  // pinnedModels onto the GO run request (noema-099).
  pinnedModels?: string[];
}

// ── Concierge (colloquia) — noema-095's HTTP surface ──────────────────────────
// Mirrors src/allocutio/api/colloquiaRouter.ts + ConciergeAgent.ts's wire shapes
// (the web app doesn't import backend source — kept in step by hand, same
// convention as CanonVerb above).
export interface Colloquium {
  id: string;
  status: string;
  titulus?: string;
  /** The project this thread is filed under (noema-111). Absent → Uncategorized. */
  projectId?: string;
  tabulaId?: string;
  modoId?: string;
  natum: string;
  mutatum: string;
}
// A thread as returned by GET /v1/colloquia (list) — a Colloquium plus a short preview
// (the first user message, truncated) so the thread list is legible without hydrating it.
export interface ColloquiumSummary extends Colloquium {
  preview: string;
}
// The full thread as returned by GET /v1/colloquia/:id — the colloquium + its dicta, for resume.
export interface ColloquiumThread {
  colloquium: Colloquium;
  dicta: Dictum[];
}
export interface ConciergeTokenUsage { totalTokens: number; promptTokens?: number; completionTokens?: number }
export interface ConciergeQuote { impetus: string; recipient: string }
export interface ConciergeProposal {
  kind: 'proposal';
  modusId?: string;
  verb?: string;
  aditus: Record<string, unknown>;
  pinnedModels: string[];
  quote: ConciergeQuote;
  embellishedPrompt: string;
  rationale: string;
  tokenUsage: ConciergeTokenUsage;
  priorRunId?: string;
  delta?: string;
}
export interface ConciergeReply { kind: 'reply'; text: string; tokenUsage: ConciergeTokenUsage }
export type ConciergeResult = ConciergeProposal | ConciergeReply;
export interface Dictum {
  id: string;
  colloquiumId: string;
  genus: 'user' | 'agent' | 'systema';
  corpus: string;
  signaIds: string[];
  turnKey?: string;
  natum: string;
}

// A turnKey — the caller-supplied idempotency key required by POST /v1/colloquia/:id/dicta
// (colloquiaRouter.ts). One per dicta call; a resend of the exact same failed call would
// reuse it (not implemented by callers here — each call mints a fresh one, matching the
// "an accepted free turn, never a double" invariant on the crashed-before-charge path).
// Shared by Chat.tsx and shell/Concierge.tsx — kept here (not in either screen file) to
// avoid a Chat.tsx <-> AppShell <-> Concierge.tsx import cycle (Concierge is mounted by
// every AppShell page, including Chat's own).
export function newTurnKey(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// A vestigium (trace) — the indexed record of a completed generation. Mirrors the
// backend's Vestigium shape (src/types/vestigium.ts), web-relevant fields only.
export interface VestigiumImpressio { auctorImpressio?: 'amor' | 'risus' | 'maeror'; amor: number; risus: number; maeror: number }
export interface Vestigium {
  id: string;
  /** FK -> Actum (types/vestigium.ts#Vestigium.actumId), present when the trace resolved
   * from a completed generation — the id a dataset's `source: 'generation'` create body needs. */
  actumId?: string;
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
  // The standing order behind a run, and the cancel for it. Owner-scoped server-side off the
  // run — a run id addresses the order, it does not authorise it.
  getRunOrder: (id: string) =>
    fetch(`/v1/runs/${encodeURIComponent(id)}/order`, { headers: readHeaders() })
      .then(j<{ order: RunOrder | null }>),
  revokeRunOrder: (id: string) =>
    fetch(`/v1/runs/${encodeURIComponent(id)}/order/revoke`, { method: 'POST', headers: authHeaders() })
      .then(j<{ order: RunOrder | null }>),
  // SSE — a fetch-based reader, NOT an EventSource. EventSource cannot send headers, and
  // the server route is owner-scoped auth (bearer/x-commitment header only) — a plain
  // EventSource is a structural 401 for every caller. `readHeaders()` covers both a
  // signed-in bearer and the anon commitment. Token stays in a header, never a query
  // param (query params leak into access logs/history).
  streamRun: (id: string) => sseStream(`/v1/runs/${id}/stream`, readHeaders()),
  meStatus: () => fetch('/v1/me/status', { headers: readHeaders() }).then(j<MeStatus>),
  // GET /v1/me/partner — the caller's B2B partner record, if any. A "partner" is just an
  // ordinary account a platform admin has approved (no on-chain agent/treasury). Uses `jApi`
  // (not `j`) so a 404 (no/revoked partner) surfaces as a typed `ApiRequestError` the Partner
  // screen can branch on (`err.code === 'not_found.partner'`) instead of a generic message.
  mePartner: () => fetch('/v1/me/partner', { headers: readHeaders() }).then(jApi<Partner>),
  // GET /v1/me/partner-request — the caller's OWN most recent application and its state.
  // The companion to mePartner(): that one reports approval and 404s the same way for someone
  // who never applied, someone under review and someone declined. This one says which.
  // `jApi` again, so the Partner screen can branch on `err.code === 'not_found.partner_request'`
  // (this account has filed nothing) rather than showing an error for a normal state.
  mePartnerRequest: () => fetch('/v1/me/partner-request', { headers: readHeaders() }).then(jApi<OwnPartnerRequest>),
  // POST /v1/me/partner/api-key — self-serve issue-or-rotate, callable ONLY by the partner
  // themselves (never returned from the admin approval route — see adminDecidePartnerRequest's
  // comment below for why). Each call retires any key this same flow issued previously and
  // returns a fresh one; the response is the ONLY time the raw key is ever retrievable.
  rotatePartnerApiKey: () => fetch('/v1/me/partner/api-key', { method: 'POST', headers: authHeaders() }).then(jApi<{ apiKey: string }>),

  // POST /v1/partner-requests — the public "become a B2B partner" intake (partnerRequestRouter.ts).
  // Public, anon-capable: uses the same authHeaders() every other identity-attach write in this
  // app uses (bearer if signed in, else the anon commitment) — the backend opportunistically
  // resolves the caller's animaId when a valid session is present and swallows any resolution
  // failure otherwise, so this call needs no special-casing for logged-out vs. logged-in.
  requestPartnership: (body: { contactEmail: string; useCase: string; nomen?: string; org?: string; notes?: string }) =>
    fetch('/v1/partner-requests', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(jApi<{ id: string }>),

  // ADMIN — GET/PATCH /v1/admin/partner-requests (partnerAdminRouter.ts), platform-admin only
  // server-side (client gate is cosmetic, same convention as every other admin surface here).
  // `status` narrows the list; omit for every request regardless of status.
  adminListPartnerRequests: (status?: PartnerRequestStatus) =>
    fetch(`/v1/admin/partner-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`, { headers: readHeaders() })
      .then(jApi<{ requests: PartnerRequest[] }>),
  // Approving a request with no animaId only flips its status — no Partner record. Approving
  // one that carries an animaId provisions a Partner record ONLY — never an API key. The admin
  // clicking Approve is frequently not the partner, so a key never appears in this response;
  // the partner mints their own, self-serve, via rotatePartnerApiKey() above once they can see
  // they're approved.
  adminDecidePartnerRequest: (id: string, status: 'approved' | 'declined') =>
    fetch(`/v1/admin/partner-requests/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status }),
    }).then(jApi<{ request: PartnerRequest; partner?: Partner }>),

  // ── Concierge (colloquia, noema-095) ──────────────────────────────────────
  // Same auth pattern as createRun (Decision record Q4, noema-099): an active
  // Vault purse sends ONLY the bursa token, no identity header; otherwise the
  // normal authHeaders() bearer/anon-commitment path.
  // POST /v1/colloquia — start a conversation thread. `projectId` (noema-111) files the
  // thread under the active project; omit it for the idle/uncategorized dock.
  createColloquium: (body: { titulus?: string; projectId?: string; tabulaId?: string; modoId?: string; bursaToken?: string } = {}) => {
    const purse = getActivePurse();
    const headers = purse ? { 'content-type': 'application/json', 'x-bursa-token': purse } : authHeaders();
    return fetch('/v1/colloquia', { method: 'POST', headers, body: JSON.stringify(body) }).then(j<{ colloquium: Colloquium }>);
  },
  // GET /v1/colloquia — the caller's own threads (owner-scoped server-side), newest first,
  // each with a short preview. Feeds the thread-list UI (noema-111). Purse-aware like
  // createColloquium: an active Vault purse scopes to the bursaToken ownerKey (Decision Q4).
  listColloquia: () => {
    const purse = getActivePurse();
    const headers = purse ? { 'x-bursa-token': purse } : readHeaders();
    return fetch('/v1/colloquia', { headers }).then(j<{ colloquia: ColloquiumSummary[] }>);
  },
  // GET /v1/colloquia/:id — the full thread (colloquium + dicta) for resume; 404 if not the
  // caller's (same authz as the dicta POST). noema-111.
  getColloquium: (id: string) => {
    const purse = getActivePurse();
    const headers = purse ? { 'x-bursa-token': purse } : readHeaders();
    return fetch(`/v1/colloquia/${encodeURIComponent(id)}`, { headers }).then(j<ColloquiumThread>);
  },
  // POST /v1/colloquia/:id/dicta — run one metered turn. `turnKey` is the caller-supplied
  // idempotency key (required server-side); `priorRunId` sets the critique/adjust context.
  postDictum: (
    colloquiumId: string,
    body: { turnKey: string; message: string; priorRunId?: string; bursaToken?: string },
  ) => {
    const purse = getActivePurse();
    const headers = purse ? { 'content-type': 'application/json', 'x-bursa-token': purse } : authHeaders();
    return fetch(`/v1/colloquia/${encodeURIComponent(colloquiumId)}/dicta`, { method: 'POST', headers, body: JSON.stringify(body) })
      .then(j<{ dictum: Dictum; result: ConciergeResult; charged: string; idempotentReplay?: boolean }>);
  },

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

  // ── Credit-pack catalog — public, no auth ────────────────────────────────────
  // GET /v1/payments/packs — the ratified credit packs for DISPLAY (pricing page + Funding),
  // sourced from the server's single stripePacks catalog. `credits` is display-only (= impetus/10);
  // the charged/credited amount stays server-authoritative by packId at checkout time.
  listPacks: () => fetch('/v1/payments/packs').then(j<{ packs: Pack[] }>).then((r) => r.packs),

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
  // GET /v1/collectiones — the caller's collections, newest first, cursor-paginated like
  // /v1/me/runs. `listAllCollections` below walks the pages for the screens that want the lot.
  listCollections: (opts: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return fetch(`/v1/collectiones${qs ? `?${qs}` : ''}`, { headers: readHeaders() })
      .then(j<{ collections: Collection[]; nextCursor?: string }>);
  },
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
  // Draft authoring: set a draft's trait grid / base flow / supply (re-derives provenance),
  // then fire it. Omitted fields are left untouched.
  patchCollectionDraft: (id: string, patch: { tractus?: Tractus[]; modusId?: string; numerus?: number }) =>
    fetch(`/v1/collectiones/${id}/tractus`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) }).then(j<{ collection: Collection }>),
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
  // GET /v1/editiones/:id/preview — the media behind a held publication, for ANY artifact
  // kind (not just an actum generation run) — resolves the same view the moderation gate
  // used to make its hold decision. PLATFORM-ADMIN ONLY server-side (same gate as
  // approve/reject/confirm-csam); a non-admin caller is refused.
  getEditionPreview: (id: string) =>
    fetch(`/v1/editiones/${id}/preview`, { headers: readHeaders() }).then(j<EditionPreview>),
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
  // All of these require a signed-in anima (401/403 for anon/purse callers).
  listPurses: () => fetch('/v1/purses', { headers: readHeaders() }).then(j<{ purses: Purse[] }>),
  mintPurse: (body: { credits: number; label?: string; fundFromAgentId?: string }) =>
    fetch('/v1/purses', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<Purse>),
  reclaimPurse: (token: string) =>
    fetch(`/v1/purses/${encodeURIComponent(token)}/reclaim`, { method: 'POST', headers: authHeaders() })
      .then(j<{ ok: boolean; refunded: string }>),
  revokePurse: (token: string) =>
    fetch(`/v1/purses/${encodeURIComponent(token)}/revoke`, { method: 'POST', headers: authHeaders() })
      .then(j<{ ok: boolean; refunded: string }>),
  // Redeem someone else's purse token into YOUR balance — the whole remaining balance, once.
  // Uses jApi so the screen can branch on the refusal code (purse.redeemed,
  // purse.owner_reclaims, purse.not_redeemable, purse.not_found) rather than on prose.
  redeemPurse: (token: string) =>
    fetch(`/v1/purses/${encodeURIComponent(token)}/redeem`, { method: 'POST', headers: authHeaders() })
      .then(jApi<{ ok: boolean; credited: string }>),

  // ── Training (modus.aitoolkit-training) — thin reads; launches go via createRun ──
  // Dataset list/create live under the internal data API (/v1/data/*). Kept thin:
  // the builder launches a training as a normal run, these only feed the picker/cost.
  listDatasets: () => fetch('/v1/data/datasets', { headers: readHeaders() })
    .then(j<{ datasets: DatasetSummary[] }>),
  // Full rich shape (custody, modality, captionsets, versions) — Datasets.tsx's live listing.
  listDatasetsFull: () => fetch('/v1/data/datasets/full', { headers: readHeaders() })
    .then(j<{ datasets: Dataset[] }>),
  createDataset: (body: CreateDatasetRequest) =>
    fetch('/v1/data/datasets', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ dataset: Dataset }>),
  // Append media to a dataset the caller owns. Same discriminated ingestion body as
  // `createDataset` and the same minting path server-side, so a set grows the way it was
  // seeded. APPEND-ONLY: nothing here removes, replaces or reorders media. The response
  // carries the WHOLE dataset back — a new version plus every captionset's recomputed
  // coverage — which is what a caller re-renders from; a locally patched copy would be a
  // version behind on both. A write, so it takes `authHeaders()` like its siblings: the
  // owner is resolved from the caller server-side and never from a parameter.
  addDatasetMedia: (id: string, body: AddDatasetMediaRequest) =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/media`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    }).then(j<{ dataset: Dataset }>),
  // One dataset by id: list + find first (the caller's own datasets, cheap, and covers the
  // common case in one round trip), falling back to the direct read
  // (`GET /v1/data/datasets/:id`, noema-dataset-access-field) when the id isn't in that list —
  // which is exactly the case for a dataset the caller may READ but does not own: a public one
  // someone else made. `listDatasetsFull` stays owner+team scoped on purpose (mixing public
  // rows into it would conflate "your shelf" with "the catalog"), so this fallback is the only
  // way a public dataset's own id ever resolves here.
  getDatasetFull: (id: string) =>
    fetch('/v1/data/datasets/full', { headers: readHeaders() })
      .then(j<{ datasets: Dataset[] }>)
      .then(({ datasets }) => datasets.find((d) => d.id === id) ?? api.getDataset(id)),
  // The direct single-dataset read. Resolves for the owner, a team member, or anyone when the
  // dataset's access is public; not_found otherwise (never forbidden — ids stay
  // non-enumerable). Auth required, unlike `listPublicDatasets` below — reading ONE dataset by
  // id still needs an identified caller, same as every other dataset route.
  getDataset: (id: string): Promise<Dataset | null> =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}`, { headers: readHeaders() })
      .then(j<{ dataset: Dataset }>)
      .then(({ dataset }) => dataset)
      .catch(() => null),
  // Merge dataset `id` into an already-fetched list when it is missing from it — the fallback
  // every list-then-find screen needs (Datasets.tsx via Dataset.tsx/Muse.tsx) for a dataset the
  // caller may read but does not own: `listDatasetsFull` never contains it, so this is the one
  // extra request that makes it resolvable anyway. A no-op when `id` is absent, already
  // present, or unreadable by the caller (`getDataset` resolves null, not a thrown error).
  withDatasetFallback: async (ds: Dataset[], id: string | undefined): Promise<Dataset[]> => {
    if (!id || ds.some((d) => d.id === id)) return ds;
    const found = await api.getDataset(id);
    return found ? [...ds, found] : ds;
  },
  // The public dataset catalog — every dataset with access.kind 'public', scoped to nobody in
  // particular. Public, no auth (mirrors listModels): browsing what the platform publishes
  // does not require an account, though USING one (spawning a Muse session, appending media)
  // still does.
  listPublicDatasets: (opts: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return fetch(`/v1/data/datasets/public${qs ? `?${qs}` : ''}`)
      .then(j<{ datasets: Dataset[]; nextCursor?: string }>);
  },
  // PATCH one caption inside one captionset. Captionsets are editable after generation; the
  // server recomputes that captionset's coverage from the captions present and returns the
  // whole dataset back.
  setCaption: (datasetId: string, captionsetId: string, mediaId: string, caption: string) =>
    fetch(
      `/v1/data/datasets/${encodeURIComponent(datasetId)}/captionsets/${encodeURIComponent(captionsetId)}/captions/${encodeURIComponent(mediaId)}`,
      { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ caption }) },
    ).then(j<{ dataset: Dataset }>),

  // ── Archive (the delete that strands nothing) ────────────────────────────
  // Archiving a set takes it out of both list routes and out of every picker built on them.
  // It is not an erasure: the record stays, so a Muse session naming it as a mother dataset,
  // a session dataset behind a saved piece and a past run's lineage all keep resolving. Each
  // of the four calls returns the WHOLE dataset back, which is what a caller re-renders from.
  // Writes, so they take `authHeaders()`: ownership is resolved from the caller server-side
  // and never from a parameter.
  // Publish (kind: 'public') or unpublish (kind: 'private') a dataset the caller owns — makes
  // it listed in GET /v1/data/datasets/public and readable/Muse-able by anyone, or takes it back
  // out. Owner-only, like archive/restore below; a team member's attempt 404s the same way.
  setDatasetAccess: (id: string, kind: 'public' | 'private') =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/access`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind }),
    }).then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  archiveDataset: (id: string) =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: authHeaders() })
      .then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  restoreDataset: (id: string) =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/restore`, { method: 'POST', headers: authHeaders() })
      .then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  // One media item. The item leaves the dataset's working set — the media a caption pass or a
  // decompose reads, and every captionset's coverage, which the server recomputes against what
  // is left — while staying on the record, because caption maps and fragments are keyed on its
  // id and have to survive the restore.
  archiveDatasetMedia: (datasetId: string, mediaId: string) =>
    fetch(
      `/v1/data/datasets/${encodeURIComponent(datasetId)}/media/${encodeURIComponent(mediaId)}/archive`,
      { method: 'POST', headers: authHeaders() },
    ).then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  restoreDatasetMedia: (datasetId: string, mediaId: string) =>
    fetch(
      `/v1/data/datasets/${encodeURIComponent(datasetId)}/media/${encodeURIComponent(mediaId)}/restore`,
      { method: 'POST', headers: authHeaders() },
    ).then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),

  // ── Muse sessions ────────────────────────────────────────────────────────
  // The session is the only place a Muse floor or piece ledger is written. Every
  // mutator returns the WHOLE updated session, so a caller re-renders from the
  // response rather than patching a local copy — there is one mutation path and one
  // source of truth for what the floor says.
  //
  // Ownership is scoped server-side from the resolved caller: a session belonging to
  // someone else answers exactly as an id that never existed does. No scoping check
  // belongs on this side of the wire.
  //
  // A fragment is named by `{category, text}` in the BODY of the floor calls. Its
  // identity is `category:text`, which is free text and is unsafe as a path segment.
  listMuseSessions: (datasetId: string) =>
    fetch(`/v1/data/muse/sessions?datasetId=${encodeURIComponent(datasetId)}`, { headers: readHeaders() })
      .then(j<{ sessions: MuseSessionView[] }>),
  spawnMuseSession: (datasetId: string) =>
    fetch('/v1/data/muse/sessions', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ datasetId }) })
      .then(j<{ session: MuseSessionView }>),
  getMuseSession: (id: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}`, { headers: readHeaders() })
      .then(j<{ session: MuseSessionView }>),
  setMuseFragmentEnabled: (id: string, fragment: MuseFragmentIdentity, enabled: boolean) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/floor/enabled`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ ...fragment, enabled }),
    }).then(j<{ session: MuseSessionView }>),
  setMuseFragmentWeight: (id: string, fragment: MuseFragmentIdentity, weight: number) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/floor/weight`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ ...fragment, weight }),
    }).then(j<{ session: MuseSessionView }>),
  // The un-metered way to widen a floor: the fragment the user wrote, put on the floor
  // in the draw at even odds. One call, carrying the fragment's identity and nothing
  // else — no flow, no model, no quote — and a fragment the floor already holds comes
  // back as the session unchanged rather than as a duplicate.
  addMuseFragment: (id: string, fragment: MuseFragmentIdentity) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/floor/fragments`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(fragment),
    }).then(j<{ session: MuseSessionView }>),
  // PATCH …/setup — what the session fires its draw THROUGH: the flow, the run shape,
  // the model stack and the standing affix. It goes to the server rather than to this
  // browser for the same reason the floor does — a session is resumable from anywhere,
  // and a setup held in one browser would disagree with it. Sent on COMMIT, never on a
  // keystroke. The setup is replaced wholesale. NOTHING IS SPENT: no run, no quote.
  // The infinite-mode acknowledgement is not part of a setup and is not sent here.
  setMuseSetup: (id: string, setup: MuseSetup) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/setup`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify(setup),
    }).then(j<{ session: MuseSessionView }>),
  // POST …/steer — a short instruction against the session's floor in, a PROPOSAL out.
  // NOTHING IS APPLIED by this call: the response is what the consent sheet is rendered
  // from, every pill in it is vetoable, and the floor moves only through the two floor
  // calls above, made when the user confirms. The floor is resolved server-side from the
  // session the caller owns — it is not a parameter — so the body carries the instruction
  // and nothing else. METERED: one model call, priced by `quote` above before it is sent.
  steerMuseSession: (id: string, instruction: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/steer`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ instruction }),
    }).then(j<{ proposal: MuseSteerProposal }>),
  // POST …/kept — the keep gesture. Rolling is free and a roll in progress is this
  // screen's own, so the report and its edits stay here; keeping is the explicit act and
  // goes to the server, which is why a kept roll is still there after a navigation. The
  // whole updated session comes back and the panel re-renders from it, like every other
  // session write. APPEND-ONLY: keeping the same prompt twice keeps it twice, and there
  // is no call here that removes one. NOTHING IS SPENT — the prompt is kept, not fired.
  keepMuseRoll: (id: string, roll: MuseKeptRoll) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/kept`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(roll),
    }).then(j<{ session: MuseSessionView }>),
  // Append-only, one entry per run: a piece is recorded once, at fire time, with the
  // lineage that produced it. A second record for the same run is rejected.
  recordMusePiece: (id: string, piece: MusePieceRecord) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/pieces`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(piece),
    }).then(j<{ session: MuseSessionView }>),
  // A reaction and a dismissal are both given after the piece exists, so this is the
  // route that reaches a recorded piece. A field left out is left as it was.
  updateMusePiece: (id: string, runId: string, patch: { reaction?: MuseReaction; dismissed?: boolean }) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/pieces/${encodeURIComponent(runId)}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch),
    }).then(j<{ session: MuseSessionView }>),
  // Put a piece back into the set. The media joins the session's OWN dataset — created by
  // the first save, appended to by every save after it — carrying the piece's recorded
  // lineage as that item's fragments; the mother is never written. Nothing is spent and no
  // job runs: the piece was composed from fragments, so its lineage is already its tagging.
  // The body is empty — the run is named in the path and its media is resolved server-side.
  saveMusePiece: (id: string, runId: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/pieces/${encodeURIComponent(runId)}/save`, {
      method: 'POST', headers: authHeaders(),
    }).then(j<{ session: MuseSessionView }>),
  // POST …/promote — the session becomes a DRAFT collection: the floor still in the draw
  // becomes the trait grid, and the flow, the standing affix and the stacked trigger words
  // become the base prompt that grid expands. NOTHING IS SPENT — a draft is not dispatched,
  // and the supply and rules a session does not carry are set in the collection funnel this
  // returns into. The session is not written, so promoting does not end or alter the sitting.
  // The body carries at most a name: the grid, the flow and the funding identity are all
  // resolved server-side from the session and are never sent from here.
  promoteMuseSession: (id: string, nomen?: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/promote`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(nomen ? { nomen } : {}),
    }).then(j<{ collection: Collection }>),

  // For a cost estimate before dispatching, use `quote` above (`POST /v1/runs/quote`).
  // Signed upload (R2). Returns a presigned PUT url + the permanent public url.
  signUpload: (body: { filename: string; contentType: string; bucketName?: string }) =>
    fetch('/api/v1/storage/uploads/sign', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ signedUrl: string; permanentUrl: string; key?: string }>),

  // GET /v1/models?basis=<basis> — the public, filterable model catalog (apiRouter.ts:552-565),
  // scoped to one base-model family. Backs the composer's live LoRA trigger-word highlight:
  // called once per flow load with `flow.familia`, the result cached client-side into a
  // trigger→ModelCard lookup (no backend change needed — the endpoint already exists).
  listModelsByBasis: (basis: string) =>
    fetch(`/v1/models?basis=${encodeURIComponent(basis)}`, { headers: readHeaders() }).then(j<{ models: ModelCard[] }>),
  // GET /v1/models — the public model catalog: everything the platform publicly carries,
  // platform-seeded models plus models users have published. `sort` is a REAL server-side
  // parameter (newest | name | genus), applied before any `limit` slice, so the ordering the
  // browser shows is the ordering the server paged. The public projection carries no
  // access/license/commercialUse — these cards are read-only.
  listModels: (params: { q?: string; genus?: string; basis?: string; limit?: number; sort?: CatalogSort } = {}) => {
    const s = new URLSearchParams();
    if (params.q) s.set('q', params.q);
    if (params.genus) s.set('genus', params.genus);
    if (params.basis) s.set('basis', params.basis);
    if (params.limit != null) s.set('limit', String(params.limit));
    if (params.sort) s.set('sort', params.sort);
    const qs = s.toString();
    return fetch(`/v1/models${qs ? `?${qs}` : ''}`, { headers: readHeaders() }).then(j<{ models: ModelCard[] }>);
  },
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
  // POST /v1/me/attestation — record the one-time 18+ self-attestation (a click-through fact, not
  // KYC). Required on file before spicyMode may be enabled. Anon-capable.
  recordAttestation: () =>
    fetch('/v1/me/attestation', { method: 'POST', headers: authHeaders() }).then(j<{ attestation: { attestedAt: number } }>),
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
    // Wallet-FIRST signup (public): prove a wallet with no username/password. Mints an account
    // bound to the wallet if it's unknown, or logs into the existing soul if already bound.
    walletRegister: (challengeToken: string, signature: string) =>
      fetch('/v1/auth/wallet/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeToken, signature }) })
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

  // POST /v1/reports — file a Querela (bug/feature/feedback), noema-100's report store.
  // Anon-capable via the same identity-attach pattern as every other authenticated write
  // (authHeaders(): bearer if signed in, else the anon commitment). `context` is auto-captured
  // client state (route/run-id/userAgent) — the user never types it; see ReportModal.tsx.
  submitReport: (kind: QuerelaKind, description: string, context: QuerelaContext) =>
    fetch('/v1/reports', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        kind,
        description,
        capturedState: { route: context.route, runId: context.runId, actumId: context.actumId },
        userAgent: context.userAgent,
      }),
    }).then(j<{ id: string }>),
};

// Every collection the caller owns, newest first — the pre-pagination reading of
// `GET /v1/collectiones`, now assembled by walking its pages. The two screens that list
// collections want the whole set (a grid, and a name lookup), so the walk lives here rather
// than in each of them. Bounded: a page must be non-empty and carry a fresh cursor to earn
// another request, so a server that keeps handing back the same cursor cannot spin this.
export async function listAllCollections(): Promise<Collection[]> {
  const out: Collection[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await api.listCollections(cursor ? { cursor } : {});
    out.push(...page.collections);
    if (!page.nextCursor || !page.collections.length || seen.has(page.nextCursor)) return out;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

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
  api.activity({ limit: 20 })
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

// Account settings (mirror the backend Consuetudo shapes).
export interface Appearance { avatarUrl?: string; bannerUrl?: string; backgroundUrl?: string; accent?: string; look?: string }
export interface Generatio {
  style?: string;
  negativePrompt?: string;
  outputFormat?: string;
  telegramDeliverAs?: 'album' | 'individual';
  autoApplyModels?: string[];
  defaultProjectId?: string;
  // Adult ("spicy") mode (noema-091). When ON — and an 18+ attestation is on file — permits
  // adult-rated models, routes concierge chat to willing OpenRouter models, relaxes SFW default
  // negatives. Default-absent = OFF. Enabling requires a recorded attestation (see recordAttestation).
  spicyMode?: boolean;
  // One-time self-declared 18+ attestation (a click-through fact, NOT KYC). Required on file before
  // spicyMode may be enabled. Recorded via POST /v1/me/attestation.
  ageAttestation?: { attestedAt: number };
  // Private generation (noema-347). When ON, the outputs of NEW runs are visible only to you, via
  // expiring links; default-absent = OFF. Forward-only — it never moves what already exists.
  privateOutputs?: boolean;
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
  // 'redeemed' — an account took the whole remaining balance. Terminal and drained, like
  // 'revoked'.
  status: 'active' | 'revoked' | 'redeemed';
  // When that happened. The owner sees THAT an invite converted and WHEN, never by whom.
  redeemedAt?: string;
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
/** `enabled` is ANON_PURSE_ENABLED (noema-131) — false until the trusted-setup ceremony runs.
 *  Optional because an older server omits it; read it as `=== true`, never as a truthy default,
 *  so a page never promises the purse to a visitor the server will refuse. */
export interface ArcanumConfig { wasmUrl: string; zkeyUrl: string | null; depth: number; ready: boolean; enabled?: boolean }
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

// Full dataset shape (GET /v1/data/datasets/full) — mirrors backend `types/dataset.ts#Dataset`.
export type DatasetModality = 'image' | 'video' | 'audio' | '3d';
export type DatasetCustody = 'sealed' | 'local' | 'remote';
// `captions` mirrors the server's `types/dataset.ts#Captionset`: caption text keyed by
// media id (never by position — media is append-only), sparse, and absent on captionsets
// written before the field existed.
export interface DatasetCaptionset { id: string; name: string; method: string; coverage: string; captions?: Record<string, string> }
// Mirrors the backend `types/dataset.ts#Fragment` (re-exported from `src/crystal/muse/taxonomy.ts`,
// which this app cannot import — `src/crystal` sits outside its `tsconfig.json`'s `include`). Kept
// as a flat union rather than importing the taxonomy's EXCLUSIVE/ATTRIBUTE tier split; the web app
// only needs to color-key a chip by category, not branch on tier.
export type FragmentCategory =
  | 'subject' | 'hair' | 'outfit' | 'pose' | 'expression' | 'props'
  | 'setting' | 'style' | 'palette' | 'lighting' | 'mood';
export interface Fragment { category: FragmentCategory; text: string; source: string; trigger: string }
export interface DatasetMediaItem {
  id: string; url: string; source: 'upload' | 'generation'; actumId?: string; addedAt: string;
  /** Freeform operator labels. Optional: items written before this field existed carry none. */
  tags?: string[];
  /** Freeform operator notes on this item. Optional for the same reason as `tags`. */
  notes?: string;
  /** The item's decomposed prompt fragments (Muse P0), filled out-of-band. Optional and commonly
   *  empty — an item nothing has decomposed yet is a valid, expected state, rendered as an empty
   *  garden, not an error. No live decompose happens from this field. */
  fragments?: Fragment[];
  /** Set when the item has been archived out of the working set. ISO string, as `addedAt` is;
   *  absent means live, including on an item written before the field existed. The item stays
   *  on the record so its caption and its fragments survive a restore, so this side is what
   *  stops rendering and counting it. */
  archivum?: string;
}
export interface DatasetVersionView { v: string; count: number; when: string }

// ── Muse sessions ──────────────────────────────────────────────────────────
// A session is a break-off of a dataset with its own fragments, its own floor and
// its own piece ledger; the mother dataset is never written to by it. These types
// mirror the surface's `MuseSessionView` (the Muse schemas in `apiContract.ts`) —
// `natum`/`mutatum` arrive as ISO strings on the wire, exactly as `Dataset`'s do.
//
// `floor` is an ENTRY ARRAY, not an object keyed by fragment: a fragment's identity
// is `category:text`, which is free text and is not usable as a field name. A
// fragment is likewise named by `{category, text}` in every request BODY rather than
// in a path segment, for the same reason.
export type MuseReaction = 'up' | 'down' | 'note';
/** One fragment's state on the session floor. `enabled: false` is out of the draw, not gone. */
export interface MuseFloorEntry { key: string; enabled: boolean; weight: number }
/** One recorded piece and the lineage that produced it. */
export interface MusePiece {
  runId: string;
  rollIndex: number;
  fragments: Fragment[];
  reaction?: MuseReaction;
  saved: boolean;
  dismissed: boolean;
}
/** One model on the session's stored stack. An absent `weight` is the model's own default. */
export interface MuseNozzleEntry {
  intellaId: string;
  nomen: string;
  trigger: string;
  weight?: number;
}
/**
 * What the session fires its draw THROUGH — the flow, the run shape, the model stack and
 * the standing affix. Mirrors `src/crystal/muse/session.ts#MuseSetup`.
 *
 * THERE IS NO ACKNOWLEDGEMENT FIELD AND THERE IS NO VIEW STATE, on purpose. An
 * infinite-mode acknowledgement is consent for one sitting, so it is never sent and never
 * restored; which controls were folded is this screen's business and not the server's.
 */
export interface MuseSetup {
  modusId?: string;
  mode?: 'batched' | 'infinite';
  cap?: number;
  nozzle?: MuseNozzleEntry[];
  prefix?: string;
  suffix?: string;
}
/**
 * One roll the user kept — the prompt as it stood, and its paid/free verdict.
 *
 * Two fields and no more. The verdict is stored because it cannot be recomputed later:
 * whether a prompt fires as a paid run depends on what it drew and what it was rolled
 * against, and both of those move while the kept roll stays as it was.
 */
export interface MuseKeptRoll { prompt: string; paid: boolean }
export interface MuseSessionView {
  id: string;
  owner: string;
  motherDatasetId: string;
  /** The session's own dataset, where its saved pieces land. Absent until the first save. */
  sessionDatasetId?: string;
  fragments: Fragment[];
  floor: MuseFloorEntry[];
  pieces: MusePiece[];
  /** What the session fires its draw through. Absent until a setup is committed. */
  setup?: MuseSetup;
  /** The rolls kept in this session, oldest first. Always sent — none kept is an empty list. */
  keptRolls: MuseKeptRoll[];
  natum: string;
  mutatum: string;
}
/** A fragment as a request body names it: by its identity, never by position. */
export interface MuseFragmentIdentity { category: FragmentCategory; text: string }
/**
 * What a steer PROPOSES — and only proposes. Mirrors `src/crystal/muse/steer.ts#SteerProposal`
 * the same way the shapes above mirror the session schemas.
 *
 * Nothing in it has been applied. `eliminations` name fragments the floor holds and the
 * instruction would take out of the draw; `additions` are fragments that are not on the
 * floor and would join it; `dropped` is how many of the model's proposed changes did not
 * survive server-side validation, reported rather than swallowed so a shorter list is not
 * mistaken for the whole answer. The proposal is not stored anywhere — it lives for as
 * long as the sheet rendering it is open.
 */
export interface MuseSteerProposal {
  eliminations: MuseFragmentIdentity[];
  additions: Fragment[];
  dropped: number;
}
/** What is recorded at fire time. A reaction is attached afterwards — see `updateMusePiece`. */
export interface MusePieceRecord {
  runId: string;
  rollIndex: number;
  fragments: MuseFragmentIdentity[];
}
export interface Dataset {
  id: string;
  owner: string;
  name: string;
  modality: DatasetModality;
  custody: DatasetCustody;
  media: DatasetMediaItem[];
  captionsets: DatasetCaptionset[];
  versions: DatasetVersionView[];
  natum: string;
  mutatum: string;
  /** Set when the set has been archived. Absent means live. An archived set is gone from both
   *  list routes, so it arrives here only as the response to an archive — which is what keeps
   *  the undo reachable on the screen that did it. */
  archivum?: string;
  /** Present with kind 'public' once published (setDatasetAccess) — listed in the catalog and
   *  readable/Muse-able by anyone. Absent means owner/team-only, the behaviour every dataset
   *  had before publishing existed. */
  access?: { kind: 'public' | 'private' };
}
// The body `POST /v1/data/datasets/:id/media` takes — the same discriminated ingestion
// shape as creation, minus the fields that only make sense when minting a set.
export type AddDatasetMediaRequest =
  | { source: 'upload'; mediaUrls: string[] }
  | { source: 'generation'; actumIds: string[] };
export type CreateDatasetRequest =
  | { source: 'upload'; name: string; modality: DatasetModality; custody?: DatasetCustody; mediaUrls: string[] }
  | { source: 'generation'; name: string; modality: DatasetModality; custody?: DatasetCustody; actumIds: string[] };

// An owned model (GET /v1/me/models) — mirrors the backend ModelCard. Imports + trained
// LoRAs, owner-scoped. No royalty/run economics exist server-side yet.
// Orderings GET /v1/models accepts (mirrors CrystalApi's CatalogSort — the web app doesn't
// import backend source). Anything else the server normalises back to 'newest'.
export type CatalogSort = 'newest' | 'name' | 'genus';

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
  slug?: string;
  defaultWeight?: number;
  samples?: Array<{ url: string; prompt?: string }>;
  tags?: Array<{ tag: string; source?: string }>;
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
  /** The user's working note on what this collection is. */
  descriptio?: string;
  status: CollectionStatus;
  /** `''` on a draft that has not picked its base flow yet (so is `provenanceHash`). */
  modusId: string;
  total: number;
  provenanceHash: string;
  owners?: Array<{ animaId: string; weight: number }>;
  tractus?: Tractus[];
  /** The base prompt as authored. It selects how traits reach the prompt, for the prompt
   *  as a whole: one containing `{{` anywhere is in token mode (a `{{porta}}` is replaced
   *  in place; an axis with no token of its own reaches the prompt not at all), any other
   *  is in join mode (fragments appended in axis order). See `axisSplice`. */
  basePrompt?: string;
  reviewEnabled?: boolean;
  // Dispatching new pieces is held (in-flight pieces still finish). Present + true only
  // while paused — absent means running normally. Survives a server restart.
  paused?: boolean;
  // Acta dispatched but not yet settled (provisioning/executing). Only populated on the
  // single-collection GET (the run screen's poll target), not on the list endpoint.
  inFlight?: number;
  // Pieces generated and parked for a reviewer's decision — real work, not yet in
  // `completed`. Approving one moves it to `completed`, rejecting one to `rejected`.
  // Optional here only because an older server payload may omit it.
  pendingReview?: number;
  // Pieces generated AND accepted — approved when review is on, every success when it is
  // off. `completed + pendingReview + failed + inFlight + outstanding === total`.
  completed: number;
  failed: number;
  // Generated, then declined by a reviewer — a replacement is dispatched for it.
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
// Creating a collection is a naming act: only the name is really needed. The generative
// config (`modusId` / `total` / `tractus`) is optional on a `draft` — the draft learns it
// later via `patchCollectionDraft`. A NON-draft create still requires all three server-side.
export interface CreateCollectionRequest {
  modusId?: string;
  total?: number;
  tractus?: Tractus[];
  nomen?: string;
  descriptio?: string;
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

// The caller's B2B partner record (GET /v1/me/partner) — mirrors the backend's `Partner`
// (src/types/partner.ts) as a local interface, same convention as `MeStatus`/`SettledRun`
// above (the web app doesn't import backend source). A "partner" is just an ordinary account
// a platform admin has approved — no on-chain agent/treasury concept.
export type PartnerStatus = 'active' | 'revoked';
export interface Partner {
  animaId: string;
  status: PartnerStatus;
  org?: string;
  contactEmail?: string;
  sourceRequestId: string;
  natum: string;
}

// A B2B partner-program intake request (POST /v1/partner-requests, admin-reviewed via
// GET/PATCH /v1/admin/partner-requests) — mirrors the backend's `PartnerRequest`
// (src/types/partnerRequest.ts) as a local interface, same convention as `Partner` above.
// `animaId` is present ONLY when the submitter had a resolvable session at submission time;
// its absence means approval can only flip `status` — no Partner record or API key is minted.
export type PartnerRequestStatus = 'pending' | 'approved' | 'declined';
export interface PartnerRequest {
  id: string;
  nomen?: string;
  org?: string;
  contactEmail: string;
  animaId?: string;
  useCase: string;
  notes?: string;
  status: PartnerRequestStatus;
  natum: string;
  decidedAt?: string;
  decidedBy?: string;
}

// The caller's own application as GET /v1/me/partner-request returns it. Deliberately NOT
// `PartnerRequest`: that is the admin queue's row, and the applicant's read omits `emailKey`
// (an internal rate-limit index), `decidedBy` (the deciding admin) and `animaId` (always the
// caller's own here, so it says nothing).
export interface OwnPartnerRequest {
  id: string;
  status: PartnerRequestStatus;
  useCase: string;
  contactEmail: string;
  nomen?: string;
  org?: string;
  notes?: string;
  natum: string;
  decidedAt?: string;
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

// ActivityKind/Status/Door/Row/Page mirror the backend's activity read (allocutio/api/types.ts)
// as local literal types/interfaces — the web app doesn't import backend source, same convention
// as `CanonVerb` above. What a run produced (`generation` is the catch-all).
export type ActivityKind = 'training' | 'caption' | 'decompose' | 'generation';
// In-flight, or settled successfully.
export type ActivityStatus = 'running' | 'settled';
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
  door?: ActivityDoor;
}
// A page of the owner's activity — in-flight and settled runs, newest first. In-flight rows
// ride the first page only; `nextCursor` walks settled history.
export interface ActivityPage {
  activity: ActivityRow[];
  nextCursor?: string;
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
// A displayable credit pack (GET /v1/payments/packs) — mirrors the backend PackView. Display only:
// `credits` = impetus/10; the charged/credited amount stays server-authoritative by `id` (packId).
export interface Pack {
  id: string;
  usd: number;
  credits: number;
  label: string;
  bestRate?: boolean;
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
  status: 'detectum' | 'confirmatum' | 'processatum' | 'praesolutum' | 'fractum';
  natum: string;
}
