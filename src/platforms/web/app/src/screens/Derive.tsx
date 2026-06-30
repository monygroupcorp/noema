import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { DATASETS, custodyGlyph, type Custody } from '../lib/datasets';

// Derive a training (train-derive-spec.md, render noema-train-derive.png) — the recipe:
// pick captionset (the lesson) + version + base + method + training custody → fire. One
// dataset, many models. Custody here IS a per-run choice (training custody, chosen at derive).
const CUSTODY: { c: Custody; t: string; s: string }[] = [
  { c: 'local', t: 'Local', s: 'Your GPU. Nothing leaves.' },
  { c: 'sealed', t: 'Remote · TEE', s: 'Sealed enclave — we run it, we can’t read your data.' },
  { c: 'remote', t: 'Remote', s: 'Our GPUs. Fastest, we can see it.' },
];

export function Derive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const d = DATASETS.find((x) => x.id === id) ?? DATASETS[0];
  const [custody, setCustody] = useState<Custody>('sealed');
  const cap = d.captionsets[0];

  const crumb = <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <Link to={`/datasets/${d.id}`}>{d.name}</Link> <span className="sep">/</span> <b>train</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><div className="noema-kicker" style={{ marginBottom: 8 }}>derive a training · from {d.name.toLowerCase()}</div><h1 className="dv-name">{d.name} · LoRA v1<span className="cj-cursor" /></h1></div>
        </div>

        {/* source */}
        <div className="dv-l noema-kicker">source · what it learns from</div>
        <div className="dv-source">
          <div className="dv-srow">
            <span className="dv-sl">dataset</span>
            <span className="dv-sv"><b>{d.name}</b> <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span> · {d.version} · {d.count} images</span>
            <button className="lnk">version ▾</button>
          </div>
          <div className="dv-srow">
            <span className="dv-sl">captionset</span>
            <span className="dv-sv"><span className={`hemi2 ${custodyGlyph(cap?.custody ?? 'sealed')}`} /> <b>{cap?.name ?? 'natural language'}</b> · {cap?.coverage ?? '11/12'} · trigger “frostknight”</span>
            <button className="lnk">change ▾</button>
          </div>
        </div>
        <p className="dv-note">↳ the captionset you pick changes what the model learns — same images, different lessons. derive again anytime; one dataset, many models.</p>

        {/* base + method */}
        <div className="dv-two">
          <div className="dv-panel">
            <div className="dv-l noema-kicker">base model · train on top of</div>
            <div className="dv-pick"><div><b>Flux.1 dev</b><div className="dv-ps mono">open · 12B · best for LoRA subjects</div></div><button className="lnk">change ▸</button></div>
          </div>
          <div className="dv-panel">
            <div className="dv-l noema-kicker">method</div>
            <div className="dv-pick"><div><b>LoRA</b><div className="dv-ps mono">lightweight adapter</div></div><button className="lnk">change ▸</button></div>
            <div className="dv-params mono">rank <b>16</b> &nbsp; steps <b>1,200</b> &nbsp; lr <b>1e-4</b></div>
            <button className="lnk">· advanced parameters</button>
          </div>
        </div>

        {/* custody */}
        <div className="dv-l noema-kicker">where it trains · custody</div>
        <div className="dv-custody">
          {CUSTODY.map((o) => (
            <button key={o.c} className={`dv-cust${custody === o.c ? ' on' : ''}`} onClick={() => setCustody(o.c)}>
              <div className="dv-ct"><span className={`hemi2 ${custodyGlyph(o.c)}`} /> {o.t}</div>
              <div className="dv-cs">{o.s}</div>
            </button>
          ))}
        </div>

        {/* footer */}
        <div className="dv-foot">
          <div className="dv-est mono">1,200 steps · ~22 min in {custody === 'sealed' ? 'TEE' : custody} · <span className="gold">~480 credits</span> · ↳ lands on your model shelf</div>
          <button className="btn accent lg" onClick={() => navigate(`/train/run/${d.id}`)}>Begin training →</button>
        </div>
      </div></div>
    </AppShell>
  );
}
