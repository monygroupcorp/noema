import { jApi, namedOnly } from './core';
import { authHeaders, readHeaders } from './session';

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
  billing?: PartnerBilling;
}

/** Where a partner's invoices go and on what terms they are due. */
export interface PartnerBilling {
  billingEmail: string;
  billedTo: string;
  netDays: number;
  setAt: string;
}

/** GET /v1/me/partner/contract — which agreement is current, and where this account stands on it. */
export interface PartnerContractState {
  version: string;
  path: string;
  signed: boolean;
  signedAt?: string;
  signerName?: string;
  signedVersions: string[];
}

/** One metered API call, as the caller's own meter reports it. */
export interface PartnerUsageCall {
  actumId: string;
  keyPrefix: string;
  modusId: string;
  calledAt: string;
  settledAt?: string;
  impetus?: string;
  durationMs?: number;
  modusLabel?: string;
  models?: string[];
  voidedAt?: string;
}

export interface PartnerUsageRollup {
  calls: number;
  impetus: string;
  lines: Array<{ modusId: string; modusLabel: string; calls: number; impetus: string }>;
}

export interface PartnerUsageView {
  from: string;
  to: string;
  rollup: PartnerUsageRollup;
  calls: PartnerUsageCall[];
}

export type PartnerInvoiceStatus = 'open' | 'paid' | 'void';

/** One billing period, priced and issued. `usdMicro` is micro-USD as a string ($1 = 1000000). */
export interface PartnerInvoice {
  id: string;
  billedTo: string;
  billingEmail: string;
  periodStart: string;
  periodEnd: string;
  usage: PartnerUsageRollup;
  usdMicro: string;
  status: PartnerInvoiceStatus;
  issuedAt: string;
  dueAt: string;
  paidAt?: string;
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

const NO_PARTNER = { status: 404, code: 'not_found.partner', message: 'No partner record found for this account' };
const NO_PARTNER_REQUEST = { status: 404, code: 'not_found.partner_request', message: 'No partner request found for this account' };

const partnerApi = {
  // GET /v1/me/partner — the caller's B2B partner record, if any. A "partner" is just an
  // ordinary account a platform admin has approved (no on-chain agent/treasury). Uses `jApi`
  // (not `j`) so a 404 (no/revoked partner) surfaces as a typed `ApiRequestError` the Partner
  // screen can branch on (`err.code === 'not_found.partner'`) instead of a generic message.
  // Named-account only (see namedOnly): without a session the rejection is settled client-side.
  mePartner: () => namedOnly(NO_PARTNER, () => fetch('/v1/me/partner', { headers: readHeaders() }).then(jApi<Partner>)),
  // GET /v1/me/partner-request — the caller's OWN most recent application and its state.
  // The companion to mePartner(): that one reports approval and 404s the same way for someone
  // who never applied, someone under review and someone declined. This one says which.
  // `jApi` again, so the Partner screen can branch on `err.code === 'not_found.partner_request'`
  // (this account has filed nothing) rather than showing an error for a normal state.
  mePartnerRequest: () => namedOnly(NO_PARTNER_REQUEST, () => fetch('/v1/me/partner-request', { headers: readHeaders() }).then(jApi<OwnPartnerRequest>)),
  // POST /v1/me/partner/api-key — self-serve issue-or-rotate, callable ONLY by the partner
  // themselves (never returned from the admin approval route — see adminDecidePartnerRequest's
  // comment below for why). Each call retires any key this same flow issued previously and
  // returns a fresh one; the response is the ONLY time the raw key is ever retrievable.
  rotatePartnerApiKey: () => fetch('/v1/me/partner/api-key', { method: 'POST', headers: authHeaders() }).then(jApi<{ apiKey: string }>),

  // GET /v1/me/partner/contract — the current API Customer Agreement, where to read it, and
  // whether this account has signed it. A key is issued only against a signature on the CURRENT
  // version, so the dashboard asks this before it offers the key button.
  mePartnerContract: () => fetch('/v1/me/partner/contract', { headers: readHeaders() }).then(jApi<PartnerContractState>),
  // POST /v1/me/partner/contract — sign it. The version is sent back deliberately: a signature is
  // an acceptance of the specific text that was displayed, and the server refuses one that names
  // any version but the current, rather than quietly binding the signer to something else.
  signPartnerContract: (body: { version: string; signerName: string; signerTitle?: string }) =>
    fetch('/v1/me/partner/contract', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(jApi<{ version: string; signedAt: string; signerName: string; signerTitle?: string }>),
  // PUT /v1/me/partner/billing — set or replace where invoices go and on what terms they are due.
  // Required before a key is issued: a post-paid customer with nowhere to send the invoice is
  // generating on credit nobody extended.
  setPartnerBilling: (body: { billingEmail: string; billedTo: string; netDays: number }) =>
    fetch('/v1/me/partner/billing', { method: 'PUT', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(jApi<{ billing: PartnerBilling }>),
  // GET /v1/me/partner/usage — the caller's own meter for a window: the calls its keys made and
  // the rollup an invoice for that window is drawn from. Both bounds are required.
  partnerUsage: (from: string, to: string) =>
    fetch(`/v1/me/partner/usage?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: readHeaders() })
      .then(jApi<PartnerUsageView>),
  // GET /v1/me/partner/invoices — the caller's invoices, newest issued first.
  partnerInvoices: () => fetch('/v1/me/partner/invoices', { headers: readHeaders() }).then(jApi<{ invoices: PartnerInvoice[] }>),
  // POST /v1/me/partner/invoices/:id/checkout — pay one, at the amount the invoice states. NOT the
  // credit-pack checkout: settling an invoice books revenue and credits no spendable balance.
  payPartnerInvoice: (id: string) =>
    fetch(`/v1/me/partner/invoices/${encodeURIComponent(id)}/checkout`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ successUrl: `${window.location.origin}/partner?paid=1`, cancelUrl: `${window.location.origin}/partner` }),
    }).then(jApi<{ url: string; sessionId: string }>),

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
};

export default partnerApi;
