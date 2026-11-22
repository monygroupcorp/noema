import { j, withReadTimeout } from './core';
import { authHeaders, readHeaders } from './session';

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

const collectionsApi = {
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
  // Deadlined: every collection screen renders "Loading…" until this read answers, so a read
  // that never answers is a screen with no way out. See `withReadTimeout`.
  getCollection: (id: string) => withReadTimeout((signal) =>
    fetch(`/v1/collectiones/${id}`, { headers: readHeaders(), signal }).then(j<{ collection: Collection }>)),
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
};

export default collectionsApi;

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
    const page = await collectionsApi.listCollections(cursor ? { cursor } : {});
    out.push(...page.collections);
    if (!page.nextCursor || !page.collections.length || seen.has(page.nextCursor)) return out;
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}
