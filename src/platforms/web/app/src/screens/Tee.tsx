import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api } from '../lib/api';
import type { TeeSessionView, TeePhase } from '../lib/api';
import { x25519 } from '@noble/curves/ed25519';

type StepState = 'done' | 'active' | 'pending';

// The session + its browser-side keypair. The PRIVATE key never leaves this browser —
// it's what the /tee tunnel client needs to bring the WireGuard link up.
interface StoredTee { sessionId: string; privateKey: string; publicKey: string }
const TEE_KEY = 'noema-tee';

const readStored = (): StoredTee | null => {
  try {
    const raw = localStorage.getItem(TEE_KEY);
    return raw ? (JSON.parse(raw) as StoredTee) : null;
  } catch { return null; }
};

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// A WireGuard keypair: clamped Curve25519 scalar + its public point, base64.
function wgKeypair(): { privateKey: string; publicKey: string } {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  priv[0] &= 248; priv[31] = (priv[31] & 127) | 64;
  return { privateKey: b64(priv), publicKey: b64(x25519.getPublicKey(priv)) };
}

// Map the live Phasis onto the four-step establishing line.
function steps(session: TeeSessionView | null, hasKeys: boolean): [StepState, StepState, StepState, StepState] {
  if (!session) return [hasKeys ? 'done' : 'pending', 'pending', 'pending', 'pending'];
  if (session.status === 'ready') return ['done', 'done', 'done', 'done'];
  const p: TeePhase | undefined = session.phase;
  if (p === 'attesting') return ['done', 'done', 'active', 'pending'];
  if (p && ['downloading', 'installing', 'loading', 'warming', 'executing'].includes(p)) return ['done', 'done', 'done', 'active'];
  return ['done', 'active', 'pending', 'pending']; // queued / provisioning / pulling
}

