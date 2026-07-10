import { useEffect, useRef, useState } from 'react';
import { parseEther } from 'viem';
import { Ic } from '../lib/icons';
import { api, type DepositConfig, type DepositQuote } from '../lib/api';
import { connectWallet, waitForReceipt, type ConnectedWallet } from '../lib/wallet';
import { sendEthDeposit } from '../lib/deposit';
import { Meter } from './IdentityMeter';
import './buy-credits-modal.css';

// BuyCreditsModal — the onchain buy-credits ledger (design handoff
// docs/handoff/2026-07-06-buy-credits-modal-handoff.md, spec buy-credits-spec.md, ADR-024).
// Four numbered mono lines always on screen: 01 ASSET · 02 AMOUNT · 03 SIGN · 04 SETTLE.
// v1: mainnet-only, ETH-only (no asset picker; ERC-20/NFT out of scope — see handoff gap #1/#3).

const NATIVE_ETH = '0x0000000000000000000000000000000000000000';
const QUICK_TARGETS = [1_000, 10_000, 100_000, 1_000_000];
const QUICK_LABELS = ['1K', '10K', '100K', '1M'];
const SETTLE_POLL_MS = 15_000; // matches the "15–60 seconds" copy (handoff gap #2)
const SETTLE_TIMEOUT_MS = 10 * 60_000; // after this, stop polling but stay closable-safe

type Phase = 'connect' | 'amount' | 'sign' | 'sign-rejected' | 'settle' | 'settled';

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

/** Ledger-line render mode for a given line number against the current phase. */
export function lineMode(line: 1 | 2 | 3 | 4, phase: Phase): 'settled' | 'active' | 'ghost' {
  const order: Phase[] = ['connect', 'amount', 'sign', 'settle', 'settled'];
  const phaseIdx = phase === 'sign-rejected' ? order.indexOf('sign') : order.indexOf(phase);
  const lineStartIdx = [0, 1, 2, 3][line - 1]; // asset settles once connected (idx 0 done), amount=1, sign=2, settle=3
  if (phaseIdx > lineStartIdx) return 'settled';
  if (phaseIdx === lineStartIdx) return 'active';
  return 'ghost';
}

export function BuyCreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>('connect');
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [connectErr, setConnectErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<DepositConfig | null>(null);
  const [refQuote, setRefQuote] = useState<DepositQuote | null>(null);

  const [ethAmount, setEthAmount] = useState('');
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const quoteReqId = useRef(0);

  const [txHash, setTxHash] = useState<string | null>(null);
  const [signErr, setSignErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const [preBalance, setPreBalance] = useState<number | null>(null);
  const [newBalance, setNewBalance] = useState<number | null>(null);
  const [settledAt, setSettledAt] = useState<string | null>(null);

  // Reset to a fresh flow every time the modal opens.
  useEffect(() => {
    if (!open) return;
    setPhase(wallet ? 'amount' : 'connect');
    setConnectErr(null);
    setEthAmount(''); setQuote(null); setQuoteErr(null);
    setTxHash(null); setSignErr(null); setConfirmed(false);
    setNewBalance(null); setSettledAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.getDepositConfig().then((c) => { if (live) setCfg(c); }).catch(() => {});
    return () => { live = false; };
  }, [open]);

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
    try { const w = await connectWallet(); setWallet(w); setPhase('amount'); }
    catch (e) { setConnectErr(e instanceof Error ? e.message : String(e)); }
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

  // 04 SETTLE — poll me/status until the credit lands (webhook is authoritative).
  useEffect(() => {
    if (phase !== 'settle') return;
    let live = true;
    const start = Date.now();
    const poll = () => {
      api.meStatus().then((s) => {
        if (!live) return;
        const bal = Number(s.balanceImpetus);
        if (preBalance == null || bal > preBalance) {
          setNewBalance(bal);
          setSettledAt(new Date().toISOString());
          setPhase('settled');
          return;
        }
        if (Date.now() - start < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
      }).catch(() => {
        if (live && Date.now() - start < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
      });
    };
    const t = setTimeout(poll, SETTLE_POLL_MS);
    return () => { live = false; clearTimeout(t); };
  }, [phase, preBalance]);

  if (!open) return null;

  const willCredit = quote ? Number(quote.pointsQuoted) : null;
  const creditedDelta = newBalance != null && preBalance != null ? newBalance - preBalance : null;

  return (
    <div className="bcm-overlay" role="dialog" aria-modal="true" aria-label="Buy credits">
      <div className="bcm-modal">
        <div className="bcm-head">
          <div>
            <div className="bcm-kicker">ADD CREDITS · WALLET RAIL</div>
            <h2 className="bcm-title">{phase === 'settled' ? 'Settled' : 'Buying credits'}</h2>
          </div>
          <button className="bcm-x" onClick={onClose} aria-label="Close"><Ic name="x" /></button>
        </div>

        <Meter sees="pseudonym" label="a pseudonym" />

        <div className="bcm-ledger">
          {/* 01 ASSET */}
          <div className={`bcm-line l-${lineMode(1, phase)}`}>
            <span className="bcm-num">01</span>
            <span className="bcm-key">ASSET</span>
            <span className="bcm-val">
              {wallet ? <>ETH · {shortAddr(wallet.address)}</> : 'connect a wallet to choose'}
            </span>
            {wallet && <span className="bcm-tick">—✓</span>}
          </div>

          {/* 02 AMOUNT */}
          {lineMode(2, phase) === 'active' ? (
            <div className="bcm-line l-active bcm-amount-block">
              <span className="bcm-num">02</span>
              <span className="bcm-key">AMOUNT</span>
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
                <label className="bcm-paylabel">YOU PAY</label>
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
                <button className="btn" disabled={!quote || quoteBusy} onClick={doSign}>
                  Sign &amp; send <Ic name="arrow-right" />
                </button>
              </div>
            </div>
          ) : (
            <div className={`bcm-line l-${lineMode(2, phase)}`}>
              <span className="bcm-num">02</span>
              <span className="bcm-key">AMOUNT</span>
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
              <span className="bcm-key">SIGN</span>
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
              <span className="bcm-key">SIGN</span>
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
            <span className="bcm-key">SETTLE</span>
            <span className="bcm-val">
              {phase === 'settled'
                ? `confirmed · ${settledAt ?? ''}`
                : phase === 'settle'
                ? 'waiting for the credit to land — polling every 15s'
                : 'credits land automatically'}
            </span>
            {phase === 'settled' && <span className="bcm-tick success">—✓</span>}
          </div>
        </div>

        {phase === 'connect' && (
          <div className="bcm-connect">
            <p>
              Connect a wallet to pay with what it already holds. We see an address, not a
              person — an amount and a timestamp, never a name, never what you make.
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
