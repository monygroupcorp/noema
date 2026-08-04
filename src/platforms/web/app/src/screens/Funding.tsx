import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type DepositConfig, type Pack } from '../lib/api';
import { connectWallet } from '../lib/wallet';
import { useSession } from '../state/session';
import { Hemisphere, Meter } from './IdentityMeter';
import { BuyCreditsModal } from './BuyCreditsModal';

// The credit packs render from ONE server source (GET /v1/payments/packs, `api.listPacks()`),
// sourced from the backend's single `stripePacks` catalog — no hardcoded numbers here. The shared
// USD/credit anchor across the page: the fiat/card rail's Stripe checkout is priced EXACTLY off that
// server table (server-authoritative — /v1/payments/checkout credits the backend impetus constant,
// never a client computation); the anon-rail chips reuse the same denominations as an informational
// preview. Change a pack number in stripePacks.ts and every surface here updates automatically.

// Identified-account gate for the fiat rail: a card purchase requires a signed-in anima
// (client_reference_id = animaId) — an anon/purse-only caller is 401'd server-side, so we
// prompt sign-in instead of ever starting checkout for one.
export function canCheckout(session: unknown): boolean {
  return session != null;
}

// The checkout request shape sent to POST /v1/payments/checkout. successUrl/cancelUrl
// point back at this page with a `checkout` query flag so we know to poll on return
// (Stripe's webhook credits async — the redirect itself carries no proof of payment).
export function buildCheckoutRequest(packId: string, origin: string): { packId: string; successUrl: string; cancelUrl: string } {
  return {
    packId,
    successUrl: `${origin}/funding?checkout=success`,
    cancelUrl: `${origin}/funding?checkout=cancel`,
  };
}

// Native ETH sentinel for the deposit pricer (0x000…000 = the chain's native coin).
const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
const fmt = (n: number) => n.toLocaleString('en-US');
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

