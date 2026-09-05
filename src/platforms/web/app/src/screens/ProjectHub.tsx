import { useState, useEffect, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useProject } from '../state/project';
import { counts } from '../lib/projects';
import { DATASETS } from '../lib/datasets';
import { Ic } from '../lib/icons';
import { api, listAllCollections, type Team } from '../lib/api';

// Project hub (project-hub-spec.md, render noema-project-hub.png) — one project's home: a
// tabbed workbench. Overview summarizes the six holdings; the asset tabs (Datasets/Models/
// Collections) open the CANONICAL surfaces filtered to this project via `?project=<id>`
// (Decision 4 — one list surface, two entry modes). Lives in the shell; the top bar shows
// the breadcrumb.
//
// Holdings are real now: datasets/models/collections read the project's filed id-reference
// lengths, not a hardcoded 0, and the Overview resolves those ids to friendly names (falling
// back to the raw id for a dangling reference). Chats/canvases/favorites stay client-local
// overlay (no backend store yet).

const QUICK = [
  { to: '/chat', ico: 'message-square', label: 'New chat' },
  { to: '/canvas', ico: 'workflow', label: 'New canvas' },
  { to: '/datasets', ico: 'database', label: 'New dataset' },
  { to: '/datasets', ico: 'graduation-cap', label: 'Train model' },
  { to: '/collections', ico: 'hexagon', label: 'New collection' },
];

