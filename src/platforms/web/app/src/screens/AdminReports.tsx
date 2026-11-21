import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { doorPath } from '../lib/entry';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type QuerelaReport, type QuerelaKind, type QuerelaStatus, type QuerelaStanding, type QuerelaTakedown } from '../lib/api';
import { useSession } from '../state/session';

// AdminReports — the platform-admin triage queue for in-app reports (querelaAdminRouter.ts),
// linked from AdminWorkspace.tsx the same way /admin/review and /admin/partner-requests are.
// `me.admin` gates the UI client-side (cosmetic — the server re-asserts platform-admin on
// every GET/PATCH regardless), same pattern as those screens.
//
// `abuse` reports are the reporting mechanism MiniMax H3's licence requires (Section V.5):
// anyone can name a run whose output they believe breaks the terms; confirming it a
// `violation` here strikes the subject AND takes the run's output down (feed/bucket/
// marketplace publications retracted, any public gallery trace privatized) — the `takedown`
// the PATCH response carries back is shown on the row so an admin sees what actually happened,
// not just that a verdict was recorded. `dismissed` leaves the output exactly where it was.
// Every other kind (bug/feature/feedback) only ever takes a status.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KIND_TABS: { label: string; value: QuerelaKind | 'all' }[] = [
  { label: 'Abuse', value: 'abuse' },
  { label: 'Bug', value: 'bug' },
  { label: 'Feature', value: 'feature' },
  { label: 'Feedback', value: 'feedback' },
  { label: 'All', value: 'all' },
];

