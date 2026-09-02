import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, ApiRequestError, type Partner as PartnerRecord, type SettledRun } from '../lib/api';
import { useSession } from '../state/session';

// Partner — the B2B partner's own self-service dashboard (v1-minimal).
//
// A "partner" is deliberately simple: an ordinary account (Anima) a platform admin has
// approved through the intake/approval flow on a sibling branch — no on-chain agent, NFT, or
// treasury lookup. GET /v1/me/partner is the access gate: 404 (no/revoked record) renders a
// plain "you don't have partner access" state rather than erroring the page; any other failure
// renders a generic error state.
//
// Balance + spend reuse the SAME two calls (and the same rendering shape) Status.tsx already
// uses for this — GET /v1/me/status + GET /v1/me/runs — there is no separate shared "balance
// card" component to import; Status.tsx's inline pattern IS the precedent, mirrored here rather
// than re-invented.
//
// The API key is NEVER re-fetched or re-displayed: it was shown exactly once, at approval time,
// by the ADMIN-facing route (see partnerAdminRouter.ts on the intake branch) — this screen only
// notes that fact. No lost-key-recovery flow exists; that is a deliberate, out-of-scope gap.
//
// Feedback/support: ReportModal (POST /v1/reports) is already mounted globally inside AppShell
// (bottom-right flag button on every screen) — that already satisfies "a way to message us" for
// this screen without a second, duplicate form.

const IMPETUS_USD = 0.000337;

type Gate = 'loading' | 'signed-out' | 'no-access' | 'error' | 'ok';

export function Partner() {
  const { session, ready } = useSession();
  const [gate, setGate] = useState<Gate>('loading');
  const [partner, setPartner] = useState<PartnerRecord | null>(null);
  const [gateErr, setGateErr] = useState<string | null>(null);

  const [balance, setBalance] = useState<{ impetus: string; usd: number } | null>(null);
  const [spend, setSpend] = useState<SettledRun[]>([]);
  const [spendTotal, setSpendTotal] = useState<{ impetus: string; usd: number } | null>(null);
  const [spendCursor, setSpendCursor] = useState<string | undefined>(undefined);
  const [spendLoaded, setSpendLoaded] = useState(false);
  const [spendLoading, setSpendLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!session) { setGate('signed-out'); return; }
    let live = true;
    api.mePartner()
      .then((p) => { if (live) { setPartner(p); setGate('ok'); } })
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiRequestError && err.code === 'not_found.partner') { setGate('no-access'); return; }
        setGateErr(err instanceof Error ? err.message : String(err));
        setGate('error');
      });
    return () => { live = false; };
  }, [ready, session]);

  useEffect(() => {
    if (gate !== 'ok') return;
    let live = true;
    api.meStatus()
      .then((s) => { if (live) setBalance({ impetus: s.balanceImpetus, usd: s.balanceUsd || Number(s.balanceImpetus) * IMPETUS_USD }); })
      .catch(() => { /* leave the balance card in its loading state */ });
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
  }, [gate]);

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

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  return (
    <AppShell crumb="Partner">
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div><h1>Partner dashboard</h1><div className="sub">Your organization, balance, spend history, and API key status.</div></div>
        </div>

        {gate === 'loading' && <div className="sub">Loading…</div>}

        {gate === 'signed-out' && (
          <div className="empty">
            <div className="ico"><Ic name="circle-user" /></div>
            <div className="t">Sign in to continue</div>
            <div className="s">The partner dashboard is only available to a signed-in account.</div>
            <Link className="btn" to="/onboard"><Ic name="circle-user" /> Sign in</Link>
          </div>
        )}

        {gate === 'error' && (
          <div className="warn">Couldn't load your partner record{gateErr ? ` — ${gateErr}` : ''}. Try refreshing.</div>
        )}

        {gate === 'no-access' && (
          <div className="empty">
            <div className="ico"><Ic name="users" /></div>
            <div className="t">You don't have partner access</div>
            <div className="s">
              This account isn't an approved B2B partner. If you believe this is a mistake, use the
              report button below to reach us.
            </div>
          </div>
        )}

        {gate === 'ok' && partner && (
          <>
            <div className="byo-row">
              <div className="byo-head">
                <span className="byo-prov">Organization</span>
                <span className={`byo-state${partner.status === 'active' ? ' connected' : ''}`}>{partner.status}</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
                <div className="meta-line"><span>Org</span><span className="v">{partner.org ?? '—'}</span></div>
                <div className="meta-line"><span>Contact</span><span className="v">{partner.contactEmail ?? '—'}</span></div>
                <div className="meta-line"><span>Partner since</span><span className="v">{fmtDate(partner.natum)}</span></div>
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head"><span className="byo-prov">API key</span></div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
                <div className="sub">
                  <Ic name="key-round" /> Your API key was shown once, when your partnership was
                  approved. We can't display it again here — if you've lost it, use the report
                  button below to reach us.
                </div>
              </div>
            </div>

            <div className="stats">
              <div className="stat">
                <div className="l">Balance</div>
                <div className="n">{balance ? Number(balance.impetus).toLocaleString() : '…'}</div>
                <div className="d">credits{balance ? ` · ≈ $${balance.usd.toFixed(2)}` : ''}</div>
              </div>
            </div>

            <div className="sectionhead">
              Spend
              {spendTotal && spend.length > 0 && (
                <span className="sub" style={{ marginLeft: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
                  {Number(spendTotal.impetus).toLocaleString()} credits all time · ≈ ${spendTotal.usd.toFixed(2)}
                </span>
              )}
            </div>
            {!spendLoaded ? (
              <div className="empty"><div className="t">Loading spend history…</div></div>
            ) : spend.length === 0 ? (
              <div className="empty">
                <div className="ico"><Ic name="receipt-text" /></div>
                <div className="t">No settled runs yet — once a run finishes, what it cost shows here.</div>
              </div>
            ) : (
              <>
                <div className="list">
                  {spend.map((r) => (
                    <div className="lrow" key={r.id}>
                      <div className="li-main">
                        <div className="t">{r.modusLabel}</div>
                        <div className="s">{fmtDate(r.settledAt)}</div>
                      </div>
                      <div className="li-right">{Number(r.cost).toLocaleString()} cr · ${r.costUsd.toFixed(2)}</div>
                    </div>
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
              Questions or feedback? Use the report button in the corner of this page to reach us.
            </div>
          </>
        )}
      </div></div>
    </AppShell>
  );
}
