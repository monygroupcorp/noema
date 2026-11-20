import { j } from './core';
import { readHeaders } from './session';

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

const adminApi = {
  // ── Admin workspace (credits-only, read-only observability) ──────────────────
  // GET /v1/admin/revenue — already-live platform-admin report; no client method existed
  // until the admin workspace hub. GET /v1/admin/cogs — the new read-only COGS pair.
  // Both server-gated regardless of the me.admin UI reveal.
  getRevenueReport: () => fetch('/v1/admin/revenue', { headers: readHeaders() }).then(j<RevenueReport>),
  getCogsReport: () => fetch('/v1/admin/cogs', { headers: readHeaders() }).then(j<CogsReport>),
};

export default adminApi;
