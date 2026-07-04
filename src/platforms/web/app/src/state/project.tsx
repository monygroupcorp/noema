import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PROJECTS, type Project } from '../lib/projects';
import { useSession } from './session';

// The active workspace lens. Selected once (rail switcher), read everywhere — chat, cards,
// canvas, and space all scope to it. Sibling to the identity/execution session state.
//
// MULTI-ACCOUNT (Keyring Decision 6): projects are the per-account ownership boundary, so
// their localStorage keys are NAMESPACED by the active animaId (`noema-<scope>-projects` /
// `noema-<scope>-project`). Switching accounts swaps the whole workspace; the anon path uses
// the 'anon' scope. THIS IS THE SEAM Projects·Holdings consumes — its ownership unit is the
// account. Legacy un-namespaced keys are read as a one-time seed fallback (non-destructive).
//
// TODO(backend: project persistence) — projects live in localStorage only; there is no
// projects backend yet. The whole list is seeded from PROJECTS on first run, then persisted
// locally. Swap to a /v1 store when one exists (it is also the unit of sharing → server-side).
interface NewProject { name: string; desc?: string; glyph?: string; color?: string }
interface ProjectCtx {
  project: Project;
  projects: Project[];
  setProject: (id: string) => void;
  addProject: (input: NewProject) => Project;
}

const Ctx = createContext<ProjectCtx | null>(null);

const COLORS = ['#5b8cff', '#5fd0a8', '#d66f9a', '#c79a4e', '#9aa3b8', '#7e8cf0'];
const projectsKey = (scope: string) => `noema-${scope}-projects`;
const activeKey = (scope: string) => `noema-${scope}-project`;

function loadProjects(scope: string): Project[] {
  try {
    const raw = localStorage.getItem(projectsKey(scope)) ?? localStorage.getItem('noema-projects');
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v) && v.length) return v as Project[]; }
  } catch { /* fall through to seed */ }
  return PROJECTS;
}
const loadActiveId = (scope: string): string =>
  localStorage.getItem(activeKey(scope)) ?? localStorage.getItem('noema-project') ?? 'personal';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { activeAnimaId } = useSession();
  const scope = activeAnimaId ?? 'anon';

  const [projects, setProjects] = useState<Project[]>(() => loadProjects(scope));
  const [id, setId] = useState<string>(() => loadActiveId(scope));
  // On account switch, re-hydrate the whole workspace from the new scope. The render-time
  // state sync (React's "adjust state on prop change" pattern) keeps projects/id consistent
  // with `scope` BEFORE commit, so the persist effects below never write one scope into another.
  const [loadedScope, setLoadedScope] = useState<string>(scope);
  if (loadedScope !== scope) {
    setLoadedScope(scope);
    setProjects(loadProjects(scope));
    setId(loadActiveId(scope));
  }

  useEffect(() => { localStorage.setItem(projectsKey(scope), JSON.stringify(projects)); }, [projects, scope]);

  const project = useMemo(() => projects.find((p) => p.id === id) ?? projects[0], [projects, id]);
  useEffect(() => { if (project) localStorage.setItem(activeKey(scope), project.id); }, [project, scope]);

  const addProject = (input: NewProject): Project => {
    const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
    const id = projects.some((p) => p.id === slug) ? `${slug}-${projects.length}` : slug;
    const next: Project = {
      id,
      name: input.name.trim(),
      glyph: input.glyph || input.name.trim().charAt(0).toUpperCase() || '◇',
      color: input.color || COLORS[projects.length % COLORS.length],
      desc: input.desc?.trim() || '',
      updated: 'just now',
      chats: [], cards: [], canvases: [], gens: 0,
    };
    setProjects((ps) => [...ps, next]);
    setId(id);
    return next;
  };

  return <Ctx.Provider value={{ project, projects, setProject: setId, addProject }}>{children}</Ctx.Provider>;
}

export function useProject() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProject must be used within ProjectProvider');
  return v;
}
