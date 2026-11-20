import { j, jApi } from './core';
import { authHeaders, readHeaders } from './session';

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

const pursesApi = {
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
};

export default pursesApi;
