import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { AccountGate } from '../shell/AccountGate';
import { Ic } from '../lib/icons';
import {
  api,
  ApiRequestError,
  type OwnPartnerRequest,
  type Partner as PartnerRecord,
  type PartnerContractState,
  type PartnerInvoice,
  type PartnerUsageView,
  type SettledRun,
} from '../lib/api';
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
// A KEY IS NOT ISSUED ON ASKING. Two things have to be true first: the API Customer Agreement is
// signed at its CURRENT version, and a billing account is on file. The server refuses either way
// round (partner.contract_unsigned / partner.billing_required), so this screen does not enforce
// anything — it makes the two steps doable, in order, and says which one is outstanding rather
// than offering a button that 422s. The agreement is read on its own published page and signed
// here; signing sends the version back, so a signature is always an acceptance of the text that
// was on offer.
//
// Billing is POST-PAID, and that is the other half of what "partner" now means: the meter counts
// every call a key makes, an invoice is drawn from it at the end of a period, and paying one is
// not buying credits. So the dashboard shows the meter (this period, live) and the invoices, and
// neither is expressed in the credit balance above them.
//
// Feedback/support: ReportModal (POST /v1/reports) is already mounted on every screen (the flag
// in the concierge panel's head) — that already satisfies "a way to message us" for this screen
// without a second, duplicate form.

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

  const [contract, setContract] = useState<PartnerContractState | null>(null);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signBusy, setSignBusy] = useState(false);
  const [signErr, setSignErr] = useState<string | null>(null);

  const [billedTo, setBilledTo] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [netDays, setNetDays] = useState('30');
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErr, setBillingErr] = useState<string | null>(null);

  const [usage, setUsage] = useState<PartnerUsageView | null>(null);
  const [invoices, setInvoices] = useState<PartnerInvoice[]>([]);
  const [payBusy, setPayBusy] = useState<string | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);

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

  // The billing form opens on whatever is already on file, so "replace" is an edit rather than a
  // retype. Keyed off the record the gate fetched, not off the form's own state.
  useEffect(() => {
    if (!partner?.billing) return;
    setBilledTo(partner.billing.billedTo);
    setBillingEmail(partner.billing.billingEmail);
    setNetDays(String(partner.billing.netDays));
  }, [partner]);

  useEffect(() => {
    if (gate !== 'ok') return;
    let live = true;
    api.mePartnerContract()
      .then((c) => { if (live) setContract(c); })
      .catch(() => { /* the agreement card falls back to its own loading copy */ });
    loadBilling(live);
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

  /** This calendar month, half-open — the window the live meter reads. The period an invoice
   *  covers is the platform's to choose; this is just "what has this key run up so far". */
  function thisMonth(): { from: string; to: string } {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { from: from.toISOString(), to: to.toISOString() };
  }

  /** Meter + invoices. Called on open and again after anything that can change them. */
  function loadBilling(live = true) {
    const { from, to } = thisMonth();
    api.partnerUsage(from, to)
      .then((u) => { if (live) setUsage(u); })
      .catch(() => { /* the meter card falls back to its empty state */ });
    api.partnerInvoices()
      .then((r) => { if (live) setInvoices(r.invoices); })
      .catch(() => { /* likewise */ });
  }

  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  /** Micro-USD (a string, because a bigint does not survive JSON) → a dollar amount to show. */
  const fmtUsdMicro = (micro: string) => `$${(Number(micro) / 1_000_000).toFixed(2)}`;

  async function signContract() {
    if (!contract) return;
    setSignBusy(true);
    setSignErr(null);
    try {
      // The version goes back exactly as it was displayed. If the agreement was revised between
      // this page loading and this click, the server refuses rather than binding the signer to
      // text they did not see — and re-reading gets them the current one.
      await api.signPartnerContract({
        version: contract.version,
        signerName: signerName.trim(),
        ...(signerTitle.trim() ? { signerTitle: signerTitle.trim() } : {}),
      });
      setContract(await api.mePartnerContract());
    } catch (e) {
      setSignErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSignBusy(false);
    }
  }

  async function saveBilling() {
    setBillingBusy(true);
    setBillingErr(null);
    try {
      const res = await api.setPartnerBilling({ billedTo: billedTo.trim(), billingEmail: billingEmail.trim(), netDays: Number(netDays) });
      setPartner((p) => (p ? { ...p, billing: res.billing } : p));
    } catch (e) {
      setBillingErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBillingBusy(false);
    }
  }

  async function payInvoice(id: string) {
    setPayBusy(id);
    setPayErr(null);
    try {
      const { url } = await api.payPartnerInvoice(id);
      window.location.href = url;
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : String(e));
      setPayBusy(null);
    }
  }

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
          <div><h1>Partner</h1><div className="sub">Your organization, balance, spend history, and API key status.</div></div>
        </div>

        {gate === 'loading' && <div className="sub">Loading…</div>}

        {gate === 'signed-out' && (
          <AccountGate why="The partner dashboard reads one organization's balance, spend and API keys, so it needs the account that owns them." />
        )}

        {gate === 'error' && (
          <div className="warn">Couldn't load your partner record{gateErr ? ` — ${gateErr}` : ''}. Try refreshing.</div>
        )}

        {gate === 'no-access' && (
          <div className="empty">
            <div className="ico"><Ic name="users" /></div>
            <div className="t">You don't have partner access</div>
            <div className="s">
              This account isn't an approved B2B partner. If you believe this is a mistake, open the
              concierge and choose "Report an issue" to reach us.
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
              changed since, you're welcome to apply again; if you think we got it wrong, open the
              concierge and choose "Report an issue" to reach us.
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
              any API key it issued has stopped working. Open the concierge and choose "Report an issue" to reach us.
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
              <div className="byo-head">
                <span className="byo-prov">API Customer Agreement</span>
                <span className={`byo-state${contract?.signed ? ' connected' : ''}`}>{contract ? (contract.signed ? 'signed' : 'unsigned') : '…'}</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
                <div className="sub">
                  Commercial API access runs on a written agreement: you warrant the rights in
                  everything you send us and indemnify us for it, we may cut a key at any time, and
                  neither side trades on a named living artist's style. Read it in full before you
                  sign — signing here is the signature, and no key is issued without it.
                </div>
                {contract && (
                  <div className="meta-line">
                    <span>Version</span>
                    <span className="v">
                      <a href={contract.path} target="_blank" rel="noreferrer">{contract.version}</a>
                    </span>
                  </div>
                )}
                {contract?.signed ? (
                  <>
                    <div className="meta-line"><span>Signed</span><span className="v">{fmtDate(contract.signedAt)}</span></div>
                    <div className="meta-line"><span>Signed by</span><span className="v">{contract.signerName ?? '—'}</span></div>
                  </>
                ) : (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="sub">Your full name</span>
                      <input className="byo-input" type="text" value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Dana Reyes" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="sub">Your role (optional)</span>
                      <input className="byo-input" type="text" value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="COO" />
                    </label>
                    <button className="btn" onClick={signContract} disabled={signBusy || !contract || signerName.trim().length === 0}>
                      {signBusy ? 'Signing…' : 'I have read and agree to the API Customer Agreement'}
                    </button>
                  </>
                )}
                {signErr && <div className="warn">Couldn't record your signature — {signErr}</div>}
                {contract && !contract.signed && contract.signedVersions.length > 0 && (
                  <div className="sub" style={{ fontSize: 'var(--fs-xs)' }}>
                    You signed an earlier version ({contract.signedVersions.join(', ')}). The agreement has
                    been revised since; keys issued under the old version have stopped working, and signing
                    the current one and rotating your key restores access.
                  </div>
                )}
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head">
                <span className="byo-prov">Billing account</span>
                <span className={`byo-state${partner.billing ? ' connected' : ''}`}>{partner.billing ? 'on file' : 'needed'}</span>
              </div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
                <div className="sub">
                  API usage is post-paid: we meter every call your keys make and invoice you at the end
                  of each period. This is where the invoice goes. Changing it never rewrites an invoice
                  already issued.
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="sub">Bill to</span>
                  <input className="byo-input" type="text" value={billedTo} onChange={(e) => setBilledTo(e.target.value)} placeholder="Acme Studio Ltd" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="sub">Invoices to</span>
                  <input className="byo-input" type="email" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="ap@acme.example" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="sub">Payment terms (days)</span>
                  <input className="byo-input" type="text" inputMode="numeric" value={netDays} onChange={(e) => setNetDays(e.target.value)} placeholder="30" />
                </label>
                <button className="btn" onClick={saveBilling} disabled={billingBusy}>
                  {billingBusy ? 'Saving…' : partner.billing ? 'Update billing account' : 'Save billing account'}
                </button>
                {billingErr && <div className="warn">Couldn't save the billing account — {billingErr}</div>}
              </div>
            </div>

            <div className="byo-row">
              <div className="byo-head"><span className="byo-prov">API key</span></div>
              <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
                <div className="sub">
                  <Ic name="key-round" /> Generate or rotate your own key here, any time. Rotating
                  immediately retires the previous one — update anywhere it's in use before you rotate again.
                </div>

                {(!contract?.signed || !partner.billing) && (
                  <div className="sub" style={{ fontSize: 'var(--fs-xs)' }}>
                    Two things first:{' '}
                    {!contract?.signed && <>sign the API Customer Agreement above</>}
                    {!contract?.signed && !partner.billing && <>, and </>}
                    {!partner.billing && <>put a billing account on file</>}.
                  </div>
                )}

                <button className="btn" onClick={issueOrRotateKey} disabled={keyBusy || !contract?.signed || !partner.billing}>
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

            <div className="sectionhead">
              API usage this month
              {usage && (
                <span className="sub" style={{ marginLeft: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
                  {usage.rollup.calls.toLocaleString()} billable {usage.rollup.calls === 1 ? 'call' : 'calls'} ·{' '}
                  {Number(usage.rollup.impetus).toLocaleString()} units
                </span>
              )}
            </div>
            {!usage ? (
              <div className="empty"><div className="t">Loading your meter…</div></div>
            ) : usage.calls.length === 0 ? (
              <div className="empty">
                <div className="ico"><Ic name="receipt-text" /></div>
                <div className="t">No API calls yet this month.</div>
                <div className="s">Every call one of your keys makes is counted here, with the model it ran and what it consumed. This is what your invoice is drawn from.</div>
              </div>
            ) : (
              <div className="list">
                {usage.rollup.lines.map((l) => (
                  <div className="lrow" key={l.modusId}>
                    <div className="li-main">
                      <div className="t">{l.modusLabel}</div>
                      <div className="s">{l.calls.toLocaleString()} {l.calls === 1 ? 'call' : 'calls'}</div>
                    </div>
                    <div className="li-right">{Number(l.impetus).toLocaleString()} units</div>
                  </div>
                ))}
                {usage.calls.some((c) => c.voidedAt) && (
                  <div className="sub" style={{ marginTop: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>
                    {usage.calls.filter((c) => c.voidedAt).length} call(s) this month failed and were not billed. They stay
                    on the meter so the record of what your keys did is complete.
                  </div>
                )}
              </div>
            )}

            <div className="sectionhead">Invoices</div>
            {invoices.length === 0 ? (
              <div className="empty">
                <div className="ico"><Ic name="receipt-text" /></div>
                <div className="t">No invoices yet</div>
                <div className="s">We invoice at the end of each period, itemized by flow, from the meter above.</div>
              </div>
            ) : (
              <div className="list">
                {invoices.map((inv) => (
                  <div className="lrow" key={inv.id}>
                    <div className="li-main">
                      <div className="t">{fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</div>
                      <div className="s">
                        {inv.status === 'paid'
                          ? `Paid ${fmtDate(inv.paidAt)}`
                          : inv.status === 'void'
                            ? 'Withdrawn'
                            : `Due ${fmtDate(inv.dueAt)}`} · {inv.usage.calls.toLocaleString()} calls
                      </div>
                    </div>
                    <div className="li-right" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                      <span>{fmtUsdMicro(inv.usdMicro)}</span>
                      {inv.status === 'open' && Number(inv.usdMicro) > 0 && (
                        <button className="btn-ghost" onClick={() => payInvoice(inv.id)} disabled={payBusy !== null}>
                          {payBusy === inv.id ? 'Opening…' : 'Pay'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {payErr && <div className="warn">Couldn't open checkout — {payErr}</div>}
            <div className="sub" style={{ marginTop: 'var(--s2)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
              Paying an invoice settles what you owe for compute already delivered. It is not a credit
              purchase and adds nothing to the balance below.
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
              Questions or feedback? Open the concierge and choose "Report an issue" to reach us.
            </div>
          </>
        )}
      </div></div>
    </AppShell>
  );
}
