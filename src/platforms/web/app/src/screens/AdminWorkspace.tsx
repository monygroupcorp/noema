import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';
import type { RevenueReport, CogsReport } from '../lib/api';
import { useSession } from '../state/session';

// Admin workspace hub — credits-only, read-only observability + the existing moderation queue,
// in one place (noema-011). NO payouts/disbursement/tax here; that stays out of scope. Every
// fetch is guarded behind me.admin client-side, but the server always re-gates each report with
// _assertPlatformAdmin — the client guard is cosmetic, not the security boundary.

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export function AdminWorkspace() {
  const { session, ready } = useSession();
  const [admin, setAdmin] = useState(false);
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [cogs, setCogs] = useState<CogsReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!session) { setAdmin(false); return; }
    let live = true;
    api.getMe()
      .then((me) => {
        if (!live) return;
        setAdmin(!!me.admin);
        if (!me.admin) return;
        return Promise.all([api.getRevenueReport(), api.getCogsReport()])
          .then(([r, c]) => { if (live) { setRevenue(r); setCogs(c); } });
      })
      .catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, [ready, session]);

  return (
    <AppShell title="Admin workspace">
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div>
            <h1>Admin workspace</h1>
            <div className="sub">Moderation, revenue, and cost — one hub. Credits-only, read-only observability. No payouts, no disbursement, no tax.</div>
          </div>
        </div>

        {err && <div className="warn">{err}</div>}

        {!ready && <div className="sub">Loading…</div>}

        {ready && !session && (
          <div className="empty">
            <div className="t">Sign in to continue</div>
            <div className="s">The admin workspace is restricted to the platform administrator.</div>
            <Link className="btn" to="/onboard"><Ic name="circle-user" /> Sign in</Link>
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
            <div className="byo-row">
              <div className="byo-head">
                <span className="byo-prov">Moderation</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s3)' }}>
                <div className="sub">Publications the moderation gate held, awaiting approve/reject/confirm-CSAM.</div>
                <Link className="btn" to="/admin/review" style={{ alignSelf: 'flex-start' }}><Ic name="eye" /> Open feed review</Link>
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head">
                <span className="byo-prov">Partner requests</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s3)' }}>
                <div className="sub">The B2B partner-program intake queue, awaiting approve/decline.</div>
                <Link className="btn" to="/admin/partner-requests" style={{ alignSelf: 'flex-start' }}><Ic name="users" /> Open partner requests</Link>
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head">
                <span className="byo-prov">Revenue</span>
                <span className="byo-state connected">trailing 12mo</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s3)' }}>
                {revenue ? (
                  <>
                    <div className="sub mono" style={{ fontSize: 'var(--fs-xs)' }}>as of {new Date(revenue.asOf).toLocaleString()}</div>
                    <div style={{ fontSize: 'var(--fs-xl, 1.5rem)', fontWeight: 600 }}>{revenue.trailingUsdRevenue}</div>
                    <div className="sub">
                      band: <b>{revenue.band}</b>
                      {revenue.bindingCapUsd !== null && <> · cap {money(revenue.bindingCapUsd)}</>}
                      {revenue.lastAlertedBand && <> · last alerted: {revenue.lastAlertedBand}</>}
                    </div>
                  </>
                ) : <div className="sub">Loading…</div>}
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head">
                <span className="byo-prov">COGS</span>
                <span className="byo-state connected">trailing window</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s3)' }}>
                {cogs ? (
                  <>
                    <div className="sub mono" style={{ fontSize: 'var(--fs-xs)' }}>since {new Date(cogs.sinceIso).toLocaleDateString()}</div>
                    <div style={{ fontSize: 'var(--fs-xl, 1.5rem)', fontWeight: 600 }}>{money(cogs.costUsd)}</div>
                    <div className="sub">{cogs.count.toLocaleString()} job{cogs.count === 1 ? '' : 's'} in window</div>
                  </>
                ) : <div className="sub">Loading…</div>}
              </div>
            </div>
          </>
        )}
      </div></div>
    </AppShell>
  );
}
