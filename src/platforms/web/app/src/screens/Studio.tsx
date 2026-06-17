import { useEffect, useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';

const RATE_PER_HR = 2.04;
const RATE_PER_SEC = RATE_PER_HR / 3600;
const BUDGET = 5.00;
// Spike started at 12:04 elapsed with $0.41 spent — match that initial state
const INITIAL_SECS = 12 * 60 + 4;
const INITIAL_SPENT = 0.41;

function mmss(s: number): string {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

export function Studio() {
  const { ident } = useIdentity();
  const [secs, setSecs] = useState(INITIAL_SECS);
  const [spent, setSpent] = useState(INITIAL_SPENT);

  useEffect(() => {
    const id = setInterval(() => {
      setSecs((s) => s + 1);
      setSpent((sp) => sp + RATE_PER_SEC);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const budgetLeft = Math.max(0, BUDGET - spent);

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Composition</div>
        <div className="meta-line"><span>pod</span><span className="v mono">rtx 4090</span></div>
        <div className="meta-line"><span>session</span><span className="v mono">sticky session</span></div>
        <div className="meta-line"><span>host</span><span className="v mono">you</span></div>
        <div className="meta-line"><span>meter</span><span className="v mono">$2.04 / hr</span></div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb="studio" context={context}>
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div>
            <h1>Studio</h1>
            <div className="sub">A warm pod, leased and metered. Keep it open to run instantly.</div>
          </div>
          <div className="right"><span className="badge accent">ready</span></div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="l">Elapsed</div>
            <div className="n">{mmss(secs)}</div>
            <div className="d">since lease opened</div>
          </div>
          <div className="stat">
            <div className="l">Spent</div>
            <div className="n">${spent.toFixed(2)}</div>
            <div className="d">metered</div>
          </div>
          <div className="stat">
            <div className="l">Rate</div>
            <div className="n">$2.04</div>
            <div className="d">per hour · pod</div>
          </div>
          <div className="stat">
            <div className="l">Budget left</div>
            <div className="n">${budgetLeft.toFixed(2)}</div>
            <div className="d">soft cap $5.00</div>
          </div>
        </div>

        <div className="sectionhead">Lease</div>
        <div className="stepline">
          <div className="step done">
            <span className="pip"><Ic name="check" /></span>
            <div className="st-main"><div className="t">session opened</div></div>
          </div>
          <div className="step done">
            <span className="pip"><Ic name="check" /></span>
            <div className="st-main">
              <div className="t">pod provisioned</div>
              <div className="s">rtx 4090</div>
            </div>
          </div>
          <div className="step done">
            <span className="pip"><Ic name="check" /></span>
            <div className="st-main"><div className="t">host attributed</div></div>
          </div>
          <div className="step active">
            <span className="pip" />
            <div className="st-main">
              <div className="t">metering active</div>
              <div className="s">$2.04 / hr</div>
            </div>
          </div>
        </div>

        <div className="sectionhead"><span className="ttdot" /> Controls</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          <button className="btn">Run here</button>
          <button className="btn-ghost">Release studio</button>
        </div>
        <div className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)' }}>
          warm reuse cuts cost per gen
        </div>
      </div></div>
    </AppShell>
  );
}
