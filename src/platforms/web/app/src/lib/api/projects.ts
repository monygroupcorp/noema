import { j } from './core';
import { authHeaders, readHeaders } from './session';

// A project (Provincia) as the server sees it — GET/POST /v1/me/projects. The durable,
// account-owned backbone: identity + holdings (id references). The web `Project` (lib/projects.ts)
// layers client-local view state (chats/canvases/favorites) on top of this.
export interface RemoteProject {
  id: string;
  owner: string;
  name: string;
  desc?: string;
  glyph?: string;
  color?: string;
  datasetIds: string[];
  modelIds: string[];
  collectionIds: string[];
  teamId?: string;
  createdAt: string;
  updatedAt: string;
}

const projectsApi = {
  // ── Projects (Provincia) — an account-owned workspace lens ───────────────────
  // Owner-scoped; identified accounts only (the anon path keeps a local mock).
  // Holdings are id references (datasetIds/modelIds/collectionIds), never copies.
  listProjects: () => fetch('/v1/me/projects', { headers: readHeaders() }).then(j<{ projects: RemoteProject[] }>),
  createProject: (body: { name: string; desc?: string; glyph?: string; color?: string; teamId?: string }) =>
    fetch('/v1/me/projects', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) }).then(j<{ project: RemoteProject }>),
  updateProject: (id: string, patch: { name?: string; desc?: string; glyph?: string; color?: string; teamId?: string | null }) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch) }).then(j<{ project: RemoteProject }>),
  deleteProject: (id: string) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() }).then((r) => { if (!r.ok) throw new Error(`delete failed: ${r.status}`); }),
  fileAsset: (id: string, kind: 'dataset' | 'model' | 'collection', assetId: string) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}/holdings`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind, assetId }) }).then(j<{ project: RemoteProject }>),
  unfileAsset: (id: string, kind: 'dataset' | 'model' | 'collection', assetId: string) =>
    fetch(`/v1/me/projects/${encodeURIComponent(id)}/holdings/${kind}/${encodeURIComponent(assetId)}`, { method: 'DELETE', headers: authHeaders() }).then(j<{ project: RemoteProject }>),
};

export default projectsApi;
