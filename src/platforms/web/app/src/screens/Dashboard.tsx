import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useProject } from '../state/project';
import { useIdentity } from '../state/identity';
import { counts, type Project } from '../lib/projects';
import { api } from '../lib/api';
import { Ic } from '../lib/icons';

// Home / dashboard (dashboard-spec.md, render noema-dashboard.png). Leads with the brand's
// one question answered — "What NOEMA can see: the meter, nothing more." — then projects, then
// recent. The instrument band is the one framed element (.noema-frame, corner ticks earned).

function computeRow(exec: string): { glyph: string; text: string } {
  if (exec === 'tee') return { glyph: 'ring', text: 'TEE · sealed — your work stays in the enclave' };
  if (exec === 'local') return { glyph: 'dashed', text: 'local · off-grid — nothing leaves your machine' };
  return { glyph: 'lit', text: 'shared — running on our compute' };
}

// the full project holdings row (spec): chats · canvases · datasets · models · collections · favorites.
// The mock Project carries chats/canvases/cards/gens; datasets/models/collections seed at 0
// until the project backend carries them. TODO(backend: project holdings).
function holdings(p: Project) {
  const c = counts(p);
  return [
    { ico: 'message-square', n: c.chats },
    { ico: 'workflow', n: c.canvases },
    { ico: 'database', n: 0 },
    { ico: 'box', n: 0 },
    { ico: 'hexagon', n: 0 },
    { ico: 'star', n: c.cards },
  ];
}

export function Dashboard() {
  const { projects } = useProject();
  const { ident, execution } = useIdentity();
  const [credits, setCredits] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.meStatus().then((s) => { if (live && s?.balanceImpetus != null) setCredits(Number(s.balanceImpetus).toLocaleString()); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const cr = credits ?? (ident.bal.match(/(\d[\d,]*)\s*credits?/)?.[1] ?? '—');
  const comp = computeRow(execution);

  // recent: a flat list across projects (kind · detail · in ‹project› · custody).
  const recent = projects.flatMap((p) => p.chats.slice(0, 1).map((ch) => ({ kind: 'chat', detail: ch.title, project: p.name }))).slice(0, 5);

  return (
    <AppShell title="Home">
      <div className="page"><div className="pw wide">

        {/* instrument band — the one framed element */}
        <div className="noema-frame instband">
          <div className="ib-kick noema-kicker">your studio · right now</div>
          <div className="ib-line">What NOEMA can see: <span className="accent">the meter, nothing more.</span></div>
          <div className="ib-grid">
            <div className="ib-cell">
              <div className="ib-l">active compute · what we see</div>
              <div className="ib-compute"><span className={`hemi2 ${comp.glyph}`} /> {comp.text}</div>
            </div>
            <div className="ib-cell">
              <div className="ib-l">credits</div>
              <div className="ib-n gold"><span className="gem">◈</span> {cr}</div>
              <div className="ib-sub">subscription · resets 12d</div>
            </div>
            <div className="ib-cell">
              <div className="ib-l">royalties · lifetime</div>
              <div className="ib-n gold"><span className="gem">◈</span> 18,400</div>
              <div className="ib-sub">+1,240 ↑30d · payout on noesis</div>
            </div>
          </div>
        </div>

        {/* Primary action — the one obvious way to start making (P0-2). New users land here with
            no generate CTA otherwise; this routes straight to the Catalogue → Card path. */}
        <div className="db-start" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap', margin: 'var(--s5) 0 var(--s6)' }}>
          <Link className="btn" to="/catalog"><Ic name="sparkles" /> Create something</Link>
          <Link className="btn ghost" to="/chat"><Ic name="message-square" /> Ask the Concierge</Link>
          <span className="sub" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>Pick a model to run, or just describe what you want.</span>
        </div>

        {/* your projects */}
        <div className="sectionhead db-head">your projects · {projects.length}<Link className="db-all" to="/projects">all projects ▸</Link></div>
        <div className="dbprojgrid">
          {projects.map((p) => (
            <Link key={p.id} className="dbproj" to={`/projects/${p.id}`}>
              <div className="dbproj-mosaic"><span style={{ background: p.color }} /><span /><span /><span /></div>
              <div className="dbproj-body">
                <b>{p.name}</b>
                <div className="dbproj-holdings mono">
                  {holdings(p).map((h, i) => <span key={i} className="hc"><Ic name={h.ico} />{h.n}</span>)}
                </div>
              </div>
              <div className="dbproj-foot"><span className="upd mono">{p.updated}</span></div>
            </Link>
          ))}
          <Link className="dbproj new" to="/projects?new=1"><Ic name="plus" /><span>new project</span></Link>
        </div>

        {/* recent */}
        <div className="sectionhead">recent</div>
        <div className="dbrecent">
          {recent.length === 0 ? (
            <div className="empty"><div className="t">Nothing yet — start a chat or a run.</div></div>
          ) : recent.map((r, i) => (
            <div className="dbrec-row" key={i}>
              <Ic name="message-square" />
              <span className="rk">{r.kind}</span>
              <span className="rd">{r.detail}</span>
              <span className="rp mono">in {r.project}</span>
              <span className={`hemi2 ${comp.glyph}`} title="custody" />
            </div>
          ))}
        </div>

      </div></div>
    </AppShell>
  );
}
