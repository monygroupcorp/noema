import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { PROJECTS, type Project } from '../lib/projects';

// The active workspace lens. Selected once (rail switcher), read everywhere — chat, cards,
// canvas, and space all scope to it. Sibling to the identity/execution session state.
interface ProjectCtx {
  project: Project;
  projects: Project[];
  setProject: (id: string) => void;
}

const Ctx = createContext<ProjectCtx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<string>(() => localStorage.getItem('noema-project') || 'personal');
  const project = PROJECTS.find((p) => p.id === id) ?? PROJECTS[0];
  useEffect(() => { localStorage.setItem('noema-project', project.id); }, [project.id]);
  return <Ctx.Provider value={{ project, projects: PROJECTS, setProject: setId }}>{children}</Ctx.Provider>;
}

export function useProject() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProject must be used within ProjectProvider');
  return v;
}
