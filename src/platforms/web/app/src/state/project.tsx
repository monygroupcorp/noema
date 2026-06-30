import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PROJECTS, type Project } from '../lib/projects';

// The active workspace lens. Selected once (rail switcher), read everywhere — chat, cards,
// canvas, and space all scope to it. Sibling to the identity/execution session state.
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

const PROJECTS_KEY = 'noema-projects';
const COLORS = ['#5b8cff', '#5fd0a8', '#d66f9a', '#c79a4e', '#9aa3b8', '#7e8cf0'];

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v) && v.length) return v as Project[]; }
  } catch { /* fall through to seed */ }
  return PROJECTS;
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [id, setId] = useState<string>(() => localStorage.getItem('noema-project') || 'personal');

  useEffect(() => { localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects)); }, [projects]);

  const project = useMemo(() => projects.find((p) => p.id === id) ?? projects[0], [projects, id]);
  useEffect(() => { if (project) localStorage.setItem('noema-project', project.id); }, [project]);

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
