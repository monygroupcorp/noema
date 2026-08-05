import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PROJECTS, fromRemote, type Project } from '../lib/projects';
import { api } from '../lib/api';
import { useSession } from './session';

// The active workspace lens. Selected once (rail switcher), read everywhere — chat, cards,
// canvas, and space all scope to it. Sibling to the identity/execution session state.
//
// MULTI-ACCOUNT + BACKEND (Provincia, /v1/me/projects). For an IDENTIFIED account the server
// is authoritative for the project SET and its holdings (datasetIds/modelIds/collectionIds);
// localStorage keeps the per-project VIEW OVERLAY (chats/cards/canvases/gens — which have no
// backend store yet) plus a fast-paint cache. Keys are NAMESPACED by the active animaId
// (`noema-<scope>-projects` / `noema-<scope>-project`) — switching accounts swaps the whole
// workspace. The ANON path (no animaId) stays local-only, seeded from the PROJECTS mock.
// Legacy un-namespaced keys are read as a one-time seed fallback (non-destructive).
export type HoldingKind = 'dataset' | 'model' | 'collection';
const HOLDING_FIELD: Record<HoldingKind, 'datasetIds' | 'modelIds' | 'collectionIds'> = {
  dataset: 'datasetIds', model: 'modelIds', collection: 'collectionIds',
};

interface NewProject { name: string; desc?: string; glyph?: string; color?: string }
interface ProjectCtx {
  project: Project;
  projects: Project[];
  /** True when the project set is backend-backed (identified account) — the anon path is a local mock. */
  identified: boolean;
  setProject: (id: string) => void;
  addProject: (input: NewProject) => Project;
  /** Rename / re-describe a project (backend-authoritative when identified). */
  renameProject: (projectId: string, patch: { name?: string; desc?: string }) => void;
  /** Delete a project. Clears the active selection if it pointed here, resets the Preferences
   *  "land in" default (generatio.defaultProjectId) if it pointed here, and reseeds a default
   *  Personal project when the last one goes. */
  removeProject: (projectId: string) => void;
  /** File/unfile an asset into a project's holdings (backend-backed when identified). */
  fileAsset: (projectId: string, kind: HoldingKind, assetId: string) => void;
  unfileAsset: (projectId: string, kind: HoldingKind, assetId: string) => void;
  /** Link the active project to a Team (Sodalitas) for its shared member set, or null to unlink
   *  (Decision 6 — a project references a Team; it does not carry its own membership). */
  linkTeam: (projectId: string, teamId: string | null) => void;
}

const Ctx = createContext<ProjectCtx | null>(null);

const COLORS = ['#5b8cff', '#5fd0a8', '#d66f9a', '#c79a4e', '#9aa3b8', '#7e8cf0'];
const projectsKey = (scope: string) => `noema-${scope}-projects`;
const activeKey = (scope: string) => `noema-${scope}-project`;

// The client-local view overlay carried across a backend reconcile.
type Overlay = Partial<Pick<Project, 'chats' | 'cards' | 'canvases' | 'gens' | 'shared'>>;
const overlayOf = (p?: Project): Overlay =>
  p ? { chats: p.chats, cards: p.cards, canvases: p.canvases, gens: p.gens, ...(p.shared !== undefined ? { shared: p.shared } : {}) } : {};

// Defend against pre-holdings cached JSON: hydrate the required holding arrays.
const normalize = (p: Project): Project => ({
  ...p,
  datasetIds: p.datasetIds ?? [],
  modelIds: p.modelIds ?? [],
  collectionIds: p.collectionIds ?? [],
});

/** Cached project list for a scope, or null if none is stored (no mock fallback here). */
function cachedProjects(scope: string): Project[] | null {
  try {
    const raw = localStorage.getItem(projectsKey(scope)) ?? localStorage.getItem('noema-projects');
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v) && v.length) return (v as Project[]).map(normalize); }
  } catch { /* fall through */ }
  return null;
}

// A single local "Personal" placeholder so an identified account always has an active project
// during the brief window before the backend list arrives (the reconcile then replaces it,
// creating the real Personal server-side if the account is empty). Avoids a demo-project splash.
const placeholderPersonal = (): Project => ({
  id: 'personal', name: 'Personal', glyph: '◇', color: '#9aa3b8',
  desc: 'Your default space — anything not filed into a project lands here.',
  updated: 'just now', chats: [], cards: [], canvases: [], gens: 0,
  datasetIds: [], modelIds: [], collectionIds: [],
});

