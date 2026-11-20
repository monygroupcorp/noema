import { j } from './core';
import { authHeaders, readHeaders } from './session';

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

const modelsApi = {
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
};

export default modelsApi;
