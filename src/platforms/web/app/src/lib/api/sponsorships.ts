import { j } from './core';
import { authHeaders, readHeaders } from './session';

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

const sponsorshipsApi = {
  // ── Sponsorships (Sponsio, ADR-0011 §2) — a standing capped top-up pledge ────
  // Identified accounts only (401 for anon/purse). Mounted at /v1/sponsorships.
  listSponsorships: () => fetch('/v1/sponsorships', { headers: readHeaders() }).then(j<{ sponsorships: Sponsorship[] }>),
  createSponsorship: (body: { beneficiaryAnimaId: string; grant: string; cadence: SubsidyCadence; balanceCap?: string; capTotal?: string }) =>
    fetch('/v1/sponsorships', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<{ sponsorship: Sponsorship }>),
  pauseSponsorship: (id: string) =>
    fetch(`/v1/sponsorships/${encodeURIComponent(id)}/pause`, { method: 'POST', headers: authHeaders() }).then(j<{ sponsorship: Sponsorship }>),
  resumeSponsorship: (id: string) =>
    fetch(`/v1/sponsorships/${encodeURIComponent(id)}/resume`, { method: 'POST', headers: authHeaders() }).then(j<{ sponsorship: Sponsorship }>),
};

export default sponsorshipsApi;
