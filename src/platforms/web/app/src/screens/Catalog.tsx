import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type FlowSummary } from '../lib/api';

interface UIFlow { id: string; name: string; desc: string; media: string; version: string; fav: string }

const FAV: Record<string, string> = {
  image: 'linear-gradient(160deg,var(--accent),#23264f)',
  text: 'linear-gradient(160deg,#5fd0a8,#1c4a3c)',
  audio: 'linear-gradient(160deg,#d66f9a,#4a1c33)',
  '3d': 'linear-gradient(160deg,#6f8fd6,#23264f)',
  video: 'linear-gradient(160deg,#d68f6f,#4a261c)',
  other: 'linear-gradient(160deg,#9a8fd6,#2b2456)',
};

// "FLUX Schnell — text to image" → { name: 'FLUX Schnell', desc: 'text to image' }
function toUI(f: FlowSummary): UIFlow {
  const nomen = (typeof f.nomen === 'string' && f.nomen) || f.id;
  const [name, ...rest] = nomen.split('—');
  const media = (typeof f.categoria === 'string' && f.categoria) || 'other';
  return {
    id: f.id,
    name: name.trim(),
    desc: rest.join('—').trim() || '—',
    media,
    version: (typeof f.versio === 'string' && f.versio) || '',
    fav: FAV[media] || FAV.other,
  };
}

export function Catalog() {
  const [flows, setFlows] = useState<UIFlow[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    let live = true;
    api.listFlows()
      .then((r) => { if (live) setFlows(r.flows.map(toUI)); })
      .catch(() => { if (live) { setErr(true); setFlows([]); } });
    return () => { live = false; };
  }, []);

  const filters = useMemo(
    () => ['All', ...Array.from(new Set((flows || []).map((f) => f.media)))],
    [flows]
  );
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (flows || []).filter(
      (f) => (!ql || (f.name + ' ' + f.desc).toLowerCase().includes(ql)) && (filter === 'All' || f.media === filter)
    );
  }, [flows, q, filter]);

  return (
    <AppShell crumb="catalog">
      <div className="page"><div className="pw wide">
        <div className="pagehead"><div>
          <h1>Catalog</h1>
          <div className="sub">
            {flows === null ? 'Loading flows from staging…'
              : err ? 'Couldn’t reach the live catalog.'
              : `${flows.length} flows · live from staging.noema.art`}
          </div>
        </div></div>

        <div className="toolbar">
          <div className="search">
            <Ic name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search flows…" />
          </div>
          <div className="filters">
            {filters.map((f) => (
              <button key={f} className={`fchip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
        </div>

        {flows === null && <div className="empty"><div className="t">Loading…</div></div>}
        {err && <div className="warn">Couldn’t reach the live catalog — the staging cluster may be unreachable from here.</div>}

        {flows && shown.length > 0 && (
          <div className="grid">
            {shown.map((f) => (
              <Link key={f.id} className="gcard" to="/card">
                <div className="gtop">
                  <span className="fav" style={{ background: f.fav }} />
                  <div><h3>{f.name}</h3> <span className="badge accent">{f.media}</span></div>
                </div>
                <div className="gd">{f.desc}</div>
                <div className="gports"><span className="port mono">{f.id}</span> · v{f.version}</div>
              </Link>
            ))}
          </div>
        )}

        {flows && !err && shown.length === 0 && <div className="empty"><div className="t">No flows match.</div></div>}
      </div></div>
    </AppShell>
  );
}
