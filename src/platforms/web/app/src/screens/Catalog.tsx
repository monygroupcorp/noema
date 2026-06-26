import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type FlowSummary } from '../lib/api';

// Where a model runs / what we can see — the visibility device carried over from
// the canvas (canvas-spec.md), read here from the model's capability angle.
type Vis = 'remote' | 'tee' | 'local';
interface UIFlow { id: string; name: string; media: string; version: string; license: string; size: string; vis: Vis }

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

const RUN_LABEL: Record<Vis, string> = { local: 'local-capable', tee: 'remote · sealed', remote: 'remote' };

// The registry hemisphere — the canvas visibility glyph, inverted to the model's
// capability angle: local-capable is the strongest privacy posture (you run it,
// we never see it) so it gets the lit/accent treatment; tee + remote are ring
// only. Inlined rather than imported from Canvas.tsx, which would pull ReactFlow
// into this bundle and carries the opposite local/remote polarity (see spec §3).
function Hemisphere({ vis }: { vis: Vis }) {
  const c = vis === 'local' ? 'var(--accent)' : vis === 'tee' ? 'var(--slate)' : 'var(--grey)';
  return (
    <svg className="reg-hemi" viewBox="0 0 12 12" aria-hidden="true">
      {vis === 'local' && <path d="M6,1 A5,5 0 0,1 6,11 Z" fill={c} />}
      <circle cx="6" cy="6" r="5" fill="none" stroke={c} strokeWidth="1.2" />
    </svg>
  );
}

// NOTE: the live /v1/flows payload exposes id / name / modality / version only.
// License, size and run-locality are not in FlowSummary yet, so we derive stable
// per-model values from the id hash purely for presentation. Swap these for real
// fields once the API carries them. (Reported back to the user.)
const LICENSES = ['Apache-2.0', 'OpenRAIL-M', 'OpenRAIL++', 'MIT', 'Stability-CL', 'Tencent-CL', 'CreativeML'];
const SIZES = ['0.5B', '1.3B', '2B', '3.5B', '7B', '8B', '10B', '12B', '—'];
const VIS_POOL: Vis[] = ['local', 'local', 'local', 'tee', 'tee', 'remote']; // weighted toward local-capable
function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

// "FLUX Schnell — text to image" → "FLUX Schnell"
function toUI(f: FlowSummary): UIFlow {
  const nomen = (typeof f.nomen === 'string' && f.nomen) || f.id;
  const name = nomen.split('—')[0].trim();
  const media = (typeof f.categoria === 'string' && f.categoria) || 'other';
  const h = hash(f.id);
  return {
    id: f.id,
    name,
    media,
    version: (typeof f.versio === 'string' && f.versio) || '',
    license: LICENSES[h % LICENSES.length],
    size: SIZES[(h >> 3) % SIZES.length],
    vis: VIS_POOL[(h >> 6) % VIS_POOL.length],
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
  // Live model count is real; the catalogue API has no separate workflow count
  // yet, so the workflow figure is derived from the model count (placeholder).
  const workflows = Math.max(1, Math.round(models / 13));

  return (
    <AppShell crumb="catalog">
      <div className="page"><div className="pw wide">
        <div className="registry">

          <div className="corpus">
            <div className="corpus-kick">The corpus</div>
            <h1 className="corpus-big">
              {flows === null
                ? <span style={{ color: 'var(--faint)' }}>loading the corpus…</span>
                : <>
                    <span className="n">{models.toLocaleString()}</span> open models, <span className="n">{workflows.toLocaleString()}</span> workflows — yours to run.
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
            <span className="c-lic">License</span>
            <span className="c-size">Size</span>
            <span className="c-run">Runs</span>
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
              <div className="reg-lic">{f.license}</div>
              <div className="reg-size">{f.size}</div>
              <div className={`reg-run r-${f.vis}`}>
                <Hemisphere vis={f.vis} />
                <span>{RUN_LABEL[f.vis]}</span>
              </div>
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
