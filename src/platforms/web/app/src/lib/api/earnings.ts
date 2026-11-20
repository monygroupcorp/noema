import { j } from './core';
import { readHeaders } from './session';

// What the caller has EARNED (GET /v1/me/earnings) — mirrors the backend's `EarningsView`
// (src/allocutio/api/types.ts) as a local interface, same convention as `MeStatus` above.
// Earnings are money the caller was PAID because someone else ran something: a royalty on
// their flow or their model, a cut of a gen served on their pod, a referral share. Distinct
// from balance — a royalty since spent is still an earning.
export type EarningKind = 'spell-royalty' | 'model-royalty' | 'host-cut' | 'host-bonus' | 'referral';
export interface Earning {
  id: string;
  kind: EarningKind;
  impetus: string; // bigint stringified by the backend
  usd: number;
  earnedAt: string;
  studioId?: string;
}
export interface EarningStream { kind: EarningKind; impetus: string; usd: number; count: number }
export interface EarningsView {
  lifetime: { impetus: string; usd: number };
  streams: EarningStream[];
  earnings: Earning[];
  nextCursor?: string;
}

const earningsApi = {
  // GET /v1/me/earnings — what the caller has been PAID (royalties on their flows and models,
  // host cuts and bonuses, referral shares): the lifetime total, the per-stream breakdown, and
  // a page of the payments. The dashboard's royalties tile reads `lifetime` from here.
  meEarnings: (opts: { cursor?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return fetch(`/v1/me/earnings${qs ? `?${qs}` : ''}`, { headers: readHeaders() }).then(j<EarningsView>);
  },
};

export default earningsApi;
