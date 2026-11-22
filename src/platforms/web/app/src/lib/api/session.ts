// Identity: the anonymous commitment, the active Vault purse, and the multi-account
// (JWT) session store — plus the two header builders every other concern module calls
// to attach whichever identity applies. Platform-neutral, no fetches of its own.

// Anonymous self-asserting spend identity (arcanum commitment). Stable per browser session.
// For quotes it just identifies the caller; real spend is validated downstream against a funded note.
export function commitment(): string {
  try {
    let c = localStorage.getItem('noema-commitment');
    if (!c) {
      const b = new Uint8Array(24);
      crypto.getRandomValues(b);
      c = '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('noema-commitment', c);
    }
    return c;
  } catch (err) {
    // Blocked/throwing localStorage (private mode, quota, a hardened browser setting) —
    // the class of failure that otherwise never reaches the server. One anon commitment
    // per call is a worse experience than a persisted one, but it keeps the app usable
    // instead of crashing every anon-capable screen.
    reportClientError(`commitment(): localStorage unavailable — ${String(err)}`);
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    return '0x' + Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
}

// ── Active Arcanum purse — the anonymous bearer token runs spend from ────────
// A Vault-minted purse the user has chosen to pay with. Distinct from every other
// identity path: when set, createRun() sends it as `x-bursa-token`. Single active
// pointer (localStorage `noema-active-purse`); Vault's "use this purse" sets it, and
// the Card run surface shows a "paying with purse …" indicator + a clear affordance.
const ACTIVE_PURSE_KEY = 'noema-active-purse';
export function setActivePurse(token: string | null): void {
  try {
    if (token) localStorage.setItem(ACTIVE_PURSE_KEY, token);
    else localStorage.removeItem(ACTIVE_PURSE_KEY);
  } catch (err) {
    reportClientError(`setActivePurse(): localStorage unavailable — ${String(err)}`);
  }
}
export function getActivePurse(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PURSE_KEY);
  } catch (err) {
    reportClientError(`getActivePurse(): localStorage unavailable — ${String(err)}`);
    return null;
  }
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
function writeStore(s: SessionStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (err) {
    // Blocked localStorage means a sign-in cannot persist past this page load — degraded,
    // but the caller's in-memory `next` still renders correctly for the current render, and
    // the failure is now visible server-side instead of silently eating the session.
    reportClientError(`writeStore(): localStorage unavailable — ${String(err)}`);
  }
}

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

// Forget one held account on this browser. When it was the active one, the last remaining
// account takes over (or null → anon); when it was not, the active pointer is untouched.
// Returns the new store.
export function dropAccount(animaId: string | null): SessionStore {
  const s = readStore();
  const rest = s.accounts.filter((a) => a.animaId !== animaId);
  const activeAnimaId = s.activeAnimaId === animaId ? (rest[rest.length - 1]?.animaId ?? null) : s.activeAnimaId;
  const next: SessionStore = { accounts: rest, activeAnimaId };
  writeStore(next);
  return next;
}

// Drop the active account; activate the next remaining (or null → anon). Returns the new store.
export function dropActiveAccount(): SessionStore {
  return dropAccount(readStore().activeAnimaId);
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
export const authHeaders = (): Record<string, string> => {
  const s = getSession();
  return { 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s}` } : { 'x-commitment': commitment() }) };
};
// Read headers (GET): bearer if signed in, else the anon commitment (no content-type).
export const readHeaders = (): Record<string, string> =>
  getSession() ? { authorization: `Bearer ${getSession()}` } : { 'x-commitment': commitment() };

// noema/user-behaviour-corpus: the non-run visitor events the behaviour corpus records.
// Mirrors the backend's closed vocabulary (src/analytics/BehaviourEvent.ts) — kept in step
// by hand, same convention as QuerelaKind above.
export type BehaviourEventKind = 'catalog_view' | 'quote' | 'sign_in' | 'funding_attempt';

// noema/user-behaviour-corpus clause 4: the web client reports its OWN errors, so a
// failure that never reaches the server (e.g. blocked localStorage throwing during a
// read/write above, or a render error the ErrorBoundary catches) is visible. Fire-and-forget
// by design — a telemetry call must never itself throw or block the caller. Reuses the
// existing Querela ("report an issue") store rather than a parallel channel: a `bug`
// report with `clientError` set and no user-typed description.
export function reportClientError(message: string, route?: string): void {
  try {
    fetch('/v1/reports', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        kind: 'bug',
        description: 'Automatically captured client error',
        capturedState: { route: route ?? window.location?.pathname },
        clientError: message.slice(0, 2000),
        userAgent: navigator.userAgent,
      }),
    }).catch(() => { /* best-effort — a failed error report is not itself reported */ });
  } catch {
    /* authHeaders()/fetch threw synchronously — nothing more to do */
  }
}

// noema/user-behaviour-corpus clauses 2/3: records one non-run visitor event, keyed on
// the identity `authHeaders()` already attaches (bearer if signed in, else the anon
// commitment) — never a new identity scheme. Fire-and-forget: a dropped behaviour event
// must never block or fail the screen that triggered it. The server derives the device
// bucket from the request's own User-Agent header; nothing about the device is sent here.
export function recordEvent(kind: BehaviourEventKind, meta: Record<string, string> = {}): void {
  try {
    fetch('/v1/events', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ kind, ...meta }),
    }).catch(() => { /* best-effort */ });
  } catch {
    /* nothing more to do */
  }
}
