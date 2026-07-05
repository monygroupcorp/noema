import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { DATASETS, READINESS, MODALITY_TOKEN, custodyGlyph, CUSTODY_LABEL } from '../lib/datasets';
import { useProjectScope } from '../state/project';
import { ScopeBanner } from '../lib/ScopeBanner';

// Datasets library (train-datasets-library-spec.md, render noema-train-datasets-library.png) —
// the entry to the training stack: a recognizable shelf of raw material with each set's own
// facts + a readiness line that names the next action. No downstream counts (datasets are
// inputs, not scoreboards). Imagery is earned here (personal assets, unlike the Registry).
export function Datasets() {
  const [params] = useSearchParams();
  const scope = useProjectScope(params.get('project'));
  // When scoped to a project, show only its filed datasets (Provincia.res.datasetIds).
  const list = scope ? DATASETS.filter((d) => scope.datasetIds.includes(d.id)) : DATASETS;
  return (
    <AppShell title="Datasets">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>your datasets · {list.length}</div>
            <h1>Datasets</h1>
            <div className="sub">Your raw material — the core every model is trained from. Reusable, versioned, captioned many ways.</div>
          </div>
          <div className="right"><button className="btn"><Ic name="plus" /> new dataset</button></div>
        </div>

        {scope && <ScopeBanner project={scope} noun="datasets" />}

        <div className="dsgrid">
          {list.map((d) => {
            const r = READINESS[d.readiness];
            return (
              <Link key={d.id} className="dscard" to={`/datasets/${d.id}`}>
                <div className="ds-mosaic">{d.tiles.map((t, i) => <span key={i} style={{ background: t }} />)}</div>
                <div className="ds-body">
                  <div className="ds-title">
                    <b>{d.name}</b>
                    <span className="ds-badge" style={{ color: MODALITY_TOKEN[d.modality] }}><span className="dot" style={{ background: MODALITY_TOKEN[d.modality] }} /> {d.modality}</span>
                    <span className={`hemi2 ${custodyGlyph(d.custody)} ds-cust`} title={CUSTODY_LABEL[d.custody]} />
                  </div>
                  <div className="ds-stats mono">{d.count} {d.modality === 'video' ? 'clips' : 'images'} · {d.captionsets.length} captionsets · {d.version}</div>
                  <div className="ds-meta mono">updated {d.updated} · {d.size} · <span className={`hemi2 ${custodyGlyph(d.custody)}`} /> {CUSTODY_LABEL[d.custody]}</div>
                  <div className="ds-ready">
                    <span className="ds-state"><span className={`rdot ${r.dot}`} /> {r.label}</span>
                    <span className="ds-action">{r.action}</span>
                  </div>
                </div>
              </Link>
            );
          })}
          <button className="dscard new">
            <Ic name="plus" />
            <div className="t">new dataset</div>
            <div className="s mono">drop media · or seed from a generation</div>
          </button>
        </div>
      </div></div>
    </AppShell>
  );
}
