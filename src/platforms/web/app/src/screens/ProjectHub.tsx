import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useProject } from '../state/project';
import { counts } from '../lib/projects';
import { Ic } from '../lib/icons';

// Project hub (project-hub-spec.md, render noema-project-hub.png) — one project's home: a
// tabbed workbench. Overview summarizes the six holdings; the other tabs reuse the canonical
// surfaces scoped to this project (datasets library / model shelf / collections / lists) once
// those are built. Lives in the shell; the top bar shows the breadcrumb.
//
// The mock Project carries chats/canvases/cards/gens; datasets/models/collections seed at 0
// until the project backend carries them. TODO(backend: project holdings + activity).

const QUICK = [
  { to: '/chat', ico: 'message-square', label: 'New chat' },
  { to: '/canvas', ico: 'workflow', label: 'New canvas' },
  { to: '/datasets', ico: 'database', label: 'New dataset' },
  { to: '/datasets', ico: 'graduation-cap', label: 'Train model' },
  { to: '/collections', ico: 'hexagon', label: 'New collection' },
];

export function ProjectHub() {
  const { id } = useParams();
  const { projects } = useProject();
  const p = projects.find((x) => x.id === id) ?? projects[0];
  const c = counts(p);
  const [tab, setTab] = useState('Overview');

  const tabs: { key: string; n?: number }[] = [
    { key: 'Overview' }, { key: 'Chats', n: c.chats }, { key: 'Canvases', n: c.canvases },
    { key: 'Datasets', n: 0 }, { key: 'Models', n: 0 }, { key: 'Collections', n: 0 }, { key: 'Favorites', n: c.cards },
  ];

  const crumb = (
    <span className="ph-crumb">
      <Link to="/app">Home</Link> <span className="sep">/</span> <Link to="/projects">projects</Link> <span className="sep">/</span> <b>{p.name}</b>
    </span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">

        {/* header */}
        <div className="ph-head">
          <div>
            <div className="ph-kick noema-kicker">project</div>
            <h1 className="ph-name">{p.name}</h1>
            <p className="ph-desc">{p.desc || 'No description yet.'}</p>
          </div>
          <div className="ph-people">
            {p.shared ? <span className="ph-avatars">{Array.from({ length: Math.min(p.shared, 3) }).map((_, i) => <span key={i} className="av" style={{ background: p.color }} />)}</span> : null}
            <button className="btn"><Ic name="circle-user" /> share ▸</button>
          </div>
        </div>

        {/* quick-start — genesis actions, created into this project */}
        <div className="ph-quick">
          {QUICK.map((q) => (
            <Link key={q.label} className="qbtn" to={q.to}><Ic name={q.ico} /> {q.label}</Link>
          ))}
        </div>

        {/* tabs */}
        <div className="ph-tabs">
          {tabs.map((t) => (
            <button key={t.key} className={`ph-tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>
              {t.key}{t.n != null && <span className="tn">{t.n}</span>}
            </button>
          ))}
        </div>

        {tab === 'Overview' ? (
          <>
            <div className="ph-overview">
              <HoldingCard ico="database" name="Datasets" n={0} foot="no datasets yet" onTo={() => setTab('Datasets')}>
                <div className="hc-empty">the core asset — start one to train from</div>
              </HoldingCard>
              <HoldingCard ico="box" name="Models" n={0} foot={<span className="gold"><span className="gem">◈</span> — royalties</span>} onTo={() => setTab('Models')}>
                <div className="hc-empty">trained LoRAs land on the shelf</div>
              </HoldingCard>
              <HoldingCard ico="hexagon" name="Collections" n={0} foot="0 minted · 0 draft" onTo={() => setTab('Collections')}>
                <div className="hc-empty">publishable drops → noesis</div>
              </HoldingCard>
              <HoldingCard ico="message-square" name="Chats" n={c.chats} foot={`last ${p.updated}`} onTo={() => setTab('Chats')}>
                {p.chats.slice(0, 2).map((ch) => <div className="hc-line" key={ch.id}>› {ch.title}</div>)}
              </HoldingCard>
              <HoldingCard ico="workflow" name="Canvases" n={c.canvases} foot={`last ${p.updated}`} onTo={() => setTab('Canvases')}>
                {p.canvases.slice(0, 2).map((cv) => <div className="hc-line" key={cv.id}>› {cv.name} · {cv.nodes} nodes</div>)}
              </HoldingCard>
              <HoldingCard ico="star" name="Favorites" n={c.cards} foot="catalogue picks" onTo={() => setTab('Favorites')}>
                {p.cards.slice(0, 2).map((cd) => <div className="hc-line" key={cd.id}>› {cd.name} · {cd.verb}</div>)}
              </HoldingCard>
            </div>

            {/* bottom band */}
            <div className="ph-band">
              <div className="ph-about">
                <div className="ph-l">about this project</div>
                <p>A project <b>groups</b> your work — it isn’t a wall. Anything here can be referenced from other projects; the only hard boundary is your account.</p>
                <div className="ph-meta mono">{p.shared ? `${p.shared} members · ` : ''}updated {p.updated} · mixed custody (TEE · local · public)</div>
              </div>
              <div className="ph-activity">
                <div className="ph-l">activity</div>
                <div className="ph-ev"><span className="av" style={{ background: p.color }} /><span className="ev-t"><b>you</b> started a chat <span className="mono ev-meta"><span className="hemi2 lit" /> shared · {p.updated}</span></span></div>
                {p.shared ? <div className="ph-ev"><span className="av" /><span className="ev-t"><b>a teammate</b> added work <span className="mono ev-meta"><span className="hemi2 ring" /> sealed · 1d</span></span></div> : null}
              </div>
            </div>
          </>
        ) : (
          <div className="empty ph-scoped">
            <div className="t">{tab} for <b>{p.name}</b> — opens the {tab.toLowerCase()} list scoped to this project.</div>
            <div className="s">Reuses the canonical {tab.toLowerCase()} surface (scoped); building that surface is a later phase.</div>
          </div>
        )}

      </div></div>
    </AppShell>
  );
}

function HoldingCard({ ico, name, n, foot, onTo, children }: {
  ico: string; name: string; n: number; foot: React.ReactNode; onTo: () => void; children: React.ReactNode;
}) {
  return (
    <div className="holding">
      <div className="hc-head"><span className="hc-ico"><Ic name={ico} /></span><b>{name}</b><span className="hc-n">{n}</span></div>
      <div className="hc-body">{children}</div>
      <div className="hc-foot"><span className="hc-sig">{foot}</span><button className="hc-open" onClick={onTo}>open ▸</button></div>
    </div>
  );
}
