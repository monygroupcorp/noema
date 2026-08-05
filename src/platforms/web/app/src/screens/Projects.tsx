import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useProject } from '../state/project';
import { counts } from '../lib/projects';
import { Ic } from '../lib/icons';

// The workspace overview. Top: every project as a card (the unit you switch into / share).
// Below: the ACTIVE project as a slice across the four axes — chats, cards, canvases, space.
export function Projects() {
  const { project, projects, setProject, addProject } = useProject();
  const [params] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const create = () => {
    if (!name.trim()) return;
    addProject({ name, desc });           // creates + switches active (persisted locally)
    setName(''); setDesc(''); setCreating(false);
  };

  return (
    <AppShell crumb="projects">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Projects</h1><div className="sub">A project is a shared workspace — its chats, cards, canvases, and its slice of your space, in one context.</div></div>
          <div className="right"><button className="btn" onClick={() => setCreating((v) => !v)}><Ic name="plus" /> New project</button></div>
        </div>

        {creating && (
          <div className="projnew">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Project name" onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }} />
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="What's it for? (optional)" onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }} />
            <button className="btn accent" onClick={create} disabled={!name.trim()}>Create</button>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        )}

        <div className="projgrid">
          {projects.map((p) => {
            const c = counts(p);
            const active = p.id === project.id;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className={`projcard${active ? ' on' : ''}`} onClick={() => setProject(p.id)}>
                <div className="pc-head">
                  <span className="pg" style={{ background: p.color }}>{p.glyph}</span>
                  <b>{p.name}</b>
                  {p.shared && <span className="psh"><Ic name="circle-user" />{p.shared}</span>}
                  {active && <span className="badge accent">active</span>}
                </div>
                <div className="pc-desc">{p.desc}</div>
                <div className="pc-counts mono">{c.chats} chats · {c.cards} cards · {c.canvases} canvases · {c.gens} gens<span className="upd">· {p.updated}</span></div>
              </Link>
            );
          })}
        </div>

        <div className="sectionhead" style={{ marginTop: 'var(--s6)' }}>
          <span className="pg sm" style={{ background: project.color }}>{project.glyph}</span> {project.name} · workspace
        </div>

        <div className="wsgrid">
          <div className="wscol">
            <div className="wshead"><Ic name="message-square" /> Chats <Link to="/chat">open →</Link></div>
            {project.chats.length === 0 ? <div className="wsempty">No chats yet</div> : project.chats.map((ch) => (
              <div className="lrow sm" key={ch.id}><div className="li-main"><div className="t">{ch.title}</div></div><div className="li-right mono">{ch.when}</div></div>
            ))}
          </div>
          <div className="wscol">
            <div className="wshead"><Ic name="sliders-horizontal" /> Saved cards <Link to="/catalog">open →</Link></div>
            {project.cards.length === 0 ? <div className="wsempty">No saved cards</div> : project.cards.map((cd) => (
              <Link className="lrow sm" key={cd.id} to={`/card?id=${cd.id}`}><div className="li-main"><div className="t">{cd.name}</div></div><div className="li-right"><span className="badge accent">{cd.verb}</span></div></Link>
            ))}
          </div>
          <div className="wscol">
            <div className="wshead"><Ic name="workflow" /> Canvases <Link to="/canvas">open →</Link></div>
            {project.canvases.length === 0 ? <div className="wsempty">No canvases yet</div> : project.canvases.map((cv) => (
              <div className="lrow sm" key={cv.id}><div className="li-main"><div className="t">{cv.name}</div></div><div className="li-right mono">{cv.nodes} nodes</div></div>
            ))}
          </div>
          <div className="wscol">
            <div className="wshead"><Ic name="sparkles" /> Space <Link to="/space">open →</Link></div>
            <div className="wsspace">
              <div className="n">{project.gens}</div>
              <div className="s">creations in this project’s slice of your space</div>
              <Link className="tp-manage" to="/space">explore filtered →</Link>
            </div>
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
