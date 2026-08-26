import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, ApiRequestError, type DepositConfig, type Pack } from '../lib/api';
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

// A redeem refusal, said plainly. The server answers `{ error: { code, message } }`; each code
// below is a state the holder of a code can actually be in, so each gets its own sentence rather
// than one generic failure.
export function redeemMessage(err: unknown): string {
  const code = err instanceof ApiRequestError ? err.code : '';
  if (code === 'purse.redeemed') return 'That code has already been redeemed.';
  if (code === 'purse.owner_reclaims') return 'That purse is yours — reclaim it from your Vault instead.';
  if (code === 'purse.not_redeemable') return "That code can't be redeemed.";
  if (code === 'purse.not_found') return "We don't recognise that code — check it for a typo.";
  if (code === 'rate.limited') return 'Too many tries just now. Wait a few minutes and try again.';
  return err instanceof Error ? err.message : String(err);
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
  // ANON_PURSE_ENABLED (noema-131): the ZK bearer purse is gated off for v1 (forgeable dev key
  // until the ceremony runs). null = not yet known; false = show the purse section as coming-soon.
  // This gates ONLY the purse step — card, wallet, and the shielded-wallet anonymity story stay.
  const [purseEnabled, setPurseEnabled] = useState<boolean | null>(null);
  const purseOff = purseEnabled === false;

  // Fiat/card rail — Stripe Checkout redirect + post-return credit poll.
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'polling' | 'settled' | 'timeout'>('idle');

  // Invite code → balance. Someone mints a purse from their balance and sends you the token;
  // redeeming moves its whole remaining balance onto your account, once.
  const [code, setCode] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemErr, setRedeemErr] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<{ credited: string; balance?: string } | null>(null);

  async function redeemCode(e: { preventDefault: () => void }) {
    e.preventDefault();
    const token = code.trim();
    if (!token || redeemBusy || !session) return;
    setRedeemBusy(true); setRedeemErr(null); setRedeemed(null);
    try {
      const out = await api.redeemPurse(token);
      setCode('');
      setRedeemed({ credited: out.credited });
      // The credit is already landed server-side; read the balance back so the confirmation
      // shows the account's real state rather than only the delta we were told about.
      try { const s = await api.meStatus(); setRedeemed({ credited: out.credited, balance: s.balanceImpetus }); }
      catch { /* the redemption stands; only the balance read-back is missing */ }
    } catch (err) {
      setRedeemErr(redeemMessage(err));
    } finally {
      setRedeemBusy(false);
    }
  }

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
    // GET /arcanum/config returns `enabled` (ANON_PURSE_ENABLED, noema-131); read it defensively.
    api.arcanum.config().then((c) => { if (live) setPurseEnabled((c as { enabled?: boolean }).enabled === true); }).catch(() => { if (live) setPurseEnabled(false); });
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
            Anonymity is a property of <b>how you fund</b>, not a blanket promise. Two ways
            in — an on-chain wallet or a card — and we tell you exactly what each one reveals.
            Want spends nothing can tie back to you? Fund from a fresh or shielded wallet — the
            strong-anonymity path available today. {purseOff
              ? <>An unlinkable ZK bearer purse on top is <b>coming soon</b>.</>
              : <>Then mint a ZK purse from your balance.</>}
          </div>
        </div>

        <div className="fund-rows">

          {/* Have a code? — someone funded a purse from their balance and sent you the token.
              Redeeming moves its whole remaining balance onto your account, once. Not a rail
              of its own: no money enters the system here, it changes hands. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic slate"><Ic name="key-round" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Have a code?</h3>
                </div>
                <p className="fund-desc">
                  Someone can send you credits as a code. Redeem it and whatever is left in it
                  becomes part of your balance. A code works <b>once</b>.
                </p>
              </div>
            </div>

            <div className="fund-guide">
              {session ? (
                <form
                  className="fund-actions"
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}
                  onSubmit={redeemCode}
                >
                  <input
                    className="inp mono"
                    style={{ maxWidth: 320 }}
                    aria-label="Invite code"
                    placeholder="paste your code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={redeemBusy}
                  />
                  <button className="btn" type="submit" disabled={redeemBusy || code.trim() === ''}>
                    {redeemBusy ? 'Redeeming…' : <>Redeem <Ic name="arrow-right" /></>}
                  </button>
                </form>
              ) : (
                <div className="warn fund-warn">
                  <WarnIc />
                  <span>
                    Redeeming a code needs an account — <Link to="/onboard">sign in</Link> first,
                    then come back and paste it here.
                  </span>
                </div>
              )}
              {redeemErr && <div className="warn" style={{ marginTop: 'var(--s3)' }}>{redeemErr}</div>}
              {redeemed && (
                <div className="fund-guide-h" style={{ marginTop: 'var(--s3)' }}>
                  Redeemed — {fmt(Number(redeemed.credited))} credits added.
                  {redeemed.balance != null && <> Your balance is {fmt(Number(redeemed.balance))}.</>}
                </div>
              )}
            </div>
          </section>

          {/* Row 1 · On-chain wallet — an address, not a person. Normal = pseudonymous,
              shielded/fresh = the strong-anonymity path available today. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic accent"><Ic name="wallet" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>On-chain wallet</h3>
                </div>
                <p className="fund-desc">
                  Connect a wallet and pay with what it holds. We see an <b>address</b>, not
                  a person. How private that is depends on the wallet you fund from.
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

            <div className="fund-guide">
              <div className="fund-guide-h">
                <Hemisphere sees="pseudonym" /> what your address reveals
              </div>
              <ol className="fund-guide-pts">
                <li>
                  <span className="fg-n">01</span>
                  <span>
                    A <b>normal wallet</b> is pseudonymous — an address that can be traced
                    on-chain. An exchange withdrawal or a prior transfer can tie it back to you.
                  </span>
                </li>
                <li>
                  <span className="fg-n">02</span>
                  <span>
                    A <b>shielded or fresh wallet</b> is the <b>strong-anonymity path
                    available today</b> — an address with no identity behind it, so funding
                    reveals no person. Want no on-chain trail to you? Fund from one of these.
                  </span>
                </li>
              </ol>
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

          {/* Row 2 · Card — the fastest path; it sees you. Not anonymous — say so plainly. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic gold"><Ic name="credit-card" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Card</h3>
                </div>
                <p className="fund-desc">
                  Pay by card via Stripe. The fastest path — and <b>not anonymous</b>: we see
                  your name and card. Fixed packs — the price and the credit are locked in.
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
                      className={`fchip${pack === p.id ? ' on' : ''}`}
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

          {/* Added layer · ZK purse — NOT a peer entry rail. A step you take AFTER you have a
              balance: fund from your balance → mint a bearer purse whose spends are
              cryptographically unlinkable to the note. Fund anonymously (shielded wallet)
              AND spend unlinkably (purse). */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic slate"><Ic name="venetian-mask" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Spend unlinkably — mint a ZK purse</h3>
                  <span className="fund-flag">{purseOff ? '◌ coming soon' : '◌ added layer'}</span>
                </div>
                <p className="fund-desc">
                  Not another way to pay — a step you take <b>after</b> you have a balance. From
                  your balance you mint a <b>ZK bearer purse</b>: spend from it and the spend is
                  cryptographically unlinkable to what you funded. Fund from a shielded wallet
                  <b> and</b> spend from a purse for both layers.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="nothing" label="nothing" />
              </div>
            </div>

            <div className="fund-guide">
              {purseOff && (
                <div className="warn fund-warn" style={{ marginBottom: 'var(--s3)' }}>
                  <WarnIc />
                  <span>
                    The ZK bearer purse is <b>coming soon</b> — it unlocks after the trusted-setup
                    ceremony. Funding anonymously from a shielded or fresh wallet (above) works today;
                    only the on-top unlinkable-spend layer is not live yet.
                  </span>
                </div>
              )}
              <div className="fund-guide-h">
                <Hemisphere sees="nothing" /> how the purse works
              </div>
              <ol className="fund-guide-pts">
                <li>
                  <span className="fg-n">01</span>
                  <span>
                    Add a balance first (wallet or card), then in your Vault mint a purse from it.
                    Its spends carry <b>no name and no account</b> — they can't be tied to the note.
                  </span>
                </li>
                <li>
                  <span className="fg-n">02</span>
                  <span>
                    A purse is a <b>bearer token</b>: hold it or hand off the token to spend
                    elsewhere. Your <b>vault JSON export is the backup</b> — there's no name-based
                    recovery, so keep it safe.
                  </span>
                </li>
              </ol>
              <details className="fund-fallback" style={{ marginTop: 'var(--s3)' }}>
                <summary className="fund-guide-h">how anonymous is the funding step?</summary>
                <p className="fund-desc" style={{ marginTop: 'var(--s3)' }}>
                  Minting a purse debits your balance, so with an <b>identified</b> funder (a card
                  or a doxxable wallet) that step is correlation-resistant, not correlation-proof —
                  the debit and the mint are close in time. Fund from a <b>shielded or fresh
                  wallet</b> and that correlation is between anonymous things: no identity leak.
                  We're building direct-to-commitment deposits so we won't even see the funding
                  wallet — that's on the roadmap, not shipped yet.
                </p>
              </details>
              <div className="fund-actions" style={{ marginTop: 'var(--s3)' }}>
                {purseOff ? (
                  <button className="btn-ghost" disabled aria-disabled="true">
                    <Ic name="venetian-mask" /> Mint a purse — coming soon
                  </button>
                ) : (
                  <Link className="btn-ghost" to="/vault">
                    <Ic name="venetian-mask" /> Mint a purse <Ic name="arrow-right" />
                  </Link>
                )}
              </div>
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
