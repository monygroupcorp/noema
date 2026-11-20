import { jApi } from './core';
import { authHeaders, readHeaders } from './session';

// ── Tabula (canvas workspace, ADR-0008 follow-up) — mirrors types/tabula.ts ──────
export interface TabulaNodus { id: string; modusId: string; x: number; y: number; aditus: Record<string, unknown> }
export interface TabulaVinculum {
  id: string; fonteNodusId: string; fontePorta: string; scopusNodusId: string; scopusPorta: string; discordantia: boolean;
}
export type TabulaVisibility = 'privata' | 'communis' | 'publica';
export type TabulaStatus = 'draft' | 'published' | 'archivata';
export interface Tabula {
  id: string;
  nomen: string;
  descriptio?: string;
  nodi: TabulaNodus[];
  vincula: TabulaVinculum[];
  modusId?: string;
  status: TabulaStatus;
  visibilitas: TabulaVisibility;
  fonteId?: string;
  templateId?: string;
  followTemplate?: boolean;
  natum: string;
  mutatum: string;
}

const tabulaApi = {
  // ── Tabulae (canvas workspaces) — owner-scoped CRUD + publish-to-Modus ───────
  // Anon-capable throughout (commitment-keyed, same as the rest of authoring) —
  // no sign-in required to author or publish a spell.
  listTabulae: () => fetch('/v1/tabulae', { headers: readHeaders() }).then(jApi<{ tabulae: Tabula[] }>),
  createTabula: (body: { nomen: string; descriptio?: string; visibilitas?: TabulaVisibility }) =>
    fetch('/v1/tabulae', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(jApi<{ tabula: Tabula }>),
  getTabula: (id: string) => fetch(`/v1/tabulae/${id}`, { headers: readHeaders() }).then(jApi<{ tabula: Tabula }>),
  updateTabula: (id: string, patch: Partial<Pick<Tabula, 'nomen' | 'descriptio' | 'nodi' | 'vincula' | 'visibilitas'>>) =>
    fetch(`/v1/tabulae/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(patch) })
      .then(jApi<{ tabula: Tabula }>),
  deleteTabula: (id: string) =>
    fetch(`/v1/tabulae/${id}`, { method: 'DELETE', headers: authHeaders() }).then(jApi<{ ok: true }>),
  // Compile the canvas graph into a compositus Modus, immediately runnable via
  // POST /v1/runs. A cycle / port-type-mismatch graph 400s `input.invalid_graph`
  // with `details.{code,vinculumId}` naming the offending wire (errors.ts).
  publishTabula: (id: string) =>
    fetch(`/v1/tabulae/${id}/publish`, { method: 'POST', headers: authHeaders() }).then(jApi<{ modusId: string }>),
};

export default tabulaApi;
