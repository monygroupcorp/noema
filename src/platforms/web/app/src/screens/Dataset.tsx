import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { custodyGlyph, type Custody } from '../lib/datasets';
import { api, type Dataset as DatasetT } from '../lib/api';

// Dataset detail (train-dataset-spec.md, render noema-train-dataset.png) — the core asset:
// media (king) + versions + captionsets, with a media-custody dial. Captionsets are a separate
// versioned layer (the lesson); you pick one when you derive a training. Custody is the
// hemisphere everywhere data is read.
//
// Reads the real `GET /v1/data/datasets/full` list and finds this id client-side — noema-079's
// landed contract has no per-id detail route, only list/listFull/create (apiContract.ts:1503-
// 1521), so listFull + find is the real detail lookup (same pattern Datasets.tsx uses for the
// library grid).
const CUSTODY_OPTS: { c: Custody; label: string }[] = [
  { c: 'local', label: 'Local' }, { c: 'remote', label: 'Remote' },
];

export function Dataset() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<DatasetT[] | null>(null);

  useEffect(() => {
    let live = true;
    api.listDatasetsFull()
      .then(({ datasets: ds }) => { if (live) setDatasets(ds); })
      .catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);

  const d = (datasets ?? []).find((x) => x.id === id);
  const [custody, setCustody] = useState<Custody | null>(null);
  const [activeSet, setActiveSet] = useState<string | null>(null);
  // Custody UI state initializes from the loaded record the first time it resolves
  // (this dial is presentational-only — noema-079 shipped no custody-mutation route).
  useEffect(() => {
    if (d && custody === null) { setCustody(d.custody); setActiveSet(d.captionsets[0]?.id ?? ''); }
  }, [d, custody]);

  if (datasets === null) {
    return <AppShell title="Dataset"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Dataset">
        <div className="page"><div className="pw wide">
          <div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div>
        </div></div>
      </AppShell>
    );
  }
  const c = custody ?? d.custody;
  const active = activeSet ?? (d.captionsets[0]?.id ?? '');
  const version = d.versions[d.versions.length - 1]?.v ?? '—';

  const crumb = (
    <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <b>{d.name}</b></span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead ds-detail-head">
          <div>
            <h1 className="ds-d-name">{d.name} <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span></h1>
            <div className="sub mono">{d.media.length} {d.modality === 'video' ? 'clips' : 'images'} · {version} · {d.captionsets.length} captionsets · updated {d.mutatum}</div>
          </div>
        </div>

        <div className="ds-detail">
          {/* the media — king */}
          <div className="ds-images">
            <div className="ds-imgs-head"><span className="mono ds-showing">showing {d.captionsets.find((cs) => cs.id === active)?.name ?? '—'} · {version}</span>
            </div>
            {d.media.length === 0 ? (
              <p className="ds-panel-note">no media in this dataset yet.</p>
            ) : (
              <div className="ds-imgrid">
                {d.media.map((m) => (
                  <figure key={m.id} className="ds-img">
                    <span className="ds-img-tile" style={{ backgroundImage: `url(${m.url})`, backgroundSize: 'cover' }} />
                    <figcaption className="mono">{m.source === 'upload' ? 'uploaded' : 'from a generation'}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>

          {/* the panels */}
          <aside className="ds-side">
            <div className="ds-panel">
              <div className="ds-panel-l">media custody · what we see</div>
              <div className="seg custody-seg">
                {CUSTODY_OPTS.map((o) => (
                  <button key={o.c} className={c === o.c ? 'on' : ''} onClick={() => setCustody(o.c)}>
                    <span className={`hemi2 ${custodyGlyph(o.c)}`} /> {o.label}
                  </button>
                ))}
              </div>
              <p className="ds-panel-note">{c === 'local' ? 'local — the media never leaves your machine.' : 'remote — we host the media on our compute.'}</p>
            </div>

            <div className="ds-panel">
              <div className="ds-panel-l">captionsets · {d.captionsets.length} · pick to train</div>
              {d.captionsets.length === 0 ? (
                <p className="ds-panel-note">no captionset yet — a model learns from a caption layer. Run a caption job to make one.</p>
              ) : d.captionsets.map((cs) => (
                <button key={cs.id} className={`capset${active === cs.id ? ' on' : ''}`} onClick={() => setActiveSet(cs.id)}>
                  <span className={`radio${active === cs.id ? ' on' : ''}`} />
                  <span className="cs-main"><span className="nm">{cs.name}</span><span className="cs-sub mono"><span className={`hemi2 ${custodyGlyph(c)}`} /> {cs.method} · {cs.coverage}</span></span>
                </button>
              ))}
              <div className="capset-actions"><Link className="lnk" to={`/datasets/${d.id}/caption`}>+ new captionset</Link> · <Link className="lnk" to={`/datasets/${d.id}/caption`}>run a caption job</Link></div>
            </div>

            <div className="ds-panel">
              <div className="ds-panel-l">versions</div>
              {d.versions.map((v) => (
                <div key={v.v} className={`verrow${v.v === version ? ' on' : ''}`}>
                  <span className="dot" /> <b>{v.v}</b> · {v.count} {d.modality === 'video' ? 'clips' : 'images'}<span className="when mono">{v.when}</span>
                </div>
              ))}
            </div>

            <button className="btn accent block ds-train" disabled={d.captionsets.length === 0}
              onClick={() => navigate(`/datasets/${d.id}/derive`)}>Train a model from this →</button>
            {d.captionsets.length === 0 && <div className="ds-panel-note" style={{ textAlign: 'center' }}>caption it first</div>}
          </aside>
        </div>
      </div></div>
    </AppShell>
  );
}