// Inline alert glyph (kept local so we don't touch the shared icon registry).
function WarnIc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function Funding() {
  const { session } = useSession();
  // Preselect the pack from the pricing-page CTA (?pack=<id>), else the default mid-tier.
  const [searchParams] = useSearchParams();
  const preselected = searchParams.get('pack');
  const [pack, setPack] = useState(preselected ?? 'plus_50');
  // The credit-pack catalog, loaded from the single server source (no hardcoded numbers).
  const [packs, setPacks] = useState<Pack[]>([]);
  const [cfg, setCfg] = useState<DepositConfig | null>(null);
  // Live ETH → points quote for the onchain rail.
  const [eth, setEth] = useState('');
  const [quote, setQuote] = useState<{ points?: string; usd?: string; err?: string; busy?: boolean }>({});
  // Onchain rail: the connected wallet address (we see an address, not a person). Build+send
  // (BuyCreditsModal) is the primary path — it builds the CreditVault deposit tx and sends it
  // via the user's own wallet in one signature, no custody change. Copy-the-address stays as
  // a fallback for wallets/flows the modal can't prompt.
  const [wallet, setWallet] = useState<string | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);

  // Fiat/card rail — Stripe Checkout redirect + post-return credit poll.
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'polling' | 'settled' | 'timeout'>('idle');

  async function connect() {
    setWalletErr(null);
    try { const w = await connectWallet(); setWallet(w.address); }
    catch (e) { setWalletErr(e instanceof Error ? e.message : String(e)); }
  }
  async function copyDepositAddr() {
    if (!cfg) return;
    try { await navigator.clipboard.writeText(cfg.depositAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard blocked — the address is still shown in full via the title tooltip */ }
  }

  // Card pack purchase. Anon/purse callers never reach the API call — canCheckout() gates
  // it client-side (the inline sign-in prompt below covers that case); the server would
  // 401 payments.identity_required anyway, this just avoids a doomed round-trip.
  function buyPack(packId: string) {
    setCheckoutErr(null);
    if (!canCheckout(session)) return;
    setCheckoutBusy(packId);
    api.createCheckoutSession(buildCheckoutRequest(packId, window.location.origin))
      .then((s) => { window.location.href = s.url; })
      .catch((e) => { setCheckoutErr(e instanceof Error ? e.message : String(e)); setCheckoutBusy(null); });
  }

  useEffect(() => {
    let live = true;
    api.getDepositConfig().then((c) => { if (live) setCfg(c); }).catch(() => {});
    api.listPacks().then((p) => {
      if (!live) return;
      setPacks(p);
      // If the CTA's ?pack= wasn't a real SKU, fall back to a valid selection.
      setPack((cur) => (p.some((x) => x.id === cur) ? cur : (p[0]?.id ?? cur)));
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  // On return from Stripe (success_url carries ?checkout=success), poll /v1/me/status
  // until the balance moves — the webhook credits asynchronously, so the redirect itself
  // is not proof of a landed credit. Strip the flag so a refresh doesn't re-poll.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;
    window.history.replaceState({}, '', window.location.pathname);
    let live = true;
    setCheckoutStatus('polling');
    const start = Date.now();
    const timeoutMs = 5 * 60_000;
    let baseline: number | null = null;
    const poll = () => {
      api.meStatus().then((s) => {
        if (!live) return;
        const bal = Number(s.balanceImpetus);
        if (baseline == null) { baseline = bal; }
        else if (bal > baseline) { setCheckoutStatus('settled'); return; }
        if (Date.now() - start < timeoutMs) setTimeout(poll, 3000);
        else setCheckoutStatus('timeout');
      }).catch(() => {
        if (live && Date.now() - start < timeoutMs) setTimeout(poll, 3000);
      });
    };
    poll();
    return () => { live = false; };
  }, []);

  // Debounced live deposit quote as the user types an ETH amount.
  useEffect(() => {
    const v = parseFloat(eth);
    if (!eth || Number.isNaN(v) || v <= 0) { setQuote({}); return; }
    const t = setTimeout(() => {
      let wei: string;
      try { wei = (BigInt(Math.round(v * 1e6)) * 10n ** 12n).toString(); } catch { setQuote({ err: 'bad amount' }); return; }
      setQuote({ busy: true });
      api.depositQuote({ chainId: 1, token: NATIVE_ETH, amount: wei })
        .then((d) => setQuote({ points: d.pointsQuoted, usd: d.grossUsd }))
        .catch((e) => setQuote({ err: e instanceof Error ? e.message : String(e) }));
    }, 400);
    return () => clearTimeout(t);
  }, [eth]);

  return (
    <AppShell crumb="Funding">
      <div className="page"><div className="pw narrow fund">

        <div className="fund-head">
          <h1>Every way to pay — and what each one reveals.</h1>
          <div className="sub">
            We tell you exactly what we learn about you on each path. Privacy on the
            funding side is real, but it's <b>yours to keep</b> — so here's how.
          </div>
        </div>

        <div className="fund-rows">

          {/* Row 1 · Anonymous rail — the differentiator and its caveat, expanded. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic slate"><Ic name="venetian-mask" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Anonymous rail</h3>
                  <span className="fund-flag">◌ ours alone</span>
                </div>
                <p className="fund-desc">
                  Mint a bearer purse and spend it down. The purse itself carries no
                  name, no account, no recovery — and it can't be linked to your runs.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="nothing" label="nothing*" />
              </div>
            </div>

            <div className="fund-guide">
              <div className="fund-guide-h">
                <Hemisphere sees="nothing" />
                * keeping it anonymous is on you — fund it right
              </div>
              <ol className="fund-guide-pts">
                <li>
                  <span className="fg-n">01</span>
                  <span>
                    Fund the purse from a <b>shielded or fresh wallet</b> — not a KYC
                    exchange withdrawal and not your main wallet.
                  </span>
                </li>
                <li>
                  <span className="fg-n">02</span>
                  <span>
                    The purse is a <b>bearer token</b>: once minted it's unlinkable to
                    your generations, and we can't recover or freeze it.
                  </span>
                </li>
              </ol>
            </div>

            <div className="warn fund-warn">
              <WarnIc />
              <span>
                Pay from a <b>doxxed wallet</b> and that payment ties your identity to us{' '}
                <b>at the moment you mint</b> — permanently, even if you never spend a
                single credit. Anonymity starts upstream of us.
              </span>
            </div>

            <div className="fund-actions">
              <div className="filters">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    className={`fchip${pack === p.id ? ' on' : ''}`}
                    onClick={() => setPack(p.id)}
                  >
                    <span className="fc-cr">{fmt(p.credits)}</span>
                    <span className="fc-pr">${p.usd}</span>
                  </button>
                ))}
              </div>
              <Link className="btn-ghost" to="/vault">
                <Ic name="venetian-mask" /> Mint a purse <Ic name="arrow-right" />
              </Link>
            </div>
          </section>

          {/* Row 2 · Onchain wallet — a pseudonym, not a person. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic accent"><Ic name="wallet" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Onchain wallet</h3>
                </div>
                <p className="fund-desc">
                  Connect a wallet. We see an address, not a person. Subscription or
                  pay-as-you-go.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="pseudonym" label="a pseudonym" />
                <button className="btn-ghost" onClick={connect}>
                  {wallet ? <>Connected: {shortAddr(wallet)}</> : <>Connect <Ic name="arrow-right" /></>}
                </button>
                {walletErr && <div className="warn byo-warn" style={{ marginTop: 'var(--s2)' }}>{walletErr}</div>}
              </div>
            </div>

            {/* Primary path — build+send the CreditVault deposit tx from the connected wallet
                (one signature, no custody change). See BuyCreditsModal for the full ledger flow. */}
            <div className="fund-guide">
              <div className="fund-guide-h">
                <Ic name="wallet" /> Buy credits — build and send the deposit yourself, one signature
              </div>
              <div style={{ marginTop: 'var(--s3)' }}>
                <button className="btn" onClick={() => setBuyOpen(true)}>
                  <Ic name="wallet" /> Buy with wallet <Ic name="arrow-right" />
                </button>
              </div>

              {/* Fallback — hand-copy the deposit address for wallets the modal can't prompt. */}
              <details className="fund-fallback" style={{ marginTop: 'var(--s4)' }}>
                <summary className="fund-guide-h">prefer to send manually?</summary>
                <div className="meta-line" style={{ marginTop: 'var(--s3)' }}>
                  <span>deposit address</span>
                  <span className="v mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    <span title={cfg?.depositAddress}>{cfg ? shortAddr(cfg.depositAddress) : '…'}</span>
                    {cfg && <button className="btn-ghost sm" onClick={copyDepositAddr}>{copied ? 'copied ✓' : 'copy'}</button>}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
                  <input
                    className="inp mono"
                    style={{ maxWidth: 120 }}
                    placeholder="0.01"
                    inputMode="decimal"
                    value={eth}
                    onChange={(e) => setEth(e.target.value)}
                  />
                  <span className="mono">ETH →</span>
                  <span className="mono">
                    {quote.busy ? '…'
                      : quote.err ? 'quote failed'
                      : quote.points ? `${fmt(Number(quote.points))} credits`
                      : '—'}
                  </span>
                </div>
                {quote.usd && (
                  <div className="fund-guide-h" style={{ marginTop: 'var(--s2)' }}>
                    ≈ ${quote.usd} · {cfg?.defaultFundingRatePct}% funding rate · informational, the deposit re-prices at confirmation
                  </div>
                )}
              </details>
            </div>
          </section>

          <BuyCreditsModal open={buyOpen} onClose={() => setBuyOpen(false)} />

          {/* Row 3 · Card — the fastest path; it sees you. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic gold"><Ic name="credit-card" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Card</h3>
                </div>
                <p className="fund-desc">
                  Pay by card via Stripe. The fastest path. We see your name and card.
                  Fixed packs — the price and the credit are locked in.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="you" label="you" />
              </div>
            </div>

            <div className="fund-guide">
              <div className="fund-guide-h">
                <Ic name="credit-card" /> Buy a pack — redirects to Stripe Checkout
              </div>
              <div className="fund-actions" style={{ marginTop: 'var(--s3)' }}>
                <div className="filters">
                  {packs.map((p) => (
                    <button
                      key={p.id}
                      className="fchip"
                      disabled={checkoutBusy != null}
                      onClick={() => buyPack(p.id)}
                    >
                      <span className="fc-cr">{fmt(p.credits)}</span>
                      <span className="fc-pr">${p.usd}</span>
                    </button>
                  ))}
                </div>
              </div>

              {!session && (
                <div className="warn fund-warn" style={{ marginTop: 'var(--s3)' }}>
                  <WarnIc />
                  <span>
                    A card purchase requires an identified account — <Link to="/onboard">sign in</Link> first
                    (fiat can't fund an anonymous purse).
                  </span>
                </div>
              )}
              {checkoutErr && <div className="warn" style={{ marginTop: 'var(--s3)' }}>{checkoutErr}</div>}
              {checkoutStatus === 'polling' && (
                <div className="fund-guide-h" style={{ marginTop: 'var(--s3)' }}>
                  Payment received — waiting for the credit to land…
                </div>
              )}
              {checkoutStatus === 'settled' && (
                <div className="fund-guide-h" style={{ marginTop: 'var(--s3)' }}>
                  Credited — your balance is updated.
                </div>
              )}
            </div>
          </section>

        </div>

        <div className="warn" style={{ marginTop: 'var(--s7)' }}>
          Credits are a prepaid balance for compute on noema — not money.
          Non-transferable, non-withdrawable, redeemable only for runs here.
        </div>

      </div></div>
    </AppShell>
  );
}