// Initial paint: cached list if present; else the mock for anon, a lone placeholder for
// identified (the backend fetch fills it — showing demo projects to a real account would lie).
const initialProjects = (scope: string, identified: boolean): Project[] =>
  cachedProjects(scope) ?? (identified ? [placeholderPersonal()] : PROJECTS.map(normalize));
const loadActiveId = (scope: string): string =>
  localStorage.getItem(activeKey(scope)) ?? localStorage.getItem('noema-project') ?? 'personal';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { activeAnimaId } = useSession();
  const scope = activeAnimaId ?? 'anon';
  const identified = activeAnimaId != null;

  const [projects, setProjects] = useState<Project[]>(() => initialProjects(scope, identified));
  const [id, setId] = useState<string>(() => loadActiveId(scope));
  // On account switch, re-hydrate the whole workspace from the new scope. The render-time
  // state sync (React's "adjust state on prop change" pattern) keeps projects/id consistent
  // with `scope` BEFORE commit, so the persist effects below never write one scope into another.
  const [loadedScope, setLoadedScope] = useState<string>(scope);
  if (loadedScope !== scope) {
    setLoadedScope(scope);
    setProjects(initialProjects(scope, identified));
    setId(loadActiveId(scope));
  }

  // Backend reconcile (identified only): the server owns the project set + holdings; the
  // local cache supplies the view overlay. On an empty account, seed a default "Personal"
  // project so there is always an active workspace.
  useEffect(() => {
    if (!identified) return;
    let live = true;
    (async () => {
      try {
        let { projects: remote } = await api.listProjects();
        if (!live) return;
        if (remote.length === 0) {
          const { project } = await api.createProject({
            name: 'Personal', glyph: '◇', color: '#9aa3b8',
            desc: 'Your default space — anything not filed into a project lands here.',
          });
          remote = [project];
        }
        if (!live) return;
        setProjects((cache) => remote.map((r) => fromRemote(r, overlayOf(cache.find((p) => p.id === r.id)))));
        setId((cur) => (remote.some((r) => r.id === cur) ? cur : remote[0].id));
      } catch { /* offline / not-yet-authed — keep the cached paint */ }
    })();
    return () => { live = false; };
  }, [identified, scope]);

  useEffect(() => { localStorage.setItem(projectsKey(scope), JSON.stringify(projects)); }, [projects, scope]);

  const project = useMemo(() => projects.find((p) => p.id === id) ?? projects[0], [projects, id]);
  useEffect(() => { if (project) localStorage.setItem(activeKey(scope), project.id); }, [project, scope]);

  const addProject = (input: NewProject): Project => {
    const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
    const localId = projects.some((p) => p.id === slug) ? `${slug}-${projects.length}` : slug;
    const next: Project = {
      id: localId,
      name: input.name.trim(),
      glyph: input.glyph || input.name.trim().charAt(0).toUpperCase() || '◇',
      color: input.color || COLORS[projects.length % COLORS.length],
      desc: input.desc?.trim() || '',
      updated: 'just now',
      chats: [], cards: [], canvases: [], gens: 0,
      datasetIds: [], modelIds: [], collectionIds: [],
    };
    setProjects((ps) => [...ps, next]);
    setId(localId);
    // Identified: persist to the backend and swap the optimistic row for the server's (real id).
    if (identified) {
      api.createProject({ name: next.name, desc: next.desc || undefined, glyph: next.glyph, color: next.color })
        .then(({ project: created }) => {
          setProjects((ps) => ps.map((p) => (p.id === localId ? fromRemote(created, overlayOf(p)) : p)));
          setId((cur) => (cur === localId ? created.id : cur));
        })
        .catch(() => { /* keep the optimistic local project on failure */ });
    }
    return next;
  };

  // Holdings edits — optimistic local update on the named project + backend write when identified.
  const patchHoldings = (projectId: string, kind: HoldingKind, assetId: string, add: boolean) => {
    const field = HOLDING_FIELD[kind];
    setProjects((ps) => ps.map((p) => {
      if (p.id !== projectId) return p;
      const list = p[field];
      const has = list.includes(assetId);
      if (add ? has : !has) return p;
      return { ...p, [field]: add ? [...list, assetId] : list.filter((x) => x !== assetId) };
    }));
    if (identified) {
      const call = add ? api.fileAsset(projectId, kind, assetId) : api.unfileAsset(projectId, kind, assetId);
      call.then(({ project: updated }) => {
        setProjects((ps) => ps.map((p) => (p.id === updated.id ? fromRemote(updated, overlayOf(p)) : p)));
      }).catch(() => { /* keep the optimistic edit on failure */ });
    }
  };
  const fileAsset = (projectId: string, kind: HoldingKind, assetId: string) => patchHoldings(projectId, kind, assetId, true);
  const unfileAsset = (projectId: string, kind: HoldingKind, assetId: string) => patchHoldings(projectId, kind, assetId, false);

  // Rename / re-describe — optimistic local edit + backend write when identified (same
  // pattern as linkTeam; the server reply reconciles identity + holdings).
  const renameProject = (projectId: string, patch: { name?: string; desc?: string }) => {
    setProjects((ps) => ps.map((p) => (p.id === projectId ? { ...p, ...patch } : p)));
    if (identified) {
      api.updateProject(projectId, patch)
        .then(({ project: updated }) => setProjects((ps) => ps.map((p) => (p.id === updated.id ? fromRemote(updated, overlayOf(p)) : p))))
        .catch(() => { /* keep the optimistic edit on failure */ });
    }
  };

  // Delete — optimistic local removal + backend delete when identified. Guards:
  //  · active project: if the deleted project was scoped, fall to the first remaining;
  //  · last project: reseed a default Personal (server-side when identified) so there is
  //    always an active workspace;
  //  · Preferences default: if generatio.defaultProjectId pointed here, reset it to none
  //    (full-object PUT — a partial would wipe the other generatio fields).
  const removeProject = (projectId: string) => {
    const remaining = projects.filter((p) => p.id !== projectId);
    const next = remaining.length ? remaining : [placeholderPersonal()];
    setProjects(next);
    setId((cur) => (cur === projectId ? next[0].id : cur));
    api.getMe().then((m) => {
      if (m.generatio?.defaultProjectId === projectId) {
        const { defaultProjectId: _drop, ...rest } = m.generatio;
        return api.setGeneratio(rest).then(() => undefined);
      }
    }).catch(() => { /* anon / offline — nothing to reset */ });
    if (identified) {
      api.deleteProject(projectId).catch(() => { /* keep the optimistic removal */ });
      if (remaining.length === 0) {
        // Mirror the empty-account reconcile: create the real Personal server-side and
        // swap the local placeholder for it.
        api.createProject({
          name: 'Personal', glyph: '◇', color: '#9aa3b8',
          desc: 'Your default space — anything not filed into a project lands here.',
        }).then(({ project: created }) => {
          setProjects((ps) => ps.map((p) => (p.id === 'personal' ? fromRemote(created, overlayOf(p)) : p)));
          setId((cur) => (cur === 'personal' ? created.id : cur));
        }).catch(() => { /* keep the local placeholder */ });
      }
    }
  };

  const linkTeam = (projectId: string, teamId: string | null) => {
    setProjects((ps) => ps.map((p) => (p.id === projectId ? { ...p, ...(teamId ? { teamId } : { teamId: undefined }) } : p)));
    if (identified) {
      api.updateProject(projectId, { teamId })
        .then(({ project: updated }) => setProjects((ps) => ps.map((p) => (p.id === updated.id ? fromRemote(updated, overlayOf(p)) : p))))
        .catch(() => { /* keep the optimistic edit on failure */ });
    }
  };

  return <Ctx.Provider value={{ project, projects, identified, setProject: setId, addProject, renameProject, removeProject, fileAsset, unfileAsset, linkTeam }}>{children}</Ctx.Provider>;
}

export function useProject() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProject must be used within ProjectProvider');
  return v;
}

// Resolve a `?project=<id>` scope (the id from the caller's useSearchParams) to the matching
// Project, or null when unscoped/unknown. Kept here so the canonical asset surfaces
// (Datasets/Shelf/Collections) don't each re-derive the seam.
export function useProjectScope(projectId: string | null): Project | null {
  const { projects } = useProject();
  return useMemo(() => (projectId ? projects.find((p) => p.id === projectId) ?? null : null), [projectId, projects]);
}
