import { useState, useEffect } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';

type StepState = 'done' | 'active' | 'pending';

interface Step {
  label: string;
  sub: string;
  state: StepState;
}

interface RunResult {
  img: string;
  seed: number;
  time: string;
}

const INITIAL_STEPS: Step[] = [
  { label: 'admitted',       sub: 'quote $0.043 · cap ok',    state: 'done'    },
  { label: 'provisioned pod',sub: 'runpod · rtx 4090 · 41s',  state: 'done'    },
  { label: 'generating',     sub: 'stage 2 / 3 · 6s',         state: 'active'  },
  { label: 'upload → R2',    sub: 'pending',                   state: 'pending' },
  { label: 'settle ledger',  sub: 'pending',                   state: 'pending' },
];

export function Run() {
  const { ident } = useIdentity();
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [status, setStatus] = useState('running · 6s elapsed');
  const [badgeText, setBadgeText] = useState('running');
  const [badgeDone, setBadgeDone] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [imgDone, setImgDone] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => {
      // generating → done, upload → active, rimg done, fill outputs
      setSteps((prev) => prev.map((s, i) => {
        if (i === 2) return { ...s, state: 'done' as StepState, sub: '3 / 3 · 3.2s' };
        if (i === 3) return { ...s, state: 'active' as StepState };
        return s;
      }));
      setImgDone(true);
      setResult({ img: 'flux-schnell.png', seed: 428193044, time: '3.2s' });
    }, 1400));

    timers.push(setTimeout(() => {
      // upload → done, settle → active
      setSteps((prev) => prev.map((s, i) => {
        if (i === 3) return { ...s, state: 'done' as StepState, sub: 'flux-schnell.png' };
        if (i === 4) return { ...s, state: 'active' as StepState };
        return s;
      }));
    }, 2500));

    timers.push(setTimeout(() => {
      // settle → done, status/badge complete
      setSteps((prev) => prev.map((s, i) => {
        if (i === 4) return { ...s, state: 'done' as StepState, sub: '-43 credits · settled' };
        return s;
      }));
      setStatus('complete · 47s total');
      setBadgeText('complete');
      setBadgeDone(true);
    }, 3400));

    return () => timers.forEach(clearTimeout);
  }, []);

  const context = (
    <div className="csec">
      <div className="ctitle">Session</div>
      <div className="meta-line"><span>spent</span><span className="v mono">$0.043</span></div>
      <div className="meta-line"><span>this run</span><span className="v mono">12 GPU-min</span></div>
      <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
    </div>
  );

  return (
    <AppShell
      crumb={<>runs <span className="sep">/</span> <span className="mono">run_8fa3c1</span></>}
      context={context}
    >
      <div className="page"><div className="pw narrow">

        <div className="pagehead">
          <div>
            <h1>make · flux-schnell</h1>
            <div className={`sub mono`}>{status}</div>
          </div>
          <div className="right">
            <span className={`badge${badgeDone ? '' : ' accent'}`}>{badgeText}</span>
          </div>
        </div>

        <div className="sectionhead">Stages</div>
        <div className="stepline">
          {steps.map((step, i) => (
            <div key={i} className={`step ${step.state}`}>
              <span className="pip">
                {step.state === 'done' && <Ic name="check" />}
              </span>
              <div className="st-main">
                <div className="t">{step.label}</div>
                <div className="s">{step.sub}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="sectionhead"><span className="ttdot" /> Result</div>
        <div className="result show">
          <div className="out">
            <div className={`rimg${imgDone ? ' done' : ''}`}>
              {!imgDone && (
                <>
                  <div className="ph" />
                  <div className="stage">
                    <span className="dots"><span /><span /><span /></span>
                    {' '}generating…
                  </div>
                </>
              )}
            </div>
            <div className="exitus">
              <div className="er"><span>image</span><span className="v">{result?.img ?? '—'}</span></div>
              <div className="er"><span>seed</span><span className="v">{result?.seed ?? '—'}</span></div>
              <div className="er"><span>dimensions</span><span className="v">1024×1024</span></div>
              <div className="er"><span>model</span><span className="v">flux-schnell</span></div>
              <div className="er"><span>time</span><span className="v">{result?.time ?? '—'}</span></div>
              <div className="acts">
                <button className="btn-ghost"><Ic name="sparkles" /> Save to Space</button>
                <button className="btn-ghost"><Ic name="workflow" /> Send to Canvas</button>
                <button className="btn-ghost"><Ic name="rotate-cw" /> Rerun</button>
              </div>
            </div>
          </div>
        </div>

      </div></div>
    </AppShell>
  );
}
