import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { custodyGlyph } from '../lib/datasets';
import { api, type Dataset } from '../lib/api';

// Derive a training (train-derive-spec.md, render noema-train-derive.png) — the recipe:
// pick captionset (the lesson) + version + base + method → fire. One dataset, many models.
//
// Source dataset/captionset are real (`GET /v1/data/datasets/full`); base model/method remain
// the pre-launch recipe picker (no training-run backend exists yet — same constraint
// TrainRun.tsx's monitor already labels honestly). Every training runs on our compute.

export function Derive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  useEffect(() => {
    let live = true;
    api.listDatasetsFull().then(({ datasets: ds }) => { if (live) setDatasets(ds); }).catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);
  const d = (datasets ?? []).find((x) => x.id === id);

  if (datasets === null) {
    return <AppShell title="Derive"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Derive">
        <div className="page"><div className="pw wide"><div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div></div></div>
      </AppShell>
    );
  }
  const cap = d.captionsets[0];
  const version = d.versions[d.versions.length - 1]?.v ?? '—';

  const crumb = <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <Link to={`/datasets/${d.id}`}>{d.name}</Link> <span className="sep">/</span> <b>train</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1 className="dv-name">{d.name} · LoRA v1</h1></div>
        </div>

        {/* source */}
        <div className="dv-source">
          <div className="dv-srow">
            <span className="dv-sl">dataset</span>
            <span className="dv-sv"><b>{d.name}</b> <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span> · {version} · {d.media.length} images</span>
            <button className="lnk">version ▾</button>
          </div>
          <div className="dv-srow">
            <span className="dv-sl">captionset</span>
            <span className="dv-sv"><span className={`hemi2 ${custodyGlyph(d.custody)}`} /> <b>{cap?.name ?? 'natural language'}</b> · {cap?.coverage ?? '11/12'} · trigger “frostknight”</span>
            <button className="lnk">change ▾</button>
          </div>
        </div>
        <p className="dv-note">↳ the captionset you pick changes what the model learns — same images, different lessons. derive again anytime; one dataset, many models.</p>

        {/* base + method */}
        <div className="dv-two">
          <div className="dv-panel">
            <div className="dv-pick"><div><b>Flux.1 dev</b><div className="dv-ps mono">open · 12B · best for LoRA subjects</div></div><button className="lnk">change ▸</button></div>
          </div>
          <div className="dv-panel">
            <div className="dv-pick"><div><b>LoRA</b><div className="dv-ps mono">lightweight adapter</div></div><button className="lnk">change ▸</button></div>
            <div className="dv-params mono">rank <b>16</b> &nbsp; steps <b>1,200</b> &nbsp; lr <b>1e-4</b></div>
            <button className="lnk">· advanced parameters</button>
          </div>
        </div>

        {/* footer */}
        <div className="dv-foot">
          <div className="dv-est mono">1,200 steps · ~22 min · <span className="gold">~480 credits</span> · ↳ lands on your model shelf</div>
          <button className="btn accent lg" onClick={() => navigate(`/train/run/${d.id}`)}>Begin training →</button>
        </div>
      </div></div>
    </AppShell>
  );
}
