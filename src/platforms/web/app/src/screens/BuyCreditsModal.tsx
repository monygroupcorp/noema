import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseEther } from 'viem';
import { Ic } from '../lib/icons';
import { api, type DepositConfig, type DepositQuote, type MyDeposit, type Pack } from '../lib/api';
import { connectWallet, waitForReceipt, type ConnectedWallet } from '../lib/wallet';
import { sendEthDeposit } from '../lib/deposit';
import { canCheckout, buildCheckoutRequest, signInThenBuy } from '../lib/checkout';
import { useSession } from '../state/session';
import { Meter } from './IdentityMeter';
import './buy-credits-modal.css';

// BuyCreditsModal — the onchain buy-credits ledger (design handoff
// ADR-024).
// Four numbered mono lines always on screen: 01 ASSET · 02 AMOUNT · 03 SIGN · 04 SETTLE.
// v1: mainnet-only, ETH-only (no asset picker; ERC-20/NFT out of scope — see handoff gap #1/#3).
//
// Wallet-link guardrail (the deposit-attribution fix):
// crediting resolves the payer wallet through the caller's LINKED `'web'` personae — a deposit
// from an unlinked wallet parks unattributed instead of crediting. So before/while offering the
// deposit address we gate on the connected wallet's link state (see `walletGateState`).

const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
const QUICK_TARGETS = [1_000, 10_000, 100_000, 1_000_000];
const QUICK_LABELS = ['1K', '10K', '100K', '1M'];
const SETTLE_POLL_MS = 15_000; // matches the "15–60 seconds" copy (handoff gap #2)
const SETTLE_TIMEOUT_MS = 10 * 60_000; // after this, stop polling but stay closable-safe

type Phase = 'connect' | 'gate-link' | 'amount' | 'sign' | 'sign-rejected' | 'settle' | 'settled';

/** The three wallet-link gate states (spec §Fix 4, Groom decisions #2):
 *  'anon'     — no session at all; the deposit can't reach an account until sign-in + link.
 *  'unlinked' — signed in, but the connected wallet isn't among the caller's linked wallets.
 *  'linked'   — the connected wallet IS one of the caller's linked wallets; proceed. */
export type GateState = 'anon' | 'unlinked' | 'linked';

