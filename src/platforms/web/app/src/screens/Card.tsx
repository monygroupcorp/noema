import { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';

interface RunState { stage: string; done: boolean; result?: { seed: number; dim: string; time: string } }

export function Card() {
  const { ident } = useIdentity();
  const [prompt, setPrompt] = useState('a low-poly n64-style dragon perched on a neon temple, dusk');
  const [w, setW] = useState(1024);
  const [h, setH] = useState(1024);
  const [steps, setSteps] = useState(4);
  const [guidance, setGuidance] = useState(3.5);
  const [seed, setSeed] = useState('');
  const [adv, setAdv] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);

  const quote = (0.043 * (w * h) / (1024 * 1024) * (steps / 4)).toFixed(3);

  function doRun() {
    if (run && !run.done) return;
    setRun({ stage: 'provisioning pod…', done: false });
    const stages: [number, string][] = [[700, 'generating · 1/4'], [1400, 'generating · 3/4'], [2100, 'uploading…']];
    stages.forEach(([t, s]) => setTimeout(() => setRun((r) => (r && !r.done ? { ...r, stage: s } : r)), t));
    setTimeout(() => setRun({ stage: '', done: true, result: { seed: Math.floor(Math.random() * 1e9), dim: `${w}×${h}`, time: '3.2s' } }), 2800);
  }

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Flow</div>
        <div className="meta-line"><span>verb</span><span className="v mono">make</span></div>
        <div className="meta-line"><span>runtime</span><span className="v mono">comfy</span></div>
        <div className="meta-line"><span>base model</span><span className="v mono">flux-schnell·v1</span></div>
        <div className="meta-line"><span>signature</span><span className="v mono">text → image</span></div>
      </div>
      <div className="csec">
        <div className="ctitle">Account</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb={<>cards <span className="sep">/</span> flux-schnell</>} context={context}>
      <div className="cardscroll"><div className="card">
        <div className="flow-head">
          <span className="fav" />
          <div>
            <h1>FLUX Schnell <span className="verbtag">make</span></h1>
            <div className="desc">Fast text-to-image. Four-step latent diffusion — the default for <span className="mono">make</span>.</div>
            <div className="ports"><span className="p">text</span> → <span className="p">image</span></div>
          </div>
          <span className="ver mono">v1 · official</span>
        </div>

        <div className="field">
          <label>prompt <span className="req">required</span><span className="ty">text</span></label>
          <textarea className="ta2" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the image…" />
        </div>

        <div className="row2">
          <div className="field">
            <label>width <span className="ty">int</span></label>
            <div className="range"><input type="range" min={512} max={1536} step={64} value={w} onChange={(e) => setW(+e.target.value)} /><span className="num">{w}</span></div>
          </div>
          <div className="field">
            <label>height <span className="ty">int</span></label>
            <div className="range"><input type="range" min={512} max={1536} step={64} value={h} onChange={(e) => setH(+e.target.value)} /><span className="num">{h}</span></div>
          </div>
        </div>

        <div className="field">
          <label>steps <span className="ty">int</span></label>
          <div className="range"><input type="range" min={1} max={8} step={1} value={steps} onChange={(e) => setSteps(+e.target.value)} /><span className="num">{steps}</span></div>
        </div>

        <div className={`advtoggle${adv ? ' open' : ''}`} onClick={() => setAdv((a) => !a)}>
          <span className="car"><Ic name="chevron-right" /></span> <span>{adv ? 'fewer inputs' : '4 more inputs'}</span>
        </div>
        <div className={`advanced${adv ? ' open' : ''}`}>
          <div className="field"><label>negative prompt <span className="opt">optional</span><span className="ty">text</span></label><input className="inp" placeholder="What to avoid…" /></div>
          <div className="field">
            <label>guidance <span className="opt">optional</span><span className="ty">float</span></label>
            <div className="range"><input type="range" min={0} max={10} step={0.1} value={guidance} onChange={(e) => setGuidance(+e.target.value)} /><span className="num">{guidance.toFixed(1)}</span></div>
          </div>
          <div className="row2">
            <div className="field"><label>seed <span className="opt">optional</span><span className="ty">int</span></label><input className="inp mono" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" /></div>
            <div className="field">
              <label>reference image <span className="opt">optional</span><span className="ty">image · uri</span></label>
              <div className="drop"><span className="ic"><Ic name="image-plus" /></span><span>Drop an image, or paste a URL</span></div>
            </div>
          </div>
        </div>

        {run && (
          <div className="result show">
            <h2><span className="ttdot" /> output</h2>
            <div className="out">
              <div className={`rimg${run.done ? ' done' : ''}`}>
                {!run.done && <><div className="ph" /><div className="stage"><span className="dots"><span /><span /><span /></span> {run.stage}</div></>}
              </div>
              <div className="exitus">
                <div className="er"><span>image</span><span className="v">{run.done ? 'flux-schnell.png' : '—'}</span></div>
                <div className="er"><span>seed</span><span className="v">{run.result?.seed ?? '—'}</span></div>
                <div className="er"><span>dimensions</span><span className="v">{run.result?.dim ?? `${w}×${h}`}</span></div>
                <div className="er"><span>model</span><span className="v">flux-schnell</span></div>
                <div className="er"><span>time</span><span className="v">{run.result?.time ?? '—'}</span></div>
                <div className="acts">
                  <button className="btn-ghost"><Ic name="sparkles" /> Save to Space</button>
                  <button className="btn-ghost"><Ic name="workflow" /> Send to Canvas</button>
                  <button className="btn-ghost" onClick={doRun}><Ic name="rotate-cw" /> Rerun</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="runbar"><div className="inner">
          <div className="quote"><span className="q mono">≈ ${quote}</span><span className="ql">upper-bound · pod-metered</span></div>
          <button className="btn-run" onClick={doRun} disabled={!!run && !run.done}>Run <span className="kbd">⌘⏎</span></button>
        </div></div>
      </div></div>
    </AppShell>
  );
}
