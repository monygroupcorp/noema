import { j } from './core';
import { authHeaders, readHeaders } from './session';

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

const studiosApi = {
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
};

export default studiosApi;
