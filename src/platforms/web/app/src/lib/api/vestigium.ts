import { j } from './core';
import { authHeaders, readHeaders } from './session';

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

const vestigiumApi = {
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
};

export default vestigiumApi;