export function Tee() {
  const { ident } = useIdentity();
  const [stored, setStored] = useState<StoredTee | null>(readStored);
  const [session, setSession] = useState<TeeSessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);

  const drop = useCallback(() => {
    localStorage.removeItem(TEE_KEY);
    setStored(null);
    setSession(null);
  }, []);

  const refresh = useCallback((id: string) => {
    api.getTeeSession(id)
      .then(({ session: s }) => {
        if (s.status === 'ended') { drop(); return; }
        setSession(s);
      })
      .catch(() => drop()); // 404 → the pod is gone; forget the session
  }, [drop]);

  // Follow a stored session across reloads; poll while it's coming up.
  useEffect(() => {
    if (!stored) return;
    refresh(stored.sessionId);
  }, [stored, refresh]);
  useEffect(() => {
    if (!stored) return;
    const provisioning = !session || session.status === 'provisioning';
    pollRef.current = window.setInterval(() => refresh(stored.sessionId), provisioning ? 3000 : 15000);
    return () => window.clearInterval(pollRef.current);
  }, [stored, session?.status, refresh, session]);

  async function provision() {
    setBusy(true);
    setError(null);
    try {
      const keys = wgKeypair();
      const { session: s } = await api.provisionTee({ wgClientPublicKey: keys.publicKey });
      const next: StoredTee = { sessionId: s.sessionId, ...keys };
      localStorage.setItem(TEE_KEY, JSON.stringify(next));
      setStored(next);
      setSession(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    if (!stored) return;
    setBusy(true);
    try {
      await api.endTeeSession(stored.sessionId);
    } finally {
      setBusy(false);
      drop();
    }
  }

  const [s1, s2, s3, s4] = steps(session, !!stored);
  const ready = session?.status === 'ready';
  const failed = session?.phase === 'failed' || !!session?.error;

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Session</div>
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
        {session && <div className="meta-line"><span>session</span><span className="v mono">{session.sessionId.slice(0, 8)}</span></div>}
        {session?.gpuHours != null && <div className="meta-line"><span>metered</span><span className="v mono">{session.gpuHours.toFixed(2)} GPU-h</span></div>}
        <div className="eph" style={{ marginTop: 'var(--s3)' }}>
          <span className="pulse" />
          leaves no trace — nothing is kept
        </div>
      </div>
    </>
  );

  const badge = ready ? <span className="badge accent">tunnel up</span>
    : failed ? <span className="badge">failed</span>
    : session ? <span className="badge">{session.phase ?? 'provisioning'}</span>
    : <span className="badge">no session</span>;

  const stepDef: Array<{ st: StepState; t: string; s?: string }> = [
    { st: s1, t: 'WireGuard keypair', s: 'in your browser' },
    { st: s2, t: 'SECURE pod provisioned', s: session?.phase === 'pulling' ? 'pulling image…' : undefined },
    { st: s3, t: 'tunnel handshake', s: 'WireGuard · 51820' },
    { st: s4, t: 'runner ready', s: ready ? `ready${session?.tunnelIp ? ' · ' + session.tunnelIp : ''}` : session?.phase && s4 === 'active' ? `${session.phase}…` : undefined },
  ];

  return (
    <AppShell crumb="private" context={context}>
      <div className="page"><div className="pw">

        <div className="pagehead">
          <div>
            <h1>Private session <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>· in development</span></h1>
            <div className="sub">A single-tenant pod over your own WireGuard tunnel — network isolation, not hardware-sealed private compute. Hardware-sealed compute and browser-verified attestation are in development; until they ship, treat the pod host as inside the trust boundary.</div>
          </div>
          <div className="right">{badge}</div>
        </div>

        {error && <div className="mono" style={{ color: 'var(--bad, #c66)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s4)' }}>{error}</div>}
        {failed && (
          <div className="mono" style={{ color: 'var(--bad, #c66)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s4)' }}>
            session failed{session?.error ? ` — ${session.error}` : ''} · <button className="btn-ghost" onClick={drop}>start over</button>
          </div>
        )}

        {!stored ? (
          <>
            <div className="sectionhead">Start</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)', maxWidth: 520 }}>
              <div style={{ color: 'var(--faint)', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
                Provisioning generates a WireGuard keypair in this tab, leases a single-tenant pod, and hands
                you a tunnel only your browser holds the key to. Metered from your balance while it lives.
              </div>
              <div>
                <button className="btn" disabled={busy} onClick={provision}>
                  {busy ? 'provisioning…' : 'Provision private session'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="sectionhead">Establishing</div>
            <div className="stepline">
              {stepDef.map((d) => (
                <div key={d.t} className={`step ${d.st}`}>
                  <span className="pip">{d.st === 'done' && <Ic name="check" />}</span>
                  <div className="st-main">
                    <div className="t">{d.t}</div>
                    {d.s && <div className="s">{d.s}</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="sectionhead">Tunnel</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              <div className="secret">
                <span className="k">serverPublicKey</span>
                <span className="val">{session?.serverPublicKey ?? 'waiting for the pod…'}</span>
              </div>
              <div className="secret">
                <span className="k">endpoint</span>
                <span className="val">{session?.endpoint ?? '—'}</span>
              </div>
              <div className="secret">
                <span className="k">tunnelIp</span>
                <span className="val">{session?.tunnelIp ?? '—'}</span>
              </div>
              <div className="secret">
                <span className="k">yourPrivateKey</span>
                <span className="val" style={{ cursor: 'pointer' }} onClick={() => setShowKey((v) => !v)} title="click to reveal — the tunnel client needs it">
                  {showKey ? stored.privateKey : '••••••••  (click to reveal — never leaves this browser)'}
                </span>
              </div>
              <div className="secret">
                <span className="k">attestation</span>
                <span className="val hidden">stub · phase-3 pending</span>
              </div>
            </div>

            <div className="sectionhead"><span className="ttdot" /> What reaches noema <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>· target design (in development)</span></div>
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
                <div className="row"><span className="k">cost</span><span className="v">{session?.gpuHours != null ? `${session.gpuHours.toFixed(2)} GPU-h` : 'metered per GPU-minute'}</span></div>
              </div>
              <div style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)', lineHeight: 1.5 }}>
                This is the design target for the sealed tier. It is not yet in force: without attestation
                the pod host can still read session content. Do not rely on it until this tier ships.
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', marginTop: 'var(--s5)' }}>
              <a className="btn" href="/tee/" target="_blank" rel="noreferrer" aria-disabled={!ready}>
                Open tunnel client <Ic name="chevron-right" />
              </a>
              <button className="btn-ghost" disabled={busy} onClick={end}>End session</button>
              <div className="eph">
                <span className="pulse" />
                leaves no trace — pod terminates, tunnel drops, nothing is persisted
              </div>
            </div>
            <div className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)' }}>
              the tunnel client asks for your private key — paste it there; it never leaves your browser
            </div>
          </>
        )}

      </div></div>
    </AppShell>
  );
}
