import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, ApiRequestError, type OwnPartnerRequest, type Partner as PartnerRecord, type SettledRun } from '../lib/api';
import { useSession } from '../state/session';

// Partner — the B2B partner's own self-service dashboard (v1-minimal).
//
// A "partner" is deliberately simple: an ordinary account (Anima) a platform admin has
// approved through the intake/approval flow on a sibling branch — no on-chain agent, NFT, or
// treasury lookup. GET /v1/me/partner is the access gate: 404 (no/revoked record) renders a
// not-a-partner state rather than erroring the page; any other failure renders a generic error
// state.
//
// A 404 THERE IS NOT ONE FACT, which is why this screen makes a second call. "No partner
// record" is equally true of someone who never applied, someone whose application is still in
// the review queue, and someone who was declined — and telling all three "you don't have
// partner access" is how an applicant ends up refreshing this page forever, waiting on an
// answer that was already given. So on 404 we ask GET /v1/me/partner-request, which returns the
// caller's own application, and say which of the three it is (or, when an approved application
// has no live Partner record, that access was ended). If THAT call fails for any reason other
// than its own 404, we fall back to the flat message rather than erroring a page whose real
// answer — you are not a partner — we already have.
//
// Balance + spend reuse the SAME two calls (and the same rendering shape) Status.tsx already
// uses for this — GET /v1/me/status + GET /v1/me/runs — there is no separate shared "balance
// card" component to import; Status.tsx's inline pattern IS the precedent, mirrored here rather
// than re-invented.
//
// The API key is issued/rotated HERE, self-serve, by the partner themselves — never by whoever
// approved their application (see partnerAdminRouter.ts: approval provisions the Partner record
// only, no key). POST /v1/me/partner/api-key retires any key this flow previously issued and
// mints a fresh one; the response is the ONLY time the raw key is ever retrievable, so it lives
// only in this component's state — never localStorage, never re-fetched on reload.
//
// Feedback/support: ReportModal (POST /v1/reports) is already mounted globally inside AppShell
// (bottom-right flag button on every screen) — that already satisfies "a way to message us" for
// this screen without a second, duplicate form.

const IMPETUS_USD = 0.000337;

type Gate =
  | 'loading'
  | 'signed-out'
  /** Not a partner, and the follow-up call could not say why — the fallback, not the normal path. */
  | 'no-access'
  /** Not a partner, and no application on file under this account. */
  | 'not-applied'
  /** Applied, still in the review queue. */
  | 'pending'
  /** Applied and declined. */
  | 'declined'
  /** Approved, but no live Partner record — access was revoked. */
  | 'revoked'
  | 'error'
  | 'ok';

export function Partner() {
  const { session, ready } = useSession();
  const [gate, setGate] = useState<Gate>('loading');
  const [partner, setPartner] = useState<PartnerRecord | null>(null);
  const [gateErr, setGateErr] = useState<string | null>(null);
  const [application, setApplication] = useState<OwnPartnerRequest | null>(null);

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
        if (err instanceof ApiRequestError && err.code === 'not_found.partner') {
          // Not a partner — now find out which kind. Any failure here degrades to the flat
          // no-access state: the page's own question is already answered.
          api.mePartnerRequest()
            .then((r) => {
              if (!live) return;
              setApplication(r);
              setGate(r.status === 'pending' ? 'pending' : r.status === 'declined' ? 'declined' : 'revoked');
            })
            .catch((e) => {
              if (!live) return;
              setGate(e instanceof ApiRequestError && e.code === 'not_found.partner_request' ? 'not-applied' : 'no-access');
            });
          return;
        }
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

  async function issueOrRotateKey() {
    setKeyBusy(true);
    setKeyErr(null);
    setCopied(false);
    try {
      const res = await api.rotatePartnerApiKey();
      setApiKey(res.apiKey);
    } catch (e) {
      setKeyErr(e instanceof Error ? e.message : String(e));
    } finally {
      setKeyBusy(false);
    }
  }

  async function copyKey() {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
    } catch { /* clipboard unavailable — the key is still selectable text */ }
  }

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

        {gate === 'not-applied' && (
          <div className="empty">
            <div className="ico"><Ic name="users" /></div>
            <div className="t">You haven't applied yet</div>
            <div className="s">
              This page becomes your dashboard once a B2B partner application from this account is
              approved. There's no application on file under this account.
            </div>
            <Link className="btn" to="/partners"><Ic name="users" /> Apply to become a partner</Link>
          </div>
        )}

        {gate === 'pending' && (
          <div className="empty">
            <div className="ico"><Ic name="users" /></div>
            <div className="t">Your application is with a reviewer</div>
            <div className="s">
              Filed {fmtDate(application?.natum)}{application?.org ? ` for ${application.org}` : ''}. We
              review by hand, so this can take a few days. Nothing else is needed from you — once it's
              approved this page becomes your dashboard, and you issue your API key here.
            </div>
          </div>
        )}

        {gate === 'declined' && (
          <div className="empty">
            <div className="ico"><Ic name="users" /></div>
            <div className="t">Your application wasn't approved</div>
            <div className="s">
              We reviewed the application you filed {fmtDate(application?.natum)} and declined it
              {application?.decidedAt ? ` on ${fmtDate(application.decidedAt)}` : ''}. If your plans have
              changed since, you're welcome to apply again; if you think we got it wrong, use the report
              button below to reach us.
            </div>
            <Link className="btn" to="/partners"><Ic name="users" /> Apply again</Link>
          </div>
        )}

        {gate === 'revoked' && (
          <div className="empty">
            <div className="ico"><Ic name="users" /></div>
            <div className="t">Your partner access has ended</div>
            <div className="s">
              This account's application was approved, but its partner access is no longer active, and
              any API key it issued has stopped working. Use the report button below to reach us.
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
                  <Ic name="key-round" /> Generate or rotate your own key here, any time. Rotating
                  immediately retires the previous one — update anywhere it's in use before you rotate again.
                </div>

                <button className="btn" onClick={issueOrRotateKey} disabled={keyBusy}>
                  {keyBusy ? 'Working…' : apiKey ? 'Rotate API key' : 'Generate API key'}
                </button>

                {keyErr && <div className="warn">Couldn't issue a key — {keyErr}</div>}

                {apiKey && (
                  <div className="warn" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div><b>Copy this now — it will never be shown again.</b></div>
                    <code className="mono" style={{ userSelect: 'all', wordBreak: 'break-all' }}>{apiKey}</code>
                    <button className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={copyKey}>
                      {copied ? 'Copied' : 'Copy key'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head"><span className="byo-prov">Quick start</span></div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
                <div className="sub">
                  Authenticate with <code className="mono">x-api-key</code>. Once you've generated a key above:
                </div>
                <pre className="mono" style={{ background: 'var(--surface-2, #131619)', padding: 'var(--s3)', borderRadius: 'var(--radius)', overflowX: 'auto', margin: 0, fontSize: 'var(--fs-xs)' }}>
{`curl https://noema.art/v1/me/status \\
  -H "x-api-key: ${apiKey ?? 'YOUR_API_KEY'}"`}
                </pre>
                <div className="sub" style={{ fontSize: 'var(--fs-xs)' }}>
                  Full API reference (always current — generated straight from the live contract):{' '}
                  <a href="/v1/openapi.json" target="_blank" rel="noreferrer">/v1/openapi.json</a>
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
