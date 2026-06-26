import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../state/project';
import { counts } from '../lib/projects';
import { Ic } from '../lib/icons';

// The active workspace context, under the brand. Switching it re-scopes chat / cards /
// canvas / space to that project. The "All projects →" link opens the workspace overview.
export function ProjectSwitcher() {
  const { project, projects, setProject } = useProject();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLButtonElement>(null);
  const c = counts(project);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width });
    setOpen((o) => !o);
  }
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest('#projpop') && !t.closest('.projsw')) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="projwrap">
      <button className="projsw" ref={ref} onClick={toggle}>
        <span className="pg" style={{ background: project.color }}>{project.glyph}</span>
        <span className="pn">{project.name}</span>
        {project.shared && <span className="psh" title={`${project.shared} collaborators`}><Ic name="circle-user" />{project.shared}</span>}
        <span className="cv"><Ic name="chevron-down" /></span>
      </button>
      <div className="projmeta mono">{c.chats} chats · {c.cards} cards · {c.canvases} canvases · {c.gens} gens</div>
      {open && (
        <div id="projpop" className="open" style={pos}>
          <div className="pp-l">Switch project</div>
          {projects.map((p) => {
            const pc = counts(p);
            return (
              <button key={p.id} className={`pp-row${p.id === project.id ? ' on' : ''}`} onClick={() => { setProject(p.id); setOpen(false); }}>
                <span className="pg" style={{ background: p.color }}>{p.glyph}</span>
                <span className="pp-main">
                  <span className="nm">{p.name}{p.shared && <span className="psh"><Ic name="circle-user" />{p.shared}</span>}</span>
                  <span className="meta mono">{pc.cards} cards · {pc.gens} gens · {p.updated}</span>
                </span>
                {p.id === project.id && <span className="dot" />}
              </button>
            );
          })}
          <div className="pp-foot">
            <button className="pp-new" onClick={() => { alert('new project (todo)'); setOpen(false); }}><Ic name="plus" /> New project</button>
            <Link className="pp-all" to="/projects" onClick={() => setOpen(false)}>All projects →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