export function walletGateState(hasSession: boolean, address: string, linkedWallets: string[]): GateState {
  if (!hasSession) return 'anon';
  const isLinked = linkedWallets.some((w) => w.toLowerCase() === address.toLowerCase());
  return isLinked ? 'linked' : 'unlinked';
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Format a token amount (in whole units) the way the legacy quick-target anchors did —
 * price anchors, not exact totals, so precision scales down as the number gets small. */
function fmtEthAnchor(amount: number): string {
  if (!isFinite(amount) || amount <= 0) return '—';
  if (amount >= 100) return amount.toFixed(2);
  if (amount >= 1) return amount.toFixed(4);
  if (amount >= 0.0001) return amount.toFixed(6);
  return amount.toExponential(2);
}

/** ETH needed for `targetCredits`, linearly scaled off a live 1-ETH reference quote.
 * Gas is excluded (same as legacy `_computeAmountForPoints`) — an anchor, not a total. */
export function ethForCredits(targetCredits: number, referenceQuote: DepositQuote | null): number | null {
  if (!referenceQuote) return null;
  const pts = Number(referenceQuote.pointsQuoted);
  if (!pts || !isFinite(pts) || pts <= 0) return null;
  return targetCredits / pts;
}

/** Ledger-line render mode for a given line number against the current phase.
 * 'gate-link' sits between 'connect' and 'amount': the wallet is connected (line 1 settles)
 * but AMOUNT stays locked (ghost) until the link step clears — the modal renders its own
 * dedicated block for 'gate-link', same as it does for 'sign'/'sign-rejected'. */
export function lineMode(line: 1 | 2 | 3 | 4, phase: Phase): 'settled' | 'active' | 'ghost' {
  const order: Phase[] = ['connect', 'gate-link', 'amount', 'sign', 'settle', 'settled'];
  const phaseIdx = phase === 'sign-rejected' ? order.indexOf('sign') : order.indexOf(phase);
  const lineStartIdx = [0, 2, 3, 4][line - 1]; // asset settles once connected (idx 0 done), amount=2, sign=3, settle=4
  if (phaseIdx > lineStartIdx) return 'settled';
  if (phaseIdx === lineStartIdx) return 'active';
  return 'ghost';
}

export function BuyCreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('connect');
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<DepositConfig | null>(null);
  const [refQuote, setRefQuote] = useState<DepositQuote | null>(null);

  // Wallet-link gate (§Fix 4) — the connected wallet's link state, and the link-step's own busy/err.
  const [gate, setGate] = useState<GateState>('anon');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const [ethAmount, setEthAmount] = useState('');
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const quoteReqId = useRef(0);

  const [txHash, setTxHash] = useState<string | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // The card rail offered alongside the wallet on the opening phase. Same server pack catalog
  // and same checkout request the Funding page builds — one source, two places you can start it.
  const [packs, setPacks] = useState<Pack[]>([]);
  const [cardBusy, setCardBusy] = useState<string | null>(null);
  const [cardErr, setCardErr] = useState<string | null>(null);

  const [preBalance, setPreBalance] = useState<number | null>(null);
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const [settledAt, setSettledAt] = useState<string | null>(null);
  const [depositStatus, setDepositStatus] = useState<MyDeposit['status'] | null>(null);

  // Reset to a fresh flow every time the modal opens. A previously-connected wallet is kept
  // (convenience), but its link state is re-checked (checkGate) before deciding the phase.
  useEffect(() => {
    if (!open) return;
    setConnectErr(null);
    setLinkBusy(false); setLinkErr(null);
    setEthAmount(''); setQuote(null); setQuoteErr(null);
    setTxHash(null); setSignErr(null); setConfirmed(false);
    setNewBalance(null); setSettledAt(null); setDepositStatus(null);
    if (!wallet) { setPhase('connect'); setGate('anon'); return; }
    checkGate(wallet.address).then((g) => setPhase(g === 'unlinked' ? 'gate-link' : 'amount'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Resolve the wallet-link gate for `address`: anon (no session) proceeds to AMOUNT with a
  // plain warning (Groom decision #2); signed-in+unlinked routes to the 'gate-link' step;
  // signed-in+linked proceeds. `listWallets` failing (network hiccup) degrades to 'unlinked'
  // (the safer of the two signed-in states — surfaces the link step rather than silently
  // proceeding as if linked).
  async function checkGate(address: string): Promise<GateState> {
    if (!session) { setGate('anon'); return 'anon'; }
    try {
      const { wallets } = await api.auth.listWallets();
      const g = walletGateState(true, address, wallets);
      setGate(g);
      return g;
    } catch {
      setGate('unlinked');
      return 'unlinked';
    }
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.getDepositConfig().then((c) => { if (live) setCfg(c); }).catch(() => {});
    api.listPacks().then((p) => { if (live) setPacks(p); }).catch(() => { /* card rail simply doesn't render */ });
    return () => { live = false; };
  }, [open]);

  // Card pack purchase, the same rail the Funding page runs. An anon caller can't buy on it
  // (the server 401s payments.identity_required), so rather than a dead click we hand them to
  // the door carrying this pack — signing in returns them to that exact purchase.
  function buyPack(packId: string) {
    setCardErr(null);
    if (!canCheckout(session)) { onClose(); navigate(signInThenBuy(packId)); return; }
    setCardBusy(packId);
    api.createCheckoutSession(buildCheckoutRequest(packId, window.location.origin))
      .then((s) => { window.location.href = s.url; })
      .catch((e) => { setCardErr(e instanceof Error ? e.message : String(e)); setCardBusy(null); });
  }

  // Reference quote for 1 ETH — powers the quick-target anchors (1K/10K/100K/1M cr).
  useEffect(() => {
    if (!open || phase === 'connect') return;
    let live = true;
    api.depositQuote({ chainId: 1, token: NATIVE_ETH, amount: parseEther('1').toString() })
      .then((q) => { if (live) setRefQuote(q); })
      .catch(() => {});
    return () => { live = false; };
  }, [open, phase]);

  // Debounced live quote as the user types an ETH amount (400ms, stale-guarded).
  useEffect(() => {
    const v = parseFloat(ethAmount);
    if (!ethAmount || Number.isNaN(v) || v <= 0) { setQuote(null); setQuoteErr(null); return; }
    const reqId = ++quoteReqId.current;
    setQuoteBusy(true); setQuoteErr(null);
    const t = setTimeout(() => {
      let wei: bigint;
      try { wei = parseEther(ethAmount); } catch { setQuoteBusy(false); setQuoteErr('bad amount'); return; }
      api.depositQuote({ chainId: 1, token: NATIVE_ETH, amount: wei.toString() })
        .then((q) => { if (reqId === quoteReqId.current) { setQuote(q); setQuoteBusy(false); } })
        .catch((e) => { if (reqId === quoteReqId.current) { setQuoteErr(e instanceof Error ? e.message : String(e)); setQuoteBusy(false); } });
    }, 400);
    return () => clearTimeout(t);
  }, [ethAmount]);

  async function doConnect() {
    setConnectErr(null);
    try {
      const w = await connectWallet();
      setWallet(w);
      const g = await checkGate(w.address);
      setPhase(g === 'unlinked' ? 'gate-link' : 'amount');
    } catch (e) { setConnectErr(e instanceof Error ? e.message : String(e)); }
  }

  // The inline "link this wallet first" step (Groom decision #2) — reuses the exact
  // challenge/sign/link flow Profile's WalletRow uses, one click, no navigation away.
  async function doLinkWallet() {
    if (!wallet) return;
    setLinkErr(null); setLinkBusy(true);
    try {
      const { token, statement } = await api.auth.walletChallenge(wallet.address);
      const signature = await wallet.signMessage(statement);
      await api.auth.walletLink(token, signature);
      setGate('linked');
      setPhase('amount');
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkBusy(false);
    }
  }

  function pickQuick(targetCredits: number) {
    const eth = ethForCredits(targetCredits, refQuote);
    if (eth == null) return;
    setEthAmount(fmtEthAnchor(eth));
  }

  async function doSign() {
    if (!wallet || !quote) return;
    setSignErr(null);
    setPhase('sign');
    try {
      const meBefore = await api.meStatus().catch(() => null);
      setPreBalance(meBefore ? Number(meBefore.balanceImpetus) : null);
      const amountWei = parseEther(ethAmount);
      const hash = await sendEthDeposit(wallet.address, { amountWei });
      setTxHash(hash);
      await waitForReceipt(hash);
      setConfirmed(true);
      setPhase('settle');
    } catch (e) {
      setSignErr(e instanceof Error ? e.message : String(e));
      setPhase('sign-rejected');
    }
  }

  // 04 SETTLE — poll the caller's OWN deposits (real depositum status) instead of hoping the
  // balance moves (spec §Fix 4). Signed-in: poll GET /v1/deposit/mine, match by txHash, stop on
  // 'processatum' (then read the balance once, for the credited-delta stamp). Anon (no session,
  // §Fix 4 gate decision #2): /v1/deposit/mine 401s for an anon caller, so fall back to the prior
  // balance-delta poll — an anon-unlinked deposit parks unattributed anyway (never credits), so
  // this simply times out, matching that reality rather than hanging on a 401 loop.
  useEffect(() => {
    if (phase !== 'settle') return;
    let live = true;
    const start = Date.now();
    const finishSettled = (bal: number) => {
      setNewBalance(bal);
      setSettledAt(new Date().toISOString());
      setPhase('settled');
    };
    const poll = () => {
      if (session) {
        api.myDeposits().then((r) => {
          if (!live) return;
          const d = txHash ? r.deposits.find((x) => x.txHash.toLowerCase() === txHash.toLowerCase()) : undefined;
          setDepositStatus(d?.status ?? null);
          if (d?.status === 'processatum') {
            api.meStatus().then((s) => { if (live) finishSettled(Number(s.balanceImpetus)); })
              .catch(() => { if (live) setPhase('settled'); });
            return;
          }
          if (Date.now() - start < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
        }).catch(() => {
          if (live && Date.now() - start < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
        });
      } else {
        api.meStatus().then((s) => {
          if (!live) return;
          const bal = Number(s.balanceImpetus);
          if (preBalance == null || bal > preBalance) { finishSettled(bal); return; }
          if (Date.now() - start < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
        }).catch(() => {
          if (live && Date.now() - start < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
        });
      }
    };
    const t = setTimeout(poll, SETTLE_POLL_MS);
    return () => { live = false; clearTimeout(t); };
  }, [phase, preBalance, session, txHash]);

  if (!open) return null;

  const willCredit = quote ? Number(quote.pointsQuoted) : null;
  const creditedDelta = newBalance != null && preBalance != null ? newBalance - preBalance : null;

  return (
    <div className="bcm-overlay" role="dialog" aria-modal="true" aria-label="Buy credits">
      <div className="bcm-modal">
        <div className="bcm-head">
          <div>
            <h2 className="bcm-title">{phase === 'settled' ? 'Settled' : 'Buying credits'}</h2>
          </div>
          <button className="bcm-x" onClick={onClose} aria-label="Close"><Ic name="x" /></button>
        </div>

        <Meter sees="pseudonym" label="a pseudonym" />

        <div className="bcm-ledger">
          {/* 01 ASSET */}
          <div className={`bcm-line l-${lineMode(1, phase)}`}>
            <span className="bcm-num">01</span>
            <span className="bcm-key">Asset</span>
            <span className="bcm-val">
              {wallet ? <>ETH · {shortAddr(wallet.address)}</> : 'connect a wallet to choose'}
            </span>
            {wallet && <span className="bcm-tick">—✓</span>}
          </div>

          {/* GATE — signed-in but the connected wallet isn't linked (§Fix 4, Groom decision #2).
              Blocks AMOUNT until cleared: crediting resolves the payer wallet through the
              caller's linked personae, so an unlinked wallet's deposit would park unattributed. */}
          {phase === 'gate-link' && (
            <div className="bcm-line l-active bcm-sign-block">
              <span className="bcm-num">—</span>
              <span className="bcm-key">Link</span>
              <div className="bcm-sign-body">
                <div className="bcm-sigrow amber">
                  <span aria-hidden="true">△</span> wallet not linked to your account
                </div>
                <div className="bcm-amber-note">
                  A deposit from this wallet can't reach your account until it's linked — one
                  signature, no navigation away. {linkErr && <span className="bcm-errdetail">({linkErr})</span>}
                </div>
                <div className="bcm-footeractions">
                  <button className="btn-ghost" onClick={onClose}>Cancel</button>
                  <button className="btn" disabled={linkBusy} onClick={doLinkWallet}>
                    {linkBusy ? 'Waiting for wallet…' : 'Link this wallet'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 02 AMOUNT */}
          {lineMode(2, phase) === 'active' ? (
            <div className="bcm-line l-active bcm-amount-block">
              <span className="bcm-num">02</span>
              <span className="bcm-key">Amount</span>
              <div className="bcm-amount-body">
                <div className="bcm-quick">
                  {QUICK_TARGETS.map((t, i) => {
                    const eth = ethForCredits(t, refQuote);
                    return (
                      <button key={t} className="bcm-qchip" onClick={() => pickQuick(t)}>
                        <span className="bcm-qcr">{QUICK_LABELS[i]} cr</span>
                        <span className="bcm-qeth">≈ {eth != null ? fmtEthAnchor(eth) : '…'} ETH</span>
                      </button>
                    );
                  })}
                </div>
                <label className="bcm-paylabel">You pay</label>
                <input
                  className="bcm-payinput"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={ethAmount}
                  onChange={(e) => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setEthAmount(v); }}
                />
                <span className="bcm-paysuffix">ETH</span>
                {cfg && (
                  <div className="bcm-spine">
                    − {cfg.defaultFundingRatePct < 100 ? 100 - cfg.defaultFundingRatePct : 0}% funding rate
                    {quote && <> · est. gas</>}
                  </div>
                )}
                <div className="bcm-youget">
                  <span className="bcm-gem">◈</span>{' '}
                  {quoteBusy ? '…' : quoteErr ? 'quote failed' : willCredit != null ? `${fmtInt(willCredit)} cr` : '—'}
                </div>
                {gate === 'anon' && (
                  <div className="warn" style={{ marginTop: 'var(--s3)' }}>
                    This wallet isn't linked to an account — sign in and link it first, or this
                    deposit can't reach an account and won't be credited.
                  </div>
                )}
                <button className="btn" disabled={!quote || quoteBusy} onClick={doSign}>
                  Sign &amp; send <Ic name="arrow-right" />
                </button>
              </div>
            </div>
          ) : (
            <div className={`bcm-line l-${lineMode(2, phase)}`}>
              <span className="bcm-num">02</span>
              <span className="bcm-key">Amount</span>
              <span className="bcm-val">
                {lineMode(2, phase) === 'settled'
                  ? `${ethAmount} ETH → ◈ ${willCredit != null ? fmtInt(willCredit) : '…'} cr`
                  : 'connect a wallet first'}
              </span>
              {lineMode(2, phase) === 'settled' && <span className="bcm-tick">—✓</span>}
            </div>
          )}

          {/* 03 SIGN */}
          {phase === 'sign' || phase === 'sign-rejected' ? (
            <div className="bcm-line l-active bcm-sign-block">
              <span className="bcm-num">03</span>
              <span className="bcm-key">Sign</span>
              <div className="bcm-sign-body">
                {phase === 'sign-rejected' ? (
                  <>
                    <div className="bcm-sigrow amber">
                      <span aria-hidden="true">△</span> deposit — REJECTED IN WALLET
                    </div>
                    <div className="bcm-amber-note">
                      <b>The deposit wasn't signed.</b> Nothing moved — retrying only takes
                      one signature. {signErr && <span className="bcm-errdetail">({signErr})</span>}
                    </div>
                    <div className="bcm-footeractions">
                      <button className="btn-ghost" onClick={onClose}>Cancel</button>
                      <button className="btn" onClick={doSign}>Retry deposit</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bcm-sigrow accent">
                      <span className="bcm-spin"><Ic name="rotate-cw" /></span>{' '}
                      {txHash ? 'deposit — confirming onchain' : 'deposit — SIGN IN WALLET'}
                    </div>
                    <div className="bcm-disclosure">
                      this purchase reveals an address, an amount, a timestamp — never a name,
                      never what you make.
                    </div>
                    <div className="bcm-closesafety">
                      You can close this window — the deposit settles onchain either way and
                      your credits land automatically.
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className={`bcm-line l-${lineMode(3, phase)}`}>
              <span className="bcm-num">03</span>
              <span className="bcm-key">Sign</span>
              <span className="bcm-val">
                {phase === 'settle' || phase === 'settled'
                  ? `deposit ✓${confirmed ? ' · confirmed' : ''}`
                  : 'one signature — build + send to the vault'}
              </span>
              {(phase === 'settle' || phase === 'settled') && <span className="bcm-tick">—✓</span>}
            </div>
          )}

          {/* 04 SETTLE */}
          <div className={`bcm-line l-${phase === 'settled' ? 'settled' : phase === 'settle' ? 'active' : 'ghost'}`}>
            <span className="bcm-num">04</span>
            <span className="bcm-key">Settle</span>
            <span className="bcm-val">
              {phase === 'settled'
                ? `confirmed · ${settledAt ?? ''}`
                : phase === 'settle'
                ? `waiting for the credit to land — ${depositStatus ?? 'detectum'} · polling every 15s`
                : 'credits land automatically'}
            </span>
            {phase === 'settled' && <span className="bcm-tick success">—✓</span>}
          </div>
        </div>

        {phase === 'connect' && (
          <div className="bcm-connect">
            {/* The card rail, offered here rather than only on the Funding page. This modal is
                what the credits pill opens, so it is where most people arrive wanting credits;
                without this the fastest way to pay was the one you could not reach from it. */}
            <div className="bcm-card-rail">
              <div className="bcm-card-head"><Ic name="credit-card" /> Card — fastest, and we see your name</div>
              <div className="bcm-card-packs">
                {packs.map((p) => (
                  <button
                    key={p.id}
                    className="bcm-qchip"
                    disabled={cardBusy != null}
                    onClick={() => buyPack(p.id)}
                  >
                    <span className="bcm-qcr">{fmtInt(p.credits)} cr</span>
                    <span className="bcm-qeth">${p.usd}</span>
                  </button>
                ))}
              </div>
              {!session && (
                <div className="bcm-amber-note">
                  A card purchase needs an account — pick a pack and we'll take you to the door,
                  then straight back to it.
                </div>
              )}
              {cardBusy && <div className="bcm-amber-note">Taking you to Stripe…</div>}
              {cardErr && <div className="warn" style={{ marginTop: 'var(--s3)' }}>{cardErr}</div>}
            </div>

            <div className="bcm-rail-or">or</div>

            <p>
              Connect a wallet to pay with what it already holds. We see an address, not a
              person — an amount and a timestamp, never a name, never what you make. How
              private that address is depends on the wallet: a fresh or shielded one has no
              identity behind it; a normal one can be traced on-chain.
            </p>
            <button className="btn" onClick={doConnect}>Connect wallet</button>
            {connectErr && <div className="warn" style={{ marginTop: 'var(--s3)' }}>{connectErr}</div>}
          </div>
        )}

        {phase === 'settled' && (
          <div className="bcm-stamp">
            <div className="bcm-stamp-cr">◈ +{creditedDelta != null ? fmtInt(creditedDelta) : fmtInt(willCredit ?? 0)} cr</div>
            <div className="bcm-stamp-sub">
              new balance ◈ {newBalance != null ? fmtInt(newBalance) : '…'} cr
              {txHash && <> · tx {shortAddr(txHash)}</>}
            </div>
          </div>
        )}

        <div className="bcm-footer">
          <div className="bcm-willcredit">
            will credit <span className="bcm-gem">◈</span> {willCredit != null ? fmtInt(willCredit) : 0} cr
          </div>
          {phase === 'settled' && <button className="btn" onClick={onClose}>Done</button>}
        </div>
      </div>
    </div>
  );
}
