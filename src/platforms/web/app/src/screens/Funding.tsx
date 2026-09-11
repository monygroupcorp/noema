import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, ApiRequestError, type ArcanumConfig, type DepositConfig, type Pack } from '../lib/api';
import { purseIsOff } from '../lib/purseSwitch';
import { connectWallet } from '../lib/wallet';
import { useSession } from '../state/session';
import { canCheckout, buildCheckoutRequest, signInThenBuy } from '../lib/checkout';
import { doorPath } from '../lib/entry';
import { creditsLanded } from '../lib/balance';
import { Hemisphere, Meter } from './IdentityMeter';
import { BuyCreditsModal } from './BuyCreditsModal';

// The credit packs render from ONE server source (GET /v1/payments/packs, `api.listPacks()`),
// sourced from the backend's single `stripePacks` catalog — no hardcoded numbers here. The shared
// USD/credit anchor across the page: the fiat/card rail's Stripe checkout is priced EXACTLY off that
// server table (server-authoritative — /v1/payments/checkout credits the backend impetus constant,
// never a client computation); the anon-rail chips reuse the same denominations as an informational
// preview. Change a pack number in stripePacks.ts and every surface here updates automatically.
//
// The rails are ordered by how many people take them, not by how private they are: card first
// (the page's own copy calls it the fastest path), then the wallet, then the purse layer that
// only applies once you have a balance, and last the code redemption, which needs a code someone
// else minted. Each still says plainly what it reveals — the honesty is in the copy, not the order.

// The card-rail helpers live in lib/checkout so the buy-credits modal builds the same request.
// Re-exported here because this module was their original home.
export { canCheckout, buildCheckoutRequest };

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

