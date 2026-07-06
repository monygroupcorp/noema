import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type FlowSummary } from '../lib/api';

// Only the fields the live /v1/flows payload actually carries. License / size / run-locality
// are NOT in FlowSummary, so we don't show them at all rather than invent them (P0-4,
// compliance-sensitive: license especially must never be fabricated).
interface UIFlow { id: string; name: string; media: string; version: string }

// Modality swatch colour — the same five tokens the canvas ports use, promoted
// to shared --m-* tokens in noema-theme.css (one palette, two surfaces).
const MOD_TOKEN: Record<string, string> = {
  text: 'var(--m-text)', image: 'var(--m-image)', video: 'var(--m-video)', audio: 'var(--m-audio)', '3d': 'var(--m-3d)',
};

// Canonical modality filter set (matches the canonical render). Each non-"All"
// chip carries an 8px modality swatch.
const FILTERS: { key: string; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
  { key: '3d', label: '3D' },
  { key: 'audio', label: 'Audio' },
  { key: 'text', label: 'Text' },
];


// NOTE: the live /v1/flows payload exposes id / name / modality / version only.
// License, size and run-locality are not in FlowSummary yet, so we derive stable
// per-model values from the id hash purely for presentation. Swap these for real
// fields once the API carries them. (Reported back to the user.)
// "FLUX Schnell — text to image" → "FLUX Schnell"
function toUI(f: FlowSummary): UIFlow {
  const nomen = (typeof f.nomen === 'string' && f.nomen) || f.id;
  const name = nomen.split('—')[0].trim();
  const media = (typeof f.categoria === 'string' && f.categoria) || 'other';
  return {
    id: f.id,
    name,
    media,
    version: (typeof f.versio === 'string' && f.versio) || '',
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

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (flows || []).filter(
      (f) => (!ql || (f.name + ' ' + f.id + ' ' + f.media).toLowerCase().includes(ql)) && (filter === 'All' || f.media === filter)
    );
  }, [flows, q, filter]);

  const models = flows?.length ?? 0;

  return (
    <AppShell crumb="Catalogue">
      <div className="page"><div className="pw wide">
        <div className="registry">

          <div className="corpus">
            <div className="corpus-kick">The corpus</div>
            <h1 className="corpus-big">
              {flows === null
                ? <span style={{ color: 'var(--faint)' }}>loading the corpus…</span>
                : <>
                    <span className="n">{models.toLocaleString()}</span> open models — yours to run.
                  </>}
            </h1>
            <div className="corpus-meta">
              {err
                ? 'couldn’t reach the live catalog — the staging cluster may be unreachable from here'
                : 'every weight open-source · run remote, sealed, or local · nothing proprietary, nothing locked'}
            </div>
          </div>

          <div className="cat-toolbar">
            <div className="cat-search">
              <Ic name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${models.toLocaleString()} models — name, task, architecture…`} />
            </div>
            <div className="cat-filters">
              {FILTERS.map((f) => (
                <button key={f.key} className={`cat-chip${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
                  {f.key !== 'All' && <span className="mg" style={{ background: MOD_TOKEN[f.key] || 'var(--muted)' }} />}
                  {f.label}
                </button>
              ))}
            </div>
            <div className="cat-sort">sort <b>popular ▾</b></div>
          </div>

          <div className="reg-bar">
            <span className="c-name">Model</span>
            <span className="c-mod">Modality</span>
            <span className="c-ver">Version</span>
          </div>

          {shown.map((f) => (
            <Link key={f.id} className="reg-row" to={`/card?id=${encodeURIComponent(f.id)}`}>
              <div className="reg-name">
                <span className="nm">{f.name}</span>
                <span className="id">{f.id}</span>
              </div>
              <div className="reg-mod">
                <span className="mg" style={{ background: MOD_TOKEN[f.media] || 'var(--muted)' }} />
                {f.media}
              </div>
              <div className="reg-ver mono">{f.version || '—'}</div>
            </Link>
          ))}

          {flows === null && <div className="empty"><div className="t">Loading the registry…</div></div>}
          {flows && !err && shown.length === 0 && <div className="empty"><div className="t">No models match.</div></div>}
          {flows && shown.length > 0 && (
            <div className="foot">showing {shown.length.toLocaleString()} of {models.toLocaleString()} — scroll for more</div>
          )}

        </div>
      </div></div>
    </AppShell>
  );
}