export function ProjectHub() {
  const { id } = useParams();
  const { projects, linkTeam, renameProject, removeProject } = useProject();
  const navigate = useNavigate();
  const p = projects.find((x) => x.id === id) ?? projects[0];
  const c = counts(p);
  const [tab, setTab] = useState('Overview');

  // Rename — inline edit of name + description in the header, persisted via the
  // update client method (backend-authoritative for identified accounts; the anon
  // mock path degrades to the local workspace cache).
  const [editing, setEditing] = useState(false);
  const [eName, setEName] = useState('');
  const [eDesc, setEDesc] = useState('');
  const startEdit = () => { setEName(p.name); setEDesc(p.desc); setEditing(true); };
  const saveEdit = () => {
    if (!eName.trim()) return;
    renameProject(p.id, { name: eName.trim(), desc: eDesc.trim() });
    setEditing(false);
  };
  // Delete — explicit two-step armed confirm (never window.confirm). The provider
  // clears the active selection + the Preferences "land in" default if they pointed here.
  const [armDelete, setArmDelete] = useState(false);
  const doDelete = () => { removeProject(p.id); navigate('/projects'); };
  // Leaving for another project (or after a delete-redirect) disarms + closes the editor.
  useEffect(() => { setArmDelete(false); setEditing(false); }, [p.id]);

  // Teams the caller can reference for this project's shared member set (Decision 6 — a project
  // references a Team; it doesn't carry its own membership). Empty/failed → the picker hides.
  const [teams, setTeams] = useState<Team[]>([]);
  // id→name maps so the Overview shows friendly holding names, not raw ids. Datasets come from
  // the (mock) library; models + collections from the caller's canonical lists.
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [collNames, setCollNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    api.listTeams().then((r) => { if (live) setTeams(r.teams); }).catch(() => { if (live) setTeams([]); });
    api.listMyModels().then((r) => { if (live) setModelNames(Object.fromEntries(r.models.map((m) => [m.intellaId, m.nomen]))); }).catch(() => {});
    listAllCollections().then((cs) => { if (live) setCollNames(Object.fromEntries(cs.map((x) => [x.id, x.nomen || 'Untitled collection']))); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const dsNames = useMemo(() => Object.fromEntries(DATASETS.map((d) => [d.id, d.name])), []);
  const nameOf = (map: Record<string, string>, id: string) => map[id] ?? id;

  const tabs: { key: string; n?: number }[] = [
    { key: 'Overview' }, { key: 'Chats', n: c.chats }, { key: 'Canvases', n: c.canvases },
    { key: 'Datasets', n: c.datasets }, { key: 'Models', n: c.models }, { key: 'Collections', n: c.collections }, { key: 'Favorites', n: c.cards },
  ];

  // The asset tabs open the canonical surface scoped to this project.
  const SCOPED: Record<string, string> = { Datasets: '/datasets', Models: '/models', Collections: '/collections' };

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
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <div className="projnew" style={{ marginTop: 'var(--s2, 8px)' }}>
                <input autoFocus value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Project name"
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }} />
                <input value={eDesc} onChange={(e) => setEDesc(e.target.value)} placeholder="What's it for? (optional)"
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }} />
                <button className="btn accent" onClick={saveEdit} disabled={!eName.trim()}>Save</button>
                <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            ) : (
              <>
                <h1 className="ph-name">{p.name} <button className="hc-open" title="Rename this project" onClick={startEdit}>rename ▸</button></h1>
                <p className="ph-desc">{p.desc || 'No description yet.'}</p>
              </>
            )}
          </div>
          <div className="ph-people">
            {p.shared ? <span className="ph-avatars">{Array.from({ length: Math.min(p.shared, 3) }).map((_, i) => <span key={i} className="av" style={{ background: p.color }} />)}</span> : null}
            {teams.length > 0 ? (
              // Share by referencing a Team (Sodalitas) — the project's member set IS the team.
              <label className="ph-team mono" title="Share this project with a team">
                <Ic name="circle-user" />
                <select className="cer-input" value={p.teamId ?? ''} onChange={(e) => linkTeam(p.id, e.target.value || null)}>
                  <option value="">private (just you)</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.nomen}</option>)}
                </select>
              </label>
            ) : (
              <Link className="btn" to="/teams"><Ic name="circle-user" /> share via a team ▸</Link>
            )}
          </div>
        </div>

        {/* quick-start — genesis actions, created into this project */}
        <div className="ph-quick">
          {QUICK.map((q) => (
            <Link key={q.label} className="qbtn" to={q.to}><Ic name={q.ico} /> {q.label}</Link>
          ))}
        </div>

        {/* tabs — asset tabs are LINKS into the canonical surface scoped to this project */}
        <div className="ph-tabs">
          {tabs.map((t) => (
            SCOPED[t.key] ? (
              <Link key={t.key} className="ph-tab" to={`${SCOPED[t.key]}?project=${p.id}`}>
                {t.key}{t.n != null && <span className="tn">{t.n}</span>}
              </Link>
            ) : (
              <button key={t.key} className={`ph-tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}>
                {t.key}{t.n != null && <span className="tn">{t.n}</span>}
              </button>
            )
          ))}
        </div>

        {tab === 'Overview' ? (
          <>
            <div className="ph-overview">
              <HoldingCard ico="database" name="Datasets" n={c.datasets} foot={c.datasets ? `${c.datasets} filed` : 'no datasets yet'} to={`/datasets?project=${p.id}`}>
                {c.datasets
                  ? p.datasetIds.slice(0, 2).map((x) => <div className="hc-line" key={x}>› {nameOf(dsNames, x)}</div>)
                  : <div className="hc-empty">the core asset — start one to train from</div>}
              </HoldingCard>
              <HoldingCard ico="box" name="Models" n={c.models} foot={<span className="gold"><span className="gem">◈</span> — royalties</span>} to={`/models?project=${p.id}`}>
                {c.models
                  ? p.modelIds.slice(0, 2).map((x) => <div className="hc-line" key={x}>› {nameOf(modelNames, x)}</div>)
                  : <div className="hc-empty">trained LoRAs land on the shelf</div>}
              </HoldingCard>
              <HoldingCard ico="hexagon" name="Collections" n={c.collections} foot={c.collections ? `${c.collections} filed` : '0 minted · 0 draft'} to={`/collections?project=${p.id}`}>
                {c.collections
                  ? p.collectionIds.slice(0, 2).map((x) => <div className="hc-line" key={x}>› {nameOf(collNames, x)}</div>)
                  : <div className="hc-empty">publishable drops → noesis</div>}
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
                {p.shared ? <div className="ph-ev"><span className="av" /><span className="ev-t"><b>a teammate</b> added work <span className="mono ev-meta"><span className="hemi2 ring" /> private · 1d</span></span></div> : null}
              </div>
            </div>

            {/* danger zone — delete is a two-step armed confirm (no browser dialogs). Deleting
                removes the project (a grouping lens); its assets stay in your account. */}
            <div style={{ marginTop: 'var(--s5, 20px)' }}>
              {armDelete ? (
                <div className="warn" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Delete <b>{p.name}</b>? The project (its grouping + holdings references) goes away — the datasets, models and collections themselves stay in your account.</span>
                  <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                    <button className="btn ghost bad" onClick={doDelete}><Ic name="trash-2" /> Delete permanently</button>
                    <button className="btn ghost" onClick={() => setArmDelete(false)}>Cancel</button>
                  </span>
                </div>
              ) : (
                <button className="btn ghost bad" onClick={() => setArmDelete(true)}><Ic name="trash-2" /> Delete project…</button>
              )}
            </div>
          </>
        ) : tab === 'Chats' ? (
          <ScopedList empty="No chats in this project yet." rows={p.chats.map((ch) => `${ch.title} · ${ch.when}`)} />
        ) : tab === 'Canvases' ? (
          <ScopedList empty="No canvases in this project yet." rows={p.canvases.map((cv) => `${cv.name} · ${cv.nodes} nodes`)} />
        ) : tab === 'Favorites' ? (
          <ScopedList empty="No favorite cards pinned to this project yet." rows={p.cards.map((cd) => `${cd.name} · ${cd.verb}`)} />
        ) : (
          <div className="empty ph-scoped">
            <div className="t">{tab} for <b>{p.name}</b> — opens the {tab.toLowerCase()} list scoped to this project.</div>
          </div>
        )}

      </div></div>
    </AppShell>
  );
}

// A local (overlay) holding list — chats / canvases / favorites. These have no backend
// store yet, so they render straight from the project's client-local view state.
function ScopedList({ rows, empty }: { rows: string[]; empty: string }) {
  if (rows.length === 0) return <div className="empty ph-scoped"><div className="t">{empty}</div></div>;
  return (
    <div className="ph-scoped-list">
      {rows.map((r, i) => <div className="hc-line" key={i}>› {r}</div>)}
    </div>
  );
}

function HoldingCard({ ico, name, n, foot, onTo, to, children }: {
  ico: string; name: string; n: number; foot: React.ReactNode; onTo?: () => void; to?: string; children: React.ReactNode;
}) {
  return (
    <div className="holding">
      <div className="hc-head"><span className="hc-ico"><Ic name={ico} /></span><b>{name}</b><span className="hc-n">{n}</span></div>
      <div className="hc-body">{children}</div>
      <div className="hc-foot">
        <span className="hc-sig">{foot}</span>
        {to ? <Link className="hc-open" to={to}>open ▸</Link> : <button className="hc-open" onClick={onTo}>open ▸</button>}
      </div>
    </div>
  );
}
