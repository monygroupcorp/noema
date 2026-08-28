import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { api } from '../lib/api';
import type { Fundamentum, StudioView } from '../lib/api';
import { formatImpetus } from '../lib/format';

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// The screen's one live studio: newest non-terminated (the API lists the caller's live ones).
const pickLive = (studios: StudioView[]) => studios.find((s) => s.status !== 'terminated') ?? null;

export function Studio() {
  const { ident } = useIdentity();
  const [studio, setStudio] = useState<StudioView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Arm form
  const [fundamenta, setFundamenta] = useState<Fundamentum[]>([]);
  const [fundamentumId, setFundamentumId] = useState('');
  const [budget, setBudget] = useState('');
  const [arming, setArming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  // Local 1s tick for the warm countdown between polls.
  const [now, setNow] = useState(() => Date.now());
  const pollRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    api.listStudios()
      .then(({ studios }) => { setStudio(pickLive(studios)); setError(null); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoaded(true));
  }, []);

  // Load + poll: fast while provisioning/draining (state is in motion), slow while settled.
  useEffect(() => {
    refresh();
  }, [refresh, ident.id]);
  useEffect(() => {
    const inMotion = studio?.status === 'provisioning' || studio?.status === 'draining';
    pollRef.current = window.setInterval(refresh, inMotion ? 4000 : 15000);
    return () => window.clearInterval(pollRef.current);
  }, [refresh, studio?.status]);
  useEffect(() => {
    if (!studio?.warmUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [studio?.warmUntil]);

  // Fundamenta feed the arm picker only when there's nothing live.
  useEffect(() => {
    if (studio || !loaded) return;
    api.listFundamenta()
      .then(({ fundamenta }) => {
        setFundamenta(fundamenta);
        setFundamentumId((cur) => cur || fundamenta[0]?.id || '');
      })
      .catch(() => {});
  }, [studio, loaded]);

  async function arm() {
    setArming(true);
    setError(null);
    try {
      const body: Parameters<typeof api.provisionStudio>[0] = {};
      if (fundamentumId) body.fundamentumId = fundamentumId;
      const b = Number(budget.replace(/[^\d]/g, ''));
      if (b > 0) body.maxImpetus = String(b);
      const { studio: s } = await api.provisionStudio(body);
      setStudio(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setArming(false);
    }
  }

  async function release() {
    if (!studio) return;
    setReleasing(true);
    setError(null);
    try {
      const { studio: s } = await api.releaseStudio(studio.studioId);
      setStudio(s.status === 'terminated' ? null : s);
    } catch (e) {
      setError(String(e));
    } finally {
      setReleasing(false);
    }
  }

  const warmLeftMs = studio?.warmUntil ? new Date(studio.warmUntil).getTime() - now : null;
  const live = studio && (studio.status === 'idle' || studio.status === 'running');
  const rate = studio?.costPerHr;

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">Composition</div>
        {studio ? (
          <>
            {studio.gpu && <div className="meta-line"><span>pod</span><span className="v mono">{studio.gpu}</span></div>}
            {studio.runtime && <div className="meta-line"><span>runtime</span><span className="v mono">{studio.runtime}</span></div>}
            <div className="meta-line"><span>session</span><span className="v mono">{studio.studioId.slice(0, 8)}</span></div>
            <div className="meta-line"><span>host</span><span className="v mono">you</span></div>
            {rate != null && <div className="meta-line"><span>meter</span><span className="v mono">${rate.toFixed(2)} / hr</span></div>}
          </>
        ) : (
          <div className="meta-line"><span>session</span><span className="v mono">none</span></div>
        )}
        <div className="meta-line"><span>balance</span><span className="v mono">{ident.bal}</span></div>
      </div>
    </>
  );

  const badge = !loaded ? null
    : !studio ? <span className="badge">no lease</span>
    : studio.status === 'provisioning' ? <span className="badge">provisioning</span>
    : studio.status === 'draining' ? <span className="badge">draining</span>
    : <span className="badge accent">ready</span>;

  return (
    <AppShell crumb="studio" context={context}>
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div>
            <h1>Studio</h1>
            <div className="sub">A warm pod, leased and metered. Keep it open to run instantly.</div>
          </div>
          <div className="right">{badge}</div>
        </div>

        {error && <div className="mono" style={{ color: 'var(--bad, #c66)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s4)' }}>{error}</div>}

        {!loaded ? (
          <div className="mono" style={{ color: 'var(--faint)' }}>checking for a live studio…</div>
        ) : !studio ? (
          <>
            <div className="sectionhead">Lease a studio</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)', maxWidth: 480 }}>
              <label className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
                substrate
                <select className="mobile-zoom-safe" value={fundamentumId} onChange={(e) => setFundamentumId(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
                  {fundamenta.length === 0 && <option value="">loading substrates…</option>}
                  {fundamenta.map((f) => (
                    <option key={f.id} value={f.id}>
                      {(f.nomen ?? f.id) + (f.vramGb ? ` · ${f.vramGb}GB` : '')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
                session budget (credits, optional — defaults to your full balance)
                <input className="mobile-zoom-safe" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 5000" inputMode="numeric" style={{ display: 'block', width: '100%', marginTop: 4 }} />
              </label>
              <div>
                <button className="btn" disabled={arming || !fundamentumId} onClick={arm}>
                  {arming ? 'leasing…' : 'Lease studio'}
                </button>
              </div>
              <div className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
                the pod boots in the background — this page follows it live. The budget is a hard cap: the studio drains and terminates when it's spent.
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="stats">
              <div className="stat">
                <div className="l">Warm window</div>
                <div className="n">{warmLeftMs != null ? mmss(warmLeftMs) : '—'}</div>
                <div className="d">until the lease expires</div>
              </div>
              <div className="stat">
                <div className="l">Rate</div>
                <div className="n">{rate != null ? `$${rate.toFixed(2)}` : '—'}</div>
                <div className="d">per hour · pod</div>
              </div>
              <div className="stat">
                <div className="l">Budget</div>
                <div className="n">{formatImpetus(studio.budgetImpetus)}</div>
                <div className="d">hard session cap</div>
              </div>
              <div className="stat">
                <div className="l">State</div>
                <div className="n">{studio.status}</div>
                <div className="d">pod liveness</div>
              </div>
            </div>

            <div className="sectionhead">Lease</div>
            <div className="stepline">
              <div className="step done">
                <span className="pip"><Ic name="check" /></span>
                <div className="st-main"><div className="t">session opened</div></div>
              </div>
              <div className={`step ${studio.status === 'provisioning' ? 'active' : 'done'}`}>
                <span className="pip">{studio.status !== 'provisioning' && <Ic name="check" />}</span>
                <div className="st-main">
                  <div className="t">pod provisioned</div>
                  <div className="s">{studio.gpu ?? (studio.status === 'provisioning' ? 'booting…' : '')}</div>
                </div>
              </div>
              <div className={`step ${live ? 'done' : 'pending'}`}>
                <span className="pip">{live && <Ic name="check" />}</span>
                <div className="st-main"><div className="t">host attributed</div></div>
              </div>
              <div className={`step ${live ? 'active' : studio.status === 'draining' ? 'done' : 'pending'}`}>
                <span className="pip" />
                <div className="st-main">
                  <div className="t">{studio.status === 'draining' ? 'draining' : 'metering active'}</div>
                  {rate != null && <div className="s">${rate.toFixed(2)} / hr</div>}
                </div>
              </div>
            </div>

            <div className="sectionhead"><span className="ttdot" /> Controls</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              <Link className="btn" to={`/card?studio=${encodeURIComponent(studio.studioId)}`}>Run here</Link>
              <button className="btn" disabled={releasing} onClick={release}>
                {releasing ? 'releasing…' : 'Release studio'}
              </button>
            </div>
            <div className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)' }}>
              warm reuse cuts cost per gen · the lease releases itself at the warm-window end or the budget cap
            </div>
          </>
        )}
      </div></div>
    </AppShell>
  );
}
