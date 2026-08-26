import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { Ic } from '../lib/icons';
import { api, getActivitySnapshot, subscribeActivity, type ActivityRow, type MeStatus, type SettledRun } from '../lib/api';
import { activityDoorHref, activityDoorLabel, activityKindLabel, partitionActivity } from '../lib/muse';

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

  // Running-now / recently-finished bands (GET /v1/me/activity) — the SAME poll the
  // rail's badge reads (noema-326), not a second request.
  const { rows: activityRows, loaded: activityLoaded } = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getActivitySnapshot);
  const { running, finished } = partitionActivity(activityRows);

  const credits = me ? Number(me.balanceImpetus) : 0;
  const usd = me ? (me.balanceUsd || credits * IMPETUS_USD) : 0;
  const runs = me?.gens.length ?? 0;
  const studios = me?.studios.length ?? 0;
  const fmtElapsed = (ms?: number) => (ms == null ? '' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`);
  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

  // One row's link: a generation's door is a raw media URL (a plain external anchor,
  // never a router Link), training/caption/decompose door through the source dataset
  // (a real in-app route), and a door-less row renders without a link at all.
  const activityRow = (row: ActivityRow, right: ReactNode) => {
    const href = activityDoorHref(row);
    const body = (
      <>
        <div className="li-main">
          <div className="t">{row.modusLabel ?? activityKindLabel(row.kind)}</div>
          <div className="s">{activityKindLabel(row.kind)}{href ? ` · ${activityDoorLabel(row.kind)}` : ''}</div>
        </div>
        <div className="li-right">{right}</div>
      </>
    );
    if (!href) return <div className="lrow" key={row.actumId}>{body}</div>;
    if (row.kind === 'generation') return <a className="lrow" href={href} target="_blank" rel="noreferrer" key={row.actumId}>{body}</a>;
    return <Link className="lrow" to={href} key={row.actumId}>{body}</Link>;
  };

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

        <div className="sectionhead">Running now</div>
        {!activityLoaded ? (
          <div className="empty"><div className="t">Loading what’s running…</div></div>
        ) : running.length === 0 ? (
          <div className="empty">
            <div className="ico"><Ic name="sparkles" /></div>
            <div className="t">Nothing running right now — queued &amp; in-flight runs show here the moment you fire one.</div>
          </div>
        ) : (
          <div className="list">
            {running.slice(0, 8).map((row) =>
              activityRow(row, row.createdAt ? `${fmtElapsed(Date.now() - new Date(row.createdAt).getTime())} ago` : 'running'))}
          </div>
        )}

        <div className="sectionhead">Recently finished</div>
        {!activityLoaded ? (
          <div className="empty"><div className="t">Loading recent activity…</div></div>
        ) : finished.length === 0 ? (
          <div className="empty">
            <div className="ico"><Ic name="footprints" /></div>
            <div className="t">Nothing finished yet — a completed run lands here, and stays in your <Link to="/space" style={{ color: 'var(--accent-soft)' }}>space</Link> after.</div>
          </div>
        ) : (
          <div className="list">
            {finished.slice(0, 8).map((row) => activityRow(row, fmtDate(row.settledAt)))}
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
