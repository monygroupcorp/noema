import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { Ic } from '../lib/icons';
import { api, type MeStatus, type SettledRun } from '../lib/api';

const IMPETUS_USD = 0.000337;

export function Status() {
  const { ident } = useIdentity();
  const [me, setMe] = useState<MeStatus | null>(null);
  const [err, setErr] = useState(false);

  // Spend history (GET /v1/me/runs) — paginated, newest first, + lifetime running total.
  const [spend, setSpend] = useState<SettledRun[]>([]);
  const [spendTotal, setSpendTotal] = useState<{ impetus: string; usd: number } | null>(null);
  const [spendCursor, setSpendCursor] = useState<string | undefined>(undefined);
  const [spendLoaded, setSpendLoaded] = useState(false);
  const [spendLoading, setSpendLoading] = useState(false);

  useEffect(() => {
    let live = true;
    api.meStatus().then((s) => { if (live) setMe(s); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setSpendLoading(true);
    api.listRuns({ limit: 10 })
      .then((p) => {
        if (!live) return;
        setSpend(p.runs);
        setSpendTotal(p.runningTotal);
        setSpendCursor(p.nextCursor);
      })
      .catch(() => { /* leave empty state */ })
      .finally(() => { if (live) { setSpendLoaded(true); setSpendLoading(false); } });
    return () => { live = false; };
  }, []);

  const loadMoreSpend = () => {
    if (!spendCursor || spendLoading) return;
    setSpendLoading(true);
    api.listRuns({ cursor: spendCursor, limit: 10 })
      .then((p) => {
        setSpend((prev) => [...prev, ...p.runs]);
        setSpendTotal(p.runningTotal);
        setSpendCursor(p.nextCursor);
      })
      .catch(() => { /* keep what we have */ })
      .finally(() => setSpendLoading(false));
  };

  const credits = me ? Number(me.balanceImpetus) : 0;
  const usd = me ? (me.balanceUsd || credits * IMPETUS_USD) : 0;
  const runs = me?.gens.length ?? 0;
  const studios = me?.studios.length ?? 0;
  const fmtElapsed = (ms?: number) => (ms == null ? '' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`);
  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

  return (
    <AppShell crumb="activity">
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div><h1>Activity</h1><div className="sub">Your balance, what’s running now, and where your credits go.</div></div>
          <div className="right"><Link className="btn" to="/funding"><Ic name="plus" /> Add credits</Link></div>
        </div>

        {err && <div className="warn">Couldn’t reach your account on staging.</div>}

        <div className="stats">
          <div className="stat"><div className="l">Balance</div><div className="n">{me ? credits.toLocaleString() : '…'}</div><div className="d">credits · ≈ ${usd.toFixed(2)}</div></div>
          <div className="stat"><div className="l">Runs</div><div className="n">{me ? runs : '…'}</div><div className="d">all time</div></div>
          <div className="stat"><div className="l">Studios</div><div className="n">{me ? studios : '…'}</div><div className="d">warm sessions</div></div>
        </div>

        <div className="sectionhead">Active runs</div>
        {!me ? (
          <div className="empty"><div className="t">Loading your account…</div></div>
        ) : runs === 0 ? (
          <div className="empty">
            <div className="ico"><Ic name="sparkles" /></div>
            <div className="t">Nothing running right now — queued &amp; in-flight gens show here; finished ones live in your <Link to="/space" style={{ color: 'var(--accent-soft)' }}>space</Link>.</div>
          </div>
        ) : (
          <div className="list">
            {me.gens.slice(0, 8).map((gn) => (
              <Link className="lrow" to={`/run?id=${gn.actumId}`} key={gn.actumId}>
                <div className="li-main">
                  <div className="t">{gn.modusLabel}</div>
                  <div className="s">{gn.status === 'agens' ? 'running' : 'queued'}{gn.studio ? ` · ${gn.studio.hostLabel}` : ''}</div>
                </div>
                <div className="li-right">{gn.status === 'agens' ? fmtElapsed(gn.elapsedMs) : gn.etaMs ? `~${fmtElapsed(gn.etaMs)}` : ''}</div>
              </Link>
            ))}
          </div>
        )}

        <div className="sectionhead">
          Spend
          {spendTotal && spend.length > 0 && (
            <span className="sub" style={{ marginLeft: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
              {Number(spendTotal.impetus).toLocaleString()} credits all time · ≈ ${spendTotal.usd.toFixed(2)}
            </span>
          )}
        </div>
        {!spendLoaded ? (
          <div className="empty"><div className="t">Loading your spend history…</div></div>
        ) : spend.length === 0 ? (
          <div className="empty">
            <div className="ico"><Ic name="receipt-text" /></div>
            <div className="t">
              No settled runs yet — once a generation finishes, what it cost shows here. Finished work lives in your{' '}
              <Link to="/space" style={{ color: 'var(--accent-soft)' }}>space</Link>.
            </div>
          </div>
        ) : (
          <>
            <div className="list">
              {/* r.id is the settled run's actumId (runProjection.ts#toSettledRun: id = entry.actumId) — same id /run?id= reads. */}
              {spend.map((r) => (
                <Link className="lrow" to={`/run?id=${r.id}`} key={r.id}>
                  <div className="li-main">
                    <div className="t">{r.modusLabel}</div>
                    <div className="s">{fmtDate(r.settledAt)}</div>
                  </div>
                  <div className="li-right">{Number(r.cost).toLocaleString()} cr · ${r.costUsd.toFixed(2)}</div>
                </Link>
              ))}
            </div>
            {spendCursor && (
              <button className="btn" onClick={loadMoreSpend} disabled={spendLoading} style={{ marginTop: 'var(--s3)' }}>
                {spendLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}

        <div className="sub" style={{ marginTop: 'var(--s5)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
          Live from staging · {ident.funding === 'named' ? 'signed-in account' : 'anonymous session'}.
        </div>
      </div></div>
    </AppShell>
  );
}
