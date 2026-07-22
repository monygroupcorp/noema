import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { READINESS, MODALITY_TOKEN, custodyGlyph, CUSTODY_LABEL, type Readiness } from '../lib/datasets';
import { api, type Dataset } from '../lib/api';
import { useProject, useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';
import { HoldingToggle } from '../lib/HoldingToggle';

// Datasets library (train-datasets-library-spec.md, render noema-train-datasets-library.png) —
// the entry to the training stack: a recognizable shelf of raw material with each set's own
// facts + a readiness line that names the next action. No downstream counts (datasets are
// inputs, not scoreboards). Imagery is earned here (personal assets, unlike the Registry).

/** Coarse "time ago" for `Dataset.mutatum` — mirrors the mock's `updated` field's grain. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return `${Math.floor(day / 7)}w ago`;
}

// The backend doesn't persist a `readiness` enum (Q1's rich shape is custody/modality/
// captionsets/versions only) — derive the same three states from live data instead.
function readinessOf(d: Dataset): Readiness {
  if (d.media.length === 0) return 'thin';
  if (d.captionsets.length === 0) return 'needs-captioning';
  return 'ready';
}

const TILE_FALLBACK = ['#2b3a5e', '#324063', '#2f5d56', '#33406b'];

export function Datasets() {
  const [params] = useSearchParams();
  const { project: active } = useProject();
  const scope = useProjectScope(params.get('project'));
  // File actions target the scoped project (on a ?project= surface) else the active one.
  const target = (scope ?? active).id;
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);

  useEffect(() => {
    let live = true;
    api.listDatasetsFull()
      .then(({ datasets: d }) => { if (live) setDatasets(d); })
      .catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);

  const all = datasets ?? [];
  // When scoped to a project, show only its filed datasets (Provincia.datasetIds).
  const list = scope ? all.filter((d) => scope.datasetIds.includes(d.id)) : all;

  return (
    <AppShell title="Datasets">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>your datasets · {list.length}</div>
            <h1>Datasets</h1>
            <div className="sub">Your raw material — the core every model is trained from. Reusable, versioned, captioned many ways.</div>
          </div>
          <div className="right"><button className="btn" disabled title="Coming soon — dataset creation isn’t wired yet"><Ic name="plus" /> new dataset — soon</button></div>
        </div>

        {scope && <ScopeBanner project={scope} noun="datasets" />}

        <div className="dsgrid">
          {list.map((d) => {
            const readiness = readinessOf(d);
            const r = READINESS[readiness];
            const version = d.versions[d.versions.length - 1]?.v ?? '—';
            const hasMedia = d.media.length > 0;
            const tiles = hasMedia ? d.media.slice(0, 4).map((m) => m.url) : TILE_FALLBACK;
            return (
              <Link key={d.id} className="dscard" to={`/datasets/${d.id}`}>
                <div className="ds-mosaic">
                  {tiles.map((t, i) => (
                    <span key={i} style={hasMedia ? { backgroundImage: `url(${t})`, backgroundSize: 'cover' } : { background: t }} />
                  ))}
                </div>
                <div className="ds-body">
                  <div className="ds-title">
                    <b>{d.name}</b>
                    <span className="ds-badge" style={{ color: MODALITY_TOKEN[d.modality] }}><span className="dot" style={{ background: MODALITY_TOKEN[d.modality] }} /> {d.modality}</span>
                    <span className={`hemi2 ${custodyGlyph(d.custody)} ds-cust`} title={CUSTODY_LABEL[d.custody]} />
                  </div>
                  <div className="ds-stats mono">{d.media.length} {d.modality === 'video' ? 'clips' : 'images'} · {d.captionsets.length} captionsets · {version}</div>
                  <div className="ds-meta mono">updated {relativeTime(d.mutatum)} · <span className={`hemi2 ${custodyGlyph(d.custody)}`} /> {CUSTODY_LABEL[d.custody]}</div>
                  <div className="ds-ready">
                    <span className="ds-state"><span className={`rdot ${r.dot}`} /> {r.label}</span>
                    <span className="ds-action">{r.action}</span>
                  </div>
                  <div className="ds-file"><HoldingToggle kind="dataset" assetId={d.id} projectId={target} /></div>
                </div>
              </Link>
            );
          })}
          <button className="dscard new" disabled title="Coming soon — dataset creation isn’t wired yet">
            <Ic name="plus" />
            <div className="t">new dataset — soon</div>
            <div className="s mono">drop media · or seed from a generation · coming soon</div>
          </button>
        </div>
      </div></div>
    </AppShell>
  );
}
