import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, getActivitySnapshot, subscribeActivity, type ActivityRow, type MeStatus, type SettledRun } from '../lib/api';
import { activityDoorHref, activityDoorLabel, activityKindLabel, queueLabel } from '../lib/muse';

const IMPETUS_USD = 0.000337;

// The stat cards under the page head. The balance is drawn whatever it reads: next to "Add
// credits" a zero balance is the fact the button acts on, the one case P-1c admits. Runs and
// studios are counts, and a count of nothing is not printed (DESIGN.md D-58) — the Activity
// list below already says what fills them. Before the read lands every card holds its place
// with an ellipsis (D-61).
export interface StatCard { l: string; n: string; d: string }
export function statCards(me: MeStatus | null, usdPerCredit = IMPETUS_USD): StatCard[] {
  if (!me) return [
    { l: 'Balance', n: '…', d: 'credits' },
    { l: 'Runs', n: '…', d: 'all time' },
    { l: 'Studios', n: '…', d: 'warm sessions' },
  ];
  const credits = Number(me.balanceImpetus);
  const usd = me.balanceUsd || credits * usdPerCredit;
  const cards: StatCard[] = [{ l: 'Balance', n: credits.toLocaleString(), d: `credits · ≈ $${usd.toFixed(2)}` }];
  if (me.gens.length > 0) cards.push({ l: 'Runs', n: String(me.gens.length), d: 'all time' });
  if (me.studios.length > 0) cards.push({ l: 'Studios', n: String(me.studios.length), d: 'warm sessions' });
  return cards;
}

export function Status() {
  const [me, setMe] = useState<MeStatus | null>(null);
  const [err, setErr] = useState(false);

  // Spend history (GET /v1/me/runs) — paginated, newest first, + lifetime running total.
  const [spend, setSpend] = useState<SettledRun[]>([]);
  const [spendTotal, setSpendTotal] = useState<{ impetus: string; usd: number } | null>(null);
  const [spendCursor, setSpendCursor] = useState<string | undefined>(undefined);
  const [spendLoaded, setSpendLoaded] = useState(false);
  const [spendLoading, setSpendLoading] = useState(false);
  // Runs the caller has given up from this page while they waited for a pod. Kept locally
  // because the activity poll is on its own clock: without it the row a user just released
  // would sit there claiming to be waiting until the next tick came round.
  const [stopped, setStopped] = useState<Record<string, 'busy' | 'done'>>({});

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

  // One activity list (GET /v1/me/activity) — the SAME poll the rail's badge reads
  // (noema-326), not a second request. The read is already newest-first across BOTH
  // in-flight and settled rows (CrystalApi#listActivity sorts on createdAt before doors
  // are attached), so rendering it in order is the one list REF-9 asks for — no
  // re-partition into separate running/finished bands.
  const { rows: activityRows, loaded: activityLoaded } = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getActivitySnapshot);

  const fmtElapsed = (ms?: number) => (ms == null ? '' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`);
  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

  // Stop waiting: the way out of the warm-pod line, from the list someone comes back to.
  // The reservation is released rather than charged, so a run given up before it ever
  // reached a pod costs nothing.
  const stopWaiting = (actumId: string) => {
    setStopped((s) => ({ ...s, [actumId]: 'busy' }));
    api.cancelRun(actumId)
      .then(() => setStopped((s) => ({ ...s, [actumId]: 'done' })))
      .catch(() => setStopped((s) => { const { [actumId]: _drop, ...rest } = s; return rest; }));
  };

  // What an in-flight row says on its right-hand side. A run holding a place in the warm-pod
  // line is NOT running, and saying "running" about it is the one thing this page must not do
  // — it is the page a user opens precisely because they walked away from the run.
  const runningRight = (row: ActivityRow) => {
    const elapsed = row.createdAt ? `${fmtElapsed(Date.now() - new Date(row.createdAt).getTime())} ago` : 'running';
    if (!row.queue) return elapsed;
    const state = stopped[row.actumId];
    if (state === 'done') return 'stopped · refunded';
    return (
      <>
        {queueLabel(row.queue)}
        {' '}
        <button
          className="btn-ghost"
          disabled={state === 'busy'}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); stopWaiting(row.actumId); }}
        >
          {state === 'busy' ? 'Stopping…' : 'Stop waiting'}
        </button>
      </>
    );
  };

  // One row's link: a generation's door is a raw media URL (a plain external anchor,
  // never a router Link), training/caption/decompose door through the source dataset
  // (a real in-app route), and a door-less row renders without a link at all. The
  // running/finished split that used to be two panels is now this one badge (F-40).
  const activityRow = (row: ActivityRow, right: ReactNode) => {
    const href = activityDoorHref(row);
    const body = (
      <>
        <div className="li-main">
          <div className="t">{row.modusLabel ?? activityKindLabel(row.kind)}</div>
          <div className="s">{activityKindLabel(row.kind)}{href ? ` · ${activityDoorLabel(row.kind)}` : ''}</div>
        </div>
        <div className="li-right" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
          <span className={`badge${row.status === 'running' ? ' accent' : ''}`}>{row.status === 'running' ? 'Running' : 'Done'}</span>
          {right}
        </div>
      </>
    );
    if (!href) return <div className="lrow" key={row.actumId}>{body}</div>;
    if (row.kind === 'generation') return <a className="lrow" href={href} target="_blank" rel="noreferrer" key={row.actumId}>{body}</a>;
    return <Link className="lrow" to={href} key={row.actumId}>{body}</Link>;
  };

  return (
    <AppShell crumb="Activity">
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div><h1>Activity</h1><div className="sub">Your balance, what’s running now, and where your credits go.</div></div>
          <div className="right"><Link className="btn" to="/funding"><Ic name="plus" /> Add credits</Link></div>
        </div>

        {err && <div className="warn">Couldn’t reach your account on staging.</div>}

        <div className="stats">
          {statCards(me).map((c) => (
            <div className="stat" key={c.l}><div className="l">{c.l}</div><div className="n">{c.n}</div><div className="d">{c.d}</div></div>
          ))}
        </div>

        <div className="sectionhead">Activity</div>
        {!activityLoaded ? (
          <div className="empty"><div className="t">Loading your activity…</div></div>
        ) : activityRows.length === 0 ? (
          <div className="empty">
            {/* One line that says what will appear here, and the one action that fills it: the
                same start path the home's empty bands take, to the catalogue (DESIGN.md D-60). */}
            <div className="t">Nothing running or finished yet — every run lands here the moment you start one.</div>
            <Link className="btn ghost" to="/catalog"><Ic name="sparkles" /> Create something</Link>
          </div>
        ) : (
          <div className="list">
            {activityRows.slice(0, 8).map((row) => activityRow(row, row.status === 'running' ? runningRight(row) : fmtDate(row.settledAt)))}
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
            {/* The same action fills this card. It is offered here only when the Activity card
                above is not already offering it, so the screen never shows the control twice
                (P-1d); with nothing running at all, the one button above is the one to press. */}
            <div className="t">No settled runs yet — what each run cost shows here once it finishes.</div>
            {activityRows.length > 0 && <Link className="btn ghost" to="/catalog"><Ic name="sparkles" /> Create something</Link>}
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
      </div></div>
    </AppShell>
  );
}