const STATUS_TABS: { label: string; value: QuerelaStatus | 'all' }[] = [
  { label: 'New', value: 'new' },
  { label: 'Closed', value: 'closed' },
  { label: 'All', value: 'all' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function AdminReports() {
  const { session, ready } = useSession();
  // Where the door hands this visitor back once their session is live: the page they were
  // already on. Turning someone away for want of an account should not also cost them the
  // walk back to what they were doing.
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const [admin, setAdmin] = useState(false);
  const [kindTab, setKindTab] = useState<QuerelaKind | 'all'>('abuse');
  const [statusTab, setStatusTab] = useState<QuerelaStatus | 'all'>('new');
  const [items, setItems] = useState<QuerelaReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!session) { setAdmin(false); return; }
    let live = true;
    api.getMe()
      .then((me) => { if (live) setAdmin(!!me.admin); })
      .catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, [ready, session]);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    setItems(null);
    api.adminListReports({
      kind: kindTab === 'all' ? undefined : kindTab,
      status: statusTab === 'all' ? undefined : statusTab,
    })
      .then((r) => { if (live) setItems(r.reports); })
      .catch((e) => { if (live) { setErr(msg(e)); setItems([]); } });
    return () => { live = false; };
  }, [admin, kindTab, statusTab]);

  const replace = (updated: QuerelaReport) =>
    setItems((cur) => (cur ?? []).map((r) => (r.id === updated.id ? updated : r)));

  return (
    <AppShell title="Reports · admin" gated={ready && !session}>
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div>
            <h1>Reports</h1>
            <div className="sub">In-app bug/feature/feedback/abuse reports. An abuse verdict of violation strikes the subject and takes the reported run's output down.</div>
          </div>
          <Link className="btn-ghost" to="/admin"><Ic name="chevron-left" /> Admin workspace</Link>
        </div>

        {err && <div className="warn">{err}</div>}

        {!ready && <div className="sub">Loading…</div>}

        {ready && !session && (
          <div className="empty">
            <div className="t">Sign in to continue</div>
            <div className="s">This surface is restricted to the platform administrator.</div>
            <Link className="btn" to={doorPath(here)}><Ic name="circle-user" /> Sign in</Link>
          </div>
        )}

        {ready && session && !admin && (
          <div className="empty">
            <div className="t">Not available</div>
            <div className="s">This surface is restricted to the platform administrator.</div>
          </div>
        )}

        {ready && session && admin && (
          <>
            <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
              {KIND_TABS.map((t) => (
                <button
                  key={t.value}
                  className={kindTab === t.value ? 'btn' : 'btn-ghost'}
                  onClick={() => setKindTab(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
              {STATUS_TABS.map((t) => (
                <button
                  key={t.value}
                  className={statusTab === t.value ? 'btn' : 'btn-ghost'}
                  onClick={() => setStatusTab(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {items === null && <div className="sub">Loading the queue…</div>}

            {items !== null && items.length === 0 && (
              <div className="empty">
                <div className="t">Nothing here</div>
                <div className="s">No reports in this view.</div>
              </div>
            )}

            {items?.map((r) => (
              <ReportRow key={r.id} report={r} onDecided={replace} onError={setErr} />
            ))}
          </>
        )}
      </div></div>
    </AppShell>
  );
}

function ReportRow({ report, onDecided, onError }: {
  report: QuerelaReport;
  onDecided: (updated: QuerelaReport) => void;
  onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState<null | 'violation' | 'dismissed' | 'closed' | 'new'>(null);
  const [standing, setStanding] = useState<QuerelaStanding[] | null>(null);
  const [takedown, setTakedown] = useState<QuerelaTakedown | null>(null);

  async function decideVerdict(verdict: 'violation' | 'dismissed') {
    setBusy(verdict);
    onError('');
    try {
      const res = await api.adminDecideReport(report.id, { verdict });
      onDecided(res.report);
      setStanding(res.subject ?? null);
      setTakedown(res.takedown ?? null);
    } catch (e) {
      onError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus(status: 'new' | 'closed') {
    setBusy(status);
    onError('');
    try {
      const res = await api.adminDecideReport(report.id, { status });
      onDecided(res.report);
    } catch (e) {
      onError(msg(e));
    } finally {
      setBusy(null);
    }
  }

  const decided = report.kind === 'abuse' ? !!report.verdict : report.status === 'closed';

  return (
    <div className="byo-row">
      <div className="byo-head">
        <span className="byo-prov">{report.kind}</span>
        <span className={`byo-state${report.status === 'closed' ? ' connected' : ''}`}>{report.status}</span>
        {report.verdict && <span className="byo-state">{report.verdict}</span>}
      </div>

      <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
        <div className="meta-line"><span>Description</span><span className="v">{report.description}</span></div>
        {report.feature && <div className="meta-line"><span>Feature</span><span className="v">{report.feature}</span></div>}
        {report.capturedState?.route && <div className="meta-line"><span>Route</span><span className="v">{report.capturedState.route}</span></div>}
        {report.capturedState?.runId && <div className="meta-line"><span>Run</span><span className="v mono">{report.capturedState.runId}</span></div>}
        {report.kind === 'abuse' && report.subjectOwnerKey && (
          <div className="meta-line"><span>Subject</span><span className="v mono">{report.subjectOwnerKey}</span></div>
        )}
        {report.clientError && <div className="meta-line"><span>Client error</span><span className="v mono">{report.clientError}</span></div>}
        <div className="meta-line"><span>Reporter</span><span className="v mono">{report.ownerKey}</span></div>
        <div className="meta-line"><span>Filed</span><span className="v">{fmtDate(report.natum)}</span></div>

        {standing && (
          <div className="sub mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {standing.map((s) => (
              <div key={s.terms}>
                {s.terms}: {s.strikes} strike{s.strikes === 1 ? '' : 's'}{s.suspended ? ' — subject now suspended' : ''}
              </div>
            ))}
          </div>
        )}

        {takedown && (
          <div className="sub mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {takedown.error
              ? <span>takedown failed: {takedown.error}</span>
              : (
                <>
                  <div>retracted: {(takedown.retracted ?? []).length} publication{(takedown.retracted ?? []).length === 1 ? '' : 's'}</div>
                  {(takedown.skipped ?? []).length > 0 && (
                    <div>could not retract: {(takedown.skipped ?? []).map((s) => `${s.destination} (${s.reason})`).join(', ')}</div>
                  )}
                  {(takedown.privatizedVestigia ?? []).length > 0 && (
                    <div>privatized {takedown.privatizedVestigia!.length} gallery trace{takedown.privatizedVestigia!.length === 1 ? '' : 's'}</div>
                  )}
                </>
              )}
          </div>
        )}
      </div>

      <div className="byo-body byo-connect" style={{ gap: 'var(--s3)' }}>
        {report.kind === 'abuse' && !report.verdict && (
          <>
            <button className="btn" disabled={!!busy} onClick={() => decideVerdict('violation')}>
              {busy === 'violation' ? 'Confirming…' : 'Confirm violation'}
            </button>
            <button className="btn-ghost" disabled={!!busy} onClick={() => decideVerdict('dismissed')}>
              {busy === 'dismissed' ? 'Dismissing…' : 'Dismiss'}
            </button>
          </>
        )}
        {report.kind !== 'abuse' && (
          <button className="btn-ghost" disabled={!!busy} onClick={() => toggleStatus(decided ? 'new' : 'closed')}>
            {busy === (decided ? 'new' : 'closed') ? 'Saving…' : decided ? 'Reopen' : 'Close'}
          </button>
        )}
      </div>
    </div>
  );
}
