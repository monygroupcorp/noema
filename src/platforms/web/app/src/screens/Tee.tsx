import { useEffect, useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';

type StepState = 'done' | 'active' | 'pending';

export function Tee() {
  const { ident } = useIdentity();
  const [runnerState, setRunnerState] = useState<StepState>('active');

  useEffect(() => {
    const t = setTimeout(() => setRunnerState('done'), 1500);
    return () => clearTimeout(t);
  }, []);

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Session</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
        <div className="eph" style={{ marginTop: 'var(--s3)' }}>
          <span className="pulse" />
          leaves no trace — nothing is kept
        </div>
      </div>
    </>
  );

  return (
    <AppShell crumb="private" context={context}>
      <div className="page"><div className="pw">

        <div className="pagehead">
          <div>
            <h1>Private session</h1>
            <div className="sub">Sealed compute over your own tunnel. We provision and meter — we never see the work.</div>
          </div>
          <div className="right">
            <span className="badge accent">tunnel up</span>
          </div>
        </div>

        <div className="sectionhead">Establishing</div>
        <div className="stepline">
          <div className="step done">
            <span className="pip"><Ic name="check" /></span>
            <div className="st-main">
              <div className="t">WireGuard keypair</div>
              <div className="s">in your browser</div>
            </div>
          </div>
          <div className="step done">
            <span className="pip"><Ic name="check" /></span>
            <div className="st-main">
              <div className="t">SECURE pod provisioned</div>
              <div className="s">SEV-SNP</div>
            </div>
          </div>
          <div className="step done">
            <span className="pip"><Ic name="check" /></span>
            <div className="st-main">
              <div className="t">tunnel handshake</div>
              <div className="s">WireGuard · 51820</div>
            </div>
          </div>
          <div className={`step ${runnerState}`}>
            <span className="pip">
              {runnerState === 'done' && <Ic name="check" />}
            </span>
            <div className="st-main">
              <div className="t">runner ready</div>
              <div className="s">
                {runnerState === 'done' ? 'ready · 10.13.0.2' : 'starting…'}
              </div>
            </div>
          </div>
        </div>

        <div className="sectionhead">Tunnel</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <div className="secret">
            <span className="k">serverPublicKey</span>
            <span className="val">u9Kp…3afQ=</span>
          </div>
          <div className="secret">
            <span className="k">endpoint</span>
            <span className="val">100.65.0.1:51820</span>
          </div>
          <div className="secret">
            <span className="k">tunnelIp</span>
            <span className="val">10.13.0.2</span>
          </div>
          <div className="secret">
            <span className="k">attestation</span>
            <span className="val hidden">stub · phase-3 pending</span>
          </div>
        </div>

        <div className="sectionhead"><span className="ttdot" /> What reaches noema</div>
        <div style={{
          border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--hair))',
          borderRadius: 'var(--radius)',
          background: 'var(--panel)',
          padding: 'var(--s5)',
          boxShadow: '0 0 0 4px var(--accent-bg)',
        }}>
          <div className="redact mono">
            <div className="row"><span className="k">who</span><span className="v block">▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">prompt</span><span className="v block">▮▮▮▮▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">output</span><span className="v block">▮▮▮▮▮▮</span></div>
            <div className="row"><span className="k">cost</span><span className="v">$0.043 · 12 GPU-min</span></div>
          </div>
          <div style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)', lineHeight: 1.5 }}>
            Everything but the meter stays inside your tunnel.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', marginTop: 'var(--s5)' }}>
          <button className="btn">Open private chat <Ic name="chevron-right" /></button>
          <div className="eph">
            <span className="pulse" />
            leaves no trace — pod terminates, tunnel drops, nothing is persisted
          </div>
        </div>

      </div></div>
    </AppShell>
  );
}