export function Funding() {
  const { session, ready } = useSession();
  const navigate = useNavigate();
  // The pack named by the pricing-page CTA (?pack=<id>), else the default mid-tier. Arriving
  // WITH one is a decision the visitor already made by pressing Buy, so it starts checkout
  // rather than only highlighting a chip they would have to press again.
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
  // until the ceremony runs). null = not yet known, which `purseIsOff` reads as off, as it reads
  // an unreachable config — this page is the one the others send a visitor to with "how purse
  // works", so it must not be the one page offering a mint the server refuses.
  // This gates ONLY the purse step — card, wallet, and the shielded-wallet anonymity story stay.
  const [purse, setPurse] = useState<ArcanumConfig | null>(null);
  const purseOff = purseIsOff(purse);

  // Fiat/card rail — start a Stripe Checkout redirect. What comes BACK from Stripe is the
  // shell's (shell/CheckoutReturn): the buyer now lands on the page they left, not here.
  const [checkoutBusy, setCheckoutBusy] = useState<string | null>(null);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

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
      creditsLanded();   // the top bar's number is the one people check; it was standing stale
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

  // A ?pack= that is not a real SKU resolves to nothing and the page falls back to asking the
  // visitor to pick — but not before the catalog has arrived, because until it does there is no
  // pack to name AND no chip to press, so "pick a pack" would be the same wrong instruction,
  // just briefly.
  const namingPending = preselected != null && packs.length === 0;

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

  // Card pack purchase. An anon/purse caller can't buy on this rail (the server 401s
  // payments.identity_required), so instead of a click that does nothing we send them to the
  // door with this pack in hand — signing in returns them here and the purchase resumes.
  function buyPack(packId: string) {
    setCheckoutErr(null);
    if (!canCheckout(session)) { navigate(signInThenBuy(packId)); return; }
    setCheckoutBusy(packId);
    api.createCheckoutSession(buildCheckoutRequest(packId, window.location.origin))
      .then((s) => { window.location.href = s.url; })
      .catch((e) => { setCheckoutErr(e instanceof Error ? e.message : String(e)); setCheckoutBusy(null); });
  }

  // Arriving as /funding?pack=<id> — from a pricing card's Buy — carries a decision the visitor
  // already made by pressing Buy. So this page does not ask for it again: `buyPack` starts the
  // checkout for a signed-in visitor, and takes an anon one to the door holding the pack, where
  // making an account leads straight on to that same checkout. Either way this page is not a
  // stop, which is the step this removes.
  //
  // It fires once (a ref, not state, so a re-render can't double-charge) and only once auth has
  // settled, so a signed-in visitor whose session is still hydrating isn't mistaken for an anon
  // one. A pack that isn't a real SKU is left alone, and the page falls back to asking them to
  // pick from the chips.
  //
  // The pack leaves the URL before we do, the way the return-from-Stripe flag is dropped: this
  // page is where Stripe sends a buyer who came from nowhere in particular, and where the browser
  // Back button lands from the door — either arriving on a URL that would start the whole thing
  // over, with no way out but forward.
  const resumeFired = useRef(false);
  useEffect(() => {
    if (!ready || resumeFired.current || !preselected || packs.length === 0) return;
    if (!packs.some((p) => p.id === preselected)) return;   // not a real SKU — leave them on the page
    resumeFired.current = true;
    window.history.replaceState({}, '', window.location.pathname);
    buyPack(preselected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, session, preselected, packs]);

  useEffect(() => {
    let live = true;
    api.getDepositConfig().then((c) => { if (live) setCfg(c); }).catch(() => {});
    // GET /arcanum/config returns `enabled` (ANON_PURSE_ENABLED, noema-131). A failed fetch
    // leaves the config null, which reads as off — see purseSwitch.ts.
    api.arcanum.config().then((c) => { if (live) setPurse(c); }).catch(() => {});
    api.listPacks().then((p) => {
      if (!live) return;
      setPacks(p);
      // If the CTA's ?pack= wasn't a real SKU, fall back to a valid selection.
      setPack((cur) => (p.some((x) => x.id === cur) ? cur : (p[0]?.id ?? cur)));
    }).catch(() => {});
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

          {/* Row 1 · Card — the fastest path and the one most people take; it sees you. Not
              anonymous — say so plainly, and say it first. */}
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

              {/* A visitor who arrived holding a pack is already on their way to the door with
                  it; this only speaks to someone browsing the rails with no pack in hand. */}
              {!session && !namingPending && (
                <div className="warn fund-warn" style={{ marginTop: 'var(--s3)' }}>
                  <Ic name="triangle-alert" />
                  <span>
                    A card purchase needs an identified account (fiat can't fund an anonymous
                    purse). Pick a pack and we'll take you to the door — make an account there and
                    you go straight on to the card checkout.
                  </span>
                </div>
              )}
              {checkoutBusy && (
                <div className="fund-guide-h" style={{ marginTop: 'var(--s3)' }}>
                  Taking you to Stripe for the {packs.find((p) => p.id === checkoutBusy)?.label ?? checkoutBusy} pack…
                </div>
              )}
              {checkoutErr && <div className="warn" style={{ marginTop: 'var(--s3)' }}>{checkoutErr}</div>}
            </div>
          </section>

          {/* Row 2 · On-chain wallet — an address, not a person. Normal = pseudonymous,
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
                  <Ic name="triangle-alert" />
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

          {/* Last · Have a code? — someone funded a purse from their balance and sent you the token.
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
                  <Ic name="triangle-alert" />
                  <span>
                    {/* Back to the bare page, deliberately: this URL may still carry a ?pack= that
                        an anon visitor never chose to buy, and returning to it would start that
                        checkout the moment they signed in. */}
                    Redeeming a code needs an account — <Link to={doorPath('/funding')}>sign in</Link> first.
                    You land back on this page with the box ready.
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

        </div>

        <div className="warn" style={{ marginTop: 'var(--s7)' }}>
          Credits are a prepaid balance for compute on noema — not money.
          Non-transferable, non-withdrawable, redeemable only for runs here.
        </div>

      </div></div>
    </AppShell>
  );
}
