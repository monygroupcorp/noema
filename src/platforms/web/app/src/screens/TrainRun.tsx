import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { custodyGlyph } from '../lib/datasets';
import { api, type Dataset } from '../lib/api';

// Training run monitor (train-run-spec.md, render noema-train-run.png) — "watch it learn":
// checkpoint emergence (noise→crisp) is the hero, with the loss line and the "what we see —
// the meter" rail (the brand's privacy line as a literal device; under TEE/local the samples
// render in the user's enclave and are NOT egress to NOEMA).
//
// The source dataset is real (`GET /v1/data/datasets/full`); the run/loss simulation below stays
// presentational — noema-079 shipped no training-runs backend, and the footer already says so.
const TOTAL = 1200;
const CHECKPOINTS = [0, 200, 400, 600, 740];

// a downward-trending loss polyline (smoothed) as a static SVG path
const LOSS_PTS = [0.31, 0.27, 0.24, 0.235, 0.205, 0.19, 0.17, 0.165, 0.14, 0.125, 0.11, 0.1, 0.092, 0.085, 0.078, 0.071];

export function TrainRun() {
  const { id } = useParams();
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  useEffect(() => {
    let live = true;
    api.listDatasetsFull().then(({ datasets: ds }) => { if (live) setDatasets(ds); }).catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);
  const d = (datasets ?? []).find((x) => x.id === id);
  const [step, setStep] = useState(740);

  // a little life — nudge the step upward toward the total (purely presentational)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s >= TOTAL ? s : Math.min(TOTAL, s + 4))), 600);
    return () => clearInterval(t);
  }, []);

  if (datasets === null) {
    return <AppShell title="Training run"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Training run">
        <div className="page"><div className="pw wide"><div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div></div></div>
      </AppShell>
    );
  }
  const pct = Math.round((step / TOTAL) * 100);
  const glyph = custodyGlyph(d.custody);
  const sealed = d.custody !== 'remote';

  // loss path in a 0..560 x 0..150 viewbox. SVG y is top-down, so HIGH loss maps to the TOP
  // (small y) and the line descends left→right as the model learns.
  const maxL = 0.33;
  const yOf = (l: number) => 10 + (1 - l / maxL) * 130;
  const path = LOSS_PTS.map((l, i) => `${i === 0 ? 'M' : 'L'} ${(i / (LOSS_PTS.length - 1)) * 540 + 10} ${yOf(l)}`).join(' ');

  const crumb = (
    <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <Link to={`/datasets/${d.id}`}>{d.name}</Link> <span className="sep">/</span> train <span className="sep">/</span> <b>run</b></span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead tr-head">
          <div>
            <h1>{d.name} · LoRA v1</h1>
            <div className="sub mono">natural language · v2 &nbsp; Flux.1 dev &nbsp; LoRA r16 &nbsp; trigger <span className="accent">frostknight</span></div>
          </div>
          <div className="right"><span className="tr-status"><span className="rdot good" /> learning · step {step} / {TOTAL}</span></div>
        </div>

        <div className="tr-progress"><span style={{ width: `${pct}%` }} /></div>

        {/* watch it learn — the emergence row */}
        <div className="tr-strip">
          {CHECKPOINTS.map((cp, i) => {
            const crisp = i / (CHECKPOINTS.length - 1);           // 0 = noisy, 1 = crisp
            const now = i === CHECKPOINTS.length - 1;
            return (
              <div key={cp} className="tr-cp-wrap">
                <div className={`tr-cp${now ? ' now' : ''}`}>
                  <span className="tr-cp-img" style={{ filter: `blur(${(1 - crisp) * 7}px) saturate(${0.4 + crisp})`, opacity: 0.45 + crisp * 0.55,
                    background: `radial-gradient(120% 100% at 50% 30%, #3a4d72, #1a2336)` }} />
                </div>
                <div className="tr-cp-l mono">{now ? `${step} · now` : cp}</div>
                {i < CHECKPOINTS.length - 1 && <span className="tr-arrow">→</span>}
              </div>
            );
          })}
        </div>
        <p className="tr-note">The subject is <b>resolving</b> — armor and pose are holding by step 600; the face is sharpening now.</p>

        {/* loss + meter */}
        <div className="tr-bottom">
          <div className="tr-loss">
            <div className="tr-loss-head"><span className="mono">LOSS <b className="accent">0.071</b> ↓ · smoothed</span></div>
            <svg className="tr-loss-svg" viewBox="0 0 560 150" preserveAspectRatio="none">
              <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.6" />
              <circle cx="550" cy={yOf(0.071)} r="3.5" fill="var(--accent)" />
            </svg>
          </div>
          <div className="tr-meter">
            <div className="tr-meter-l"><span className={`hemi2 ${glyph}`} /> what we see — the meter</div>
            <div className="tr-mrow"><span className="k mono">step</span><span className="v mono"><b className="accent">{step}</b>/{TOTAL}</span></div>
            <div className="tr-mrow"><span className="k mono">epoch</span><span className="v mono">3 / 5</span></div>
            <div className="tr-mrow"><span className="k mono">throughput · eta</span><span className="v mono">2.1 it/s · ~6m</span></div>
            <div className="tr-mrow"><span className="k mono">data · model</span><span className="v mono">{sealed ? 'sealed' : 'remote'}</span></div>
          </div>
        </div>

        <div className="tr-foot">
          <div className="tr-foot-note"><span className={`hemi2 ${glyph}`} /> {sealed ? 'training in TEE — samples render inside your enclave; we see the meter above, never your model or your data.' : 'training on our compute — we can see the work.'} &nbsp;↳ lands on <Link to="/models" className="accent">your model shelf</Link> when it finishes</div>
          <div className="tr-actions">
            <Link className="btn ghost" to="/models"><Ic name="box" /> View your shelf →</Link>
            <button className="btn ghost" disabled title="Live job controls aren’t wired yet"><Ic name="x" /> pause</button>
            <button className="btn ghost danger" disabled title="Live job controls aren’t wired yet">■ stop</button>
          </div>
        </div>
        <div className="sub mono" style={{ marginTop: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
          <span className="hemi2 dashed" /> Preview — this monitor isn’t bound to a live training job yet (no training-runs index in the backend). Progress shown is illustrative.
        </div>
      </div></div>
    </AppShell>
  );
}
