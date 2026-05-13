/**
 * Widget Buy Points Modal — self-contained microact component.
 *
 * Adapted from BuyPointsModal for the widget iframe context:
 *   - API calls go through /widget/:agentId/bp/* proxy routes (no CSRF, no main-app auth)
 *   - Polling instead of WebSocket for tx status
 *   - Wallet provider injected via props.getProvider()
 *   - JWT injected via props.getJwt() (null before auth — purchase still works via wallet address)
 *
 * Export: openBuyPointsModal(opts) — mounts singleton on first call, shows on every call.
 */
import { Component, h, render } from '@monygroupcorp/microact';

const STEP = { ASSET: 1, AMOUNT: 2, REVIEW: 3, TX: 4, RECEIPT: 5 };
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const POLL_MS   = 3500;

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function safeFixed(v, d = 2) {
  const n = Number(v); return isFinite(n) ? n.toFixed(d) : '—';
}

function fmtBig(raw, decimals = 18, precision = 4) {
  if (typeof raw !== 'bigint' || raw === 0n) return '0';
  const div = 10n ** BigInt(decimals);
  const whole = raw / div;
  const frac  = raw % div;
  if (!frac) return whole.toString();
  const scale  = 10n ** BigInt(precision);
  const scaled = (frac * scale) / div;
  const str    = scaled.toString().padStart(precision, '0').replace(/0+$/, '');
  return str ? `${whole}.${str}` : whole.toString();
}

function toSmallest(amtStr, decimals) {
  if (!amtStr || isNaN(amtStr)) return '0';
  const [whole, fraction = ''] = amtStr.split('.');
  const frac = fraction.padEnd(decimals, '0').slice(0, decimals);
  return (whole + frac).replace(/^0+/, '') || '0';
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const STYLES = `
.wbp-overlay {
  position:fixed;inset:0;background:rgba(0,0,0,.82);display:flex;
  align-items:center;justify-content:center;z-index:9999;
}
.wbp-modal {
  background:#13131a;border:1px solid #2a2a3a;border-radius:8px;
  width:340px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column;
  box-shadow:0 24px 60px rgba(0,0,0,.9);
}
.wbp-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:13px 16px;border-bottom:1px solid #1e1e2a;flex-shrink:0;
}
.wbp-title { font-size:13px;font-weight:600;color:#e0e0e0;letter-spacing:.04em;text-transform:uppercase; }
.wbp-close {
  background:none;border:none;color:#555;font-size:20px;cursor:pointer;
  padding:0;line-height:1;flex-shrink:0;
}
.wbp-close:hover { color:#aaa; }
.wbp-body { flex:1;overflow-y:auto;padding:14px 16px; }
.wbp-error { background:#1e0a0a;border:1px solid #4a1a1a;border-radius:4px;color:#f77;font-size:12px;padding:9px 12px;margin-bottom:12px; }
.wbp-loading { color:#555;font-size:12px;text-align:center;padding:20px 0; }
.wbp-spinner {
  width:22px;height:22px;border:2px solid #2a2a3a;border-top-color:#88a;
  border-radius:50%;animation:wbp-spin .9s linear infinite;margin:0 auto 10px;
}
@keyframes wbp-spin { to { transform:rotate(360deg); } }

/* Asset list */
.wbp-asset-list { display:flex;flex-direction:column;gap:6px; }
.wbp-asset-btn {
  display:flex;align-items:center;justify-content:space-between;
  padding:9px 12px;background:#0c0c12;border:1px solid #1e1e2a;
  border-radius:5px;cursor:pointer;color:#ccc;font-size:12px;width:100%;
  text-align:left;transition:border-color .12s;font-family:inherit;
}
.wbp-asset-btn:hover { border-color:#7c5cff; }
.wbp-asset-btn.camel { border-color:#3a2a1a; }
.wbp-asset-btn.camel:hover { border-color:#ca8a3a; }
.wbp-asset-main { display:flex;align-items:center;gap:10px; }
.wbp-asset-icon { width:24px;height:24px;border-radius:50%;flex-shrink:0;object-fit:cover; }
.wbp-asset-name { font-weight:500;color:#ddd; }
.wbp-asset-bal { font-size:10px;color:#555;background:#111;padding:2px 7px;border-radius:3px; }
.wbp-camel-badge {
  font-size:10px;color:#ca8a3a;background:rgba(202,138,58,.1);
  border:1px solid rgba(202,138,58,.3);border-radius:3px;padding:1px 5px;margin-left:6px;
}
.wbp-no-assets { color:#555;font-size:12px;text-align:center;padding:16px 0; }
.wbp-connect-hint { font-size:11px;color:#444;margin-bottom:10px; }

/* Amount step */
.wbp-selected-label { font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px; }
.wbp-input {
  width:100%;padding:9px 12px;background:#0c0c12;border:1px solid #1e1e2a;
  border-radius:4px;color:#e8e8e8;font-size:13px;box-sizing:border-box;
  margin-bottom:10px;outline:none;font-family:monospace;
}
.wbp-input:focus { border-color:#7c5cff; }
.wbp-quote-box { background:#0c0c12;border:1px solid #1e1e2a;border-radius:4px;padding:10px 12px;font-size:12px;line-height:1.9;margin-bottom:12px; }
.wbp-pts { color:#88a;font-weight:600;font-size:13px; }
.wbp-quote-hint { color:#555;font-size:11px;padding:6px 0; }

/* Review */
.wbp-review { background:#0c0c12;border:1px solid #1e1e2a;border-radius:4px;padding:12px;font-size:12px;line-height:1.9; }
.wbp-review-pts { color:#88a;font-weight:600; }
.wbp-review-divider { border:none;border-top:1px solid #1e1e2a;margin:8px 0; }

/* TX + Receipt */
.wbp-tx-center { text-align:center;padding:20px 0; }
.wbp-tx-status { font-size:15px;font-weight:600;margin:10px 0 6px; }
.wbp-tx-hash { font-size:10px;word-break:break-all;color:#555;font-family:monospace;margin-top:8px; }
.wbp-receipt-pts { font-size:22px;font-weight:700;color:#88a;margin:12px 0 4px; }
.wbp-receipt-sub { font-size:12px;color:#555; }

/* Nav */
.wbp-nav { display:flex;justify-content:flex-end;gap:8px;margin-top:14px; }
.wbp-btn {
  padding:7px 16px;border-radius:4px;font-size:12px;cursor:pointer;
  border:1px solid;font-family:inherit;transition:background .12s;
}
.wbp-btn-primary { background:#1a1a2e;border-color:#2a2a4a;color:#88a; }
.wbp-btn-primary:hover:not(:disabled) { background:#1e1e3a; }
.wbp-btn-secondary { background:none;border-color:#2a2a2a;color:#555; }
.wbp-btn-secondary:hover:not(:disabled) { border-color:#444;color:#aaa; }
.wbp-btn:disabled { opacity:.4;cursor:default; }
`;

// ── Component ────────────────────────────────────────────────────────────────

class WidgetBuyPointsModal extends Component {
  constructor(props) {
    // props: apiBase, getJwt, getProvider
    super(props);
    this._pollTimer  = null;
    this._quoteTimer = null;
    this._quoteAbort = null;
    this.state = {
      open:           false,
      step:           STEP.ASSET,
      assets:         null,
      assetsLoading:  false,
      selectedAsset:  null,
      walletAddress:  null,
      balances:       null,
      balancesLoading:false,
      chainId:        null,
      amount:         '',
      quote:          null,
      quoteLoading:   false,
      txStatus:       null,
      statusMsg:      null,
      error:          null,
    };
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get _provider() { return this.props.getProvider?.() || window.ethereum || null; }
  get _jwt()      { return this.props.getJwt?.() || null; }

  _apiFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const jwt = this._jwt;
    if (jwt) headers['Authorization'] = 'Bearer ' + jwt;
    return fetch(this.props.apiBase + path, { ...opts, headers });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  didMount() {
    if (!document.getElementById('wbp-styles')) {
      const s = document.createElement('style');
      s.id = 'wbp-styles';
      s.textContent = STYLES;
      document.head.appendChild(s);
    }
  }

  willUnmount() {
    clearTimeout(this._pollTimer);
    clearTimeout(this._quoteTimer);
    if (this._quoteAbort) this._quoteAbort.abort();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  open() {
    this.setState({ open: true, step: STEP.ASSET, error: null, selectedAsset: null, amount: '', quote: null, txStatus: null, statusMsg: null });
    this._init();
  }

  close() {
    clearTimeout(this._pollTimer);
    clearTimeout(this._quoteTimer);
    this.setState({ open: false });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async _init() {
    const p = this._provider;
    let chainId = null;
    let wallet  = null;
    if (p) {
      try { chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16).toString(); } catch {}
      try {
        const accs = await p.request({ method: 'eth_accounts' });
        if (accs?.length) wallet = accs[0];
      } catch {}
    }
    this.setState({ chainId, walletAddress: wallet });
    this._loadAssets(chainId);
    if (wallet) this._loadBalances(wallet, chainId);
  }

  async _loadAssets(chainId) {
    this.setState({ assetsLoading: true, error: null });
    try {
      const qs  = chainId ? '?chainId=' + chainId : '';
      const r   = await this._apiFetch('/supported-assets' + qs);
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || 'Could not load assets');
      this.setState({ assets: data, assetsLoading: false });
    } catch (e) {
      this.setState({ error: e.message || 'Could not load assets', assetsLoading: false });
    }
  }

  async _loadBalances(address, chainId) {
    this.setState({ balancesLoading: true });
    try {
      const qs = `address=${encodeURIComponent(address)}&chainId=${chainId || '1'}`;
      const r  = await fetch(`/api/v1/wallets/balances?${qs}`);
      const d  = await r.json();
      const tokens = {};
      for (const [addr, entry] of Object.entries(d.tokens || {})) {
        tokens[addr.toLowerCase()] = { raw: BigInt(entry.raw || '0'), decimals: entry.decimals || 18 };
      }
      this.setState({ balances: tokens, balancesLoading: false });
    } catch {
      this.setState({ balancesLoading: false });
    }
  }

  // ── Wallet helpers ────────────────────────────────────────────────────────

  async _connectWallet() {
    const p = this._provider;
    if (!p) throw new Error('No wallet detected — install MetaMask or a web3 wallet');
    const accs = await p.request({ method: 'eth_requestAccounts' });
    const addr = accs?.[0];
    if (!addr) throw new Error('No account selected');
    const chainId = this.state.chainId;
    this.setState({ walletAddress: addr });
    this._loadBalances(addr, chainId);
    return addr;
  }

  _balanceEntry(asset) {
    if (!asset || !this.state.balances) return null;
    const isEth = asset.symbol?.toUpperCase() === 'ETH';
    const addr  = (isEth ? ZERO_ADDR : asset.address || '').toLowerCase();
    return this.state.balances[addr] || null;
  }

  _hasBalance(asset) {
    const e = this._balanceEntry(asset);
    return e ? e.raw > 0n : false;
  }

  _fmtBalance(asset) {
    const e = this._balanceEntry(asset);
    if (!e || e.raw === 0n) return null;
    const val = fmtBig(e.raw, e.decimals);
    return `${val} ${asset.symbol || ''}`;
  }

  // ── Quote ─────────────────────────────────────────────────────────────────

  _onAmountInput(val) {
    if (val !== '' && !/^\d*\.?\d*$/.test(val)) return;
    if (val.startsWith('-')) return;
    this.setState({ amount: val, quote: null, error: null });
    clearTimeout(this._quoteTimer);
    if (val && this.state.selectedAsset) {
      this._quoteTimer = setTimeout(() => this._fetchQuote(), 380);
    }
  }

  async _fetchQuote() {
    const { selectedAsset, amount, walletAddress } = this.state;
    if (!selectedAsset || !amount) return;
    if (this._quoteAbort) this._quoteAbort.abort();
    this._quoteAbort = new AbortController();
    this.setState({ quoteLoading: true });
    try {
      const amtSend = selectedAsset.type === 'token'
        ? toSmallest(amount, selectedAsset.decimals || 18)
        : amount;
      const r = await this._apiFetch('/quote', {
        method: 'POST',
        body: JSON.stringify({
          type:             selectedAsset.type,
          assetAddress:     selectedAsset.address,
          amount:           amtSend,
          userWalletAddress: walletAddress || undefined,
        }),
        signal: this._quoteAbort.signal,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Quote failed');
      this.setState({ quote: d, quoteLoading: false });
    } catch (e) {
      if (e.name === 'AbortError') return;
      this.setState({ quoteLoading: false, error: e.message });
    } finally {
      this._quoteAbort = null;
    }
  }

  // ── Purchase ──────────────────────────────────────────────────────────────

  async _initiatePurchase() {
    const { selectedAsset, amount, quote } = this.state;
    let { walletAddress } = this.state;
    this.setState({ error: null, statusMsg: 'Connecting wallet…' });

    const p = this._provider;
    if (!p) { this.setState({ error: 'No wallet detected', statusMsg: null }); return; }

    try {
      if (!walletAddress) walletAddress = await this._connectWallet();

      const amtSend = selectedAsset.type === 'token'
        ? toSmallest(amount, selectedAsset.decimals || 18)
        : amount;

      this.setState({ statusMsg: 'Preparing transaction…' });
      const r = await this._apiFetch('/purchase', {
        method: 'POST',
        body: JSON.stringify({
          quoteId:          quote.quoteId,
          type:             selectedAsset.type,
          assetAddress:     selectedAsset.address,
          amount:           amtSend,
          userWalletAddress: walletAddress,
        }),
      });
      const purchase = await r.json();
      if (!r.ok) throw new Error(purchase.message || purchase.error?.message || 'Purchase failed');

      const { approvalRequired, approvalTx, depositTx } = purchase;

      // ERC-20 approval if needed
      if (approvalRequired && approvalTx) {
        this.setState({ statusMsg: 'Sign the approval in your wallet…' });
        const approvalHash = await p.request({
          method: 'eth_sendTransaction',
          params: [{ from: walletAddress, to: approvalTx.to, value: '0x0', data: approvalTx.data }],
        });
        this.setState({ statusMsg: 'Waiting for approval confirmation…' });
        await this._waitReceipt(approvalHash, p);
      }

      // Deposit
      this.setState({ statusMsg: 'Sign the payment in your wallet…' });
      const value = depositTx.value && depositTx.value !== '0'
        ? '0x' + BigInt(depositTx.value).toString(16)
        : '0x0';
      const txHash = await p.request({
        method: 'eth_sendTransaction',
        params: [{ from: walletAddress, to: depositTx.to, value, data: depositTx.data }],
      });

      this.setState({ step: STEP.TX, statusMsg: null, txStatus: { status: 'submitted', txHash, message: 'Submitted — confirming…' } });
      this._pollStatus(txHash);

    } catch (e) {
      this.setState({ error: e.message || 'Transaction failed', statusMsg: null, txStatus: null });
    }
  }

  async _waitReceipt(txHash, p, maxMs = 90_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const r = await p.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
        if (r?.blockNumber) {
          if (parseInt(r.status, 16) === 0) throw new Error('Approval transaction reverted');
          return r;
        }
      } catch (e) { if (e.message?.includes('reverted')) throw e; }
      await new Promise(res => setTimeout(res, 2000));
    }
    throw new Error('Approval confirmation timed out');
  }

  _pollStatus(txHash) {
    clearTimeout(this._pollTimer);
    this._pollTimer = setTimeout(async () => {
      try {
        const r = await this._apiFetch('/tx-status?txHash=' + encodeURIComponent(txHash));
        const d = await r.json();
        const st = (d.status || '').toUpperCase();
        if (st === 'CONFIRMED') {
          this.setState({ txStatus: { status: 'confirmed', txHash, receipt: d.receipt }, step: STEP.RECEIPT });
        } else if (st === 'FAILED') {
          this.setState({ txStatus: { status: 'failed', txHash, failureReason: d.failureReason || 'Transaction failed' } });
        } else {
          this.setState({ txStatus: { status: 'pending', txHash, message: 'Confirming on-chain…' } });
          this._pollStatus(txHash);
        }
      } catch {
        this._pollStatus(txHash);
      }
    }, POLL_MS);
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  _btn(label, onClick, variant = 'primary', disabled = false) {
    return h('button', {
      className: `wbp-btn wbp-btn-${variant}`,
      disabled,
      onClick: disabled ? null : onClick,
    }, label);
  }

  _loader(msg) {
    return h('div', { className: 'wbp-loading' },
      h('div', { className: 'wbp-spinner' }),
      h('div', null, msg),
    );
  }

  // ── Step 1: Asset selection ────────────────────────────────────────────────

  _renderAssetStep() {
    const { assets, assetsLoading, walletAddress, balancesLoading } = this.state;

    if (assetsLoading) return this._loader('Loading assets…');
    if (balancesLoading && !this.state.balances) return this._loader('Checking balances…');

    const tokens = (assets?.tokens || []).filter(t => t?.symbol || t?.name);

    // Sort: CAMEL first, then by balance presence, then alphabetical
    const isCamelToken = (t) => t.symbol === '🐪' || t.symbol?.toUpperCase() === 'CAMEL';
    const sorted = [...tokens].sort((a, b) => {
      const aCamel = isCamelToken(a);
      const bCamel = isCamelToken(b);
      if (aCamel !== bCamel) return aCamel ? -1 : 1;
      const aHas = this._hasBalance(a);
      const bHas = this._hasBalance(b);
      if (aHas !== bHas) return aHas ? -1 : 1;
      return (a.symbol || '').localeCompare(b.symbol || '');
    });

    // ETH (native) floated to top unless CAMEL is there
    const nativeIdx = sorted.findIndex(t => t.symbol?.toUpperCase() === 'ETH');
    if (nativeIdx > 1) {
      const [eth] = sorted.splice(nativeIdx, 1);
      sorted.unshift(eth);
    }

    const withBalance = sorted.filter(t => this._hasBalance(t));
    const noBalance   = sorted.filter(t => !this._hasBalance(t));

    const renderAsset = (asset, type) => {
      const sym  = asset.symbol || asset.name;
      const isCamel = isCamelToken(asset);
      const bal  = this._fmtBalance(asset);
      const icon = asset.iconUrl;
      return h('button', {
        key: (asset.address || sym) + type,
        className: 'wbp-asset-btn' + (isCamel ? ' camel' : ''),
        onClick: () => this._selectAsset(asset, type),
      },
        h('div', { className: 'wbp-asset-main' },
          icon ? h('img', { src: icon, className: 'wbp-asset-icon', alt: sym }) : null,
          h('span', { className: 'wbp-asset-name' }, sym),
          isCamel ? h('span', { className: 'wbp-camel-badge' }, '★') : null,
        ),
        bal ? h('span', { className: 'wbp-asset-bal' }, bal) : null,
      );
    };

    if (!walletAddress && !withBalance.length) {
      return h('div', null,
        h('div', { className: 'wbp-connect-hint' }, 'Connect your wallet to see your available balances.'),
        h('div', { className: 'wbp-asset-list' },
          ...sorted.slice(0, 8).map(t => renderAsset(t, 'token')),
        ),
      );
    }

    if (!withBalance.length && !noBalance.length) {
      return h('div', { className: 'wbp-no-assets' }, 'No supported assets found on this network.');
    }

    return h('div', null,
      withBalance.length
        ? h('div', null,
            h('div', { style: 'font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px' }, 'Your balances'),
            h('div', { className: 'wbp-asset-list' }, ...withBalance.map(t => renderAsset(t, 'token'))),
          )
        : null,
      noBalance.length
        ? h('div', { style: withBalance.length ? 'margin-top:12px' : '' },
            h('div', { style: 'font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px' }, 'Other assets'),
            h('div', { className: 'wbp-asset-list' }, ...noBalance.map(t => renderAsset(t, 'token'))),
          )
        : null,
    );
  }

  _selectAsset(asset, type) {
    this.setState({ selectedAsset: { ...asset, type }, amount: '', quote: null, error: null, step: STEP.AMOUNT });
  }

  // ── Step 2: Amount ─────────────────────────────────────────────────────────

  _renderAmountStep() {
    const { selectedAsset, amount, quote, quoteLoading } = this.state;
    const sym = selectedAsset?.symbol || selectedAsset?.name || '';

    const quoteBody = quoteLoading
      ? h('div', { className: 'wbp-quote-hint' }, 'Getting quote…')
      : quote
        ? h('div', { className: 'wbp-quote-box' },
            h('div', null, 'Points: ', h('span', { className: 'wbp-pts' }, quote.pointsCredited ?? '—')),
            h('div', null, 'USD value: $', safeFixed(quote.usdValue?.gross)),
            h('div', null, 'Funding rate: ', quote.fundingRate ?? '—'),
            h('div', null, 'Fees: $', safeFixed(quote.fees?.totalFeesUsd)),
          )
        : h('div', { className: 'wbp-quote-hint' }, 'Enter an amount to get a quote.');

    return h('div', null,
      h('div', { className: 'wbp-selected-label' }, `Paying with ${sym}`),
      h('input', {
        type: 'text',
        className: 'wbp-input',
        placeholder: `Amount in ${sym}`,
        value: amount,
        onInput: (e) => this._onAmountInput(e.target.value),
      }),
      quoteBody,
      h('div', { className: 'wbp-nav' },
        this._btn('← Back', () => this.setState({ step: STEP.ASSET, error: null }), 'secondary'),
        this._btn('Review', () => this.setState({ step: STEP.REVIEW }), 'primary', !quote),
      ),
    );
  }

  // ── Step 3: Review ─────────────────────────────────────────────────────────

  _renderReviewStep() {
    const { selectedAsset, amount, quote, statusMsg } = this.state;
    if (!quote) return h('div', { className: 'wbp-loading' }, 'No quote — go back and enter an amount.');
    if (statusMsg) return this._loader(statusMsg);

    const sym = selectedAsset?.symbol || selectedAsset?.name || '';
    const b   = quote.breakdown || {};
    const toN = v => { const n = Number(v); return isFinite(n) ? n : 0; };
    const gas = toN(b.estimatedGasUsd ?? quote.fees?.estimatedGasUsd);
    const net = toN(b.userReceivesUsd ?? quote.userReceivesUsd ?? quote.usdValue?.netAfterFundingRate ?? quote.usdValue?.gross);

    return h('div', null,
      h('div', { className: 'wbp-review' },
        h('div', null, 'Asset: ', h('b', null, sym)),
        h('div', null, 'Amount: ', h('b', null, amount)),
        h('div', null, 'Points you receive: ', h('span', { className: 'wbp-review-pts' }, quote.pointsCredited)),
        h('hr', { className: 'wbp-review-divider' }),
        h('div', null, 'Gross USD: $', safeFixed(b.grossUsd ?? quote.usdValue?.gross)),
        h('div', null, 'Funding deduction: -$', safeFixed(b.fundingRateDeduction ?? 0)),
        h('div', null, 'Est. gas fee: -$', safeFixed(gas)),
        h('div', { style: 'font-weight:600;color:#88a;margin-top:4px' }, 'You receive: $', safeFixed(net)),
      ),
      h('div', { className: 'wbp-nav' },
        this._btn('← Back', () => this.setState({ step: STEP.AMOUNT, error: null }), 'secondary'),
        this._btn('Buy Points', () => this._initiatePurchase(), 'primary'),
      ),
    );
  }

  // ── Step 4: TX status ──────────────────────────────────────────────────────

  _renderTxStep() {
    const { txStatus } = this.state;
    if (!txStatus) return this._loader('Waiting for transaction…');

    const colors = { submitted: '#88a', pending: '#88a', confirming: '#88a', confirmed: '#6a6', failed: '#f77' };
    const labels = { submitted: 'Submitted', pending: 'Pending', confirming: 'Confirming…', confirmed: 'Confirmed!', failed: 'Failed' };
    const isLive = ['submitted', 'pending', 'confirming'].includes(txStatus.status);
    const color  = colors[txStatus.status] || '#88a';

    return h('div', { className: 'wbp-tx-center' },
      isLive ? h('div', { className: 'wbp-spinner', style: `border-top-color:${color}` }) : null,
      h('div', { className: 'wbp-tx-status', style: `color:${color}` }, labels[txStatus.status] || txStatus.status),
      txStatus.message ? h('div', { style: 'font-size:12px;color:#555;margin-top:4px' }, txStatus.message) : null,
      txStatus.failureReason ? h('div', { className: 'wbp-error', style: 'margin-top:10px' }, txStatus.failureReason) : null,
      h('div', { className: 'wbp-tx-hash' }, txStatus.txHash),
      isLive ? h('div', { style: 'font-size:11px;color:#444;margin-top:12px' }, 'Usually 15–60 s. You can close — your points will be credited automatically.') : null,
    );
  }

  // ── Step 5: Receipt ────────────────────────────────────────────────────────

  _renderReceiptStep() {
    const { txStatus, selectedAsset, amount } = this.state;
    const r   = txStatus?.receipt;
    const pts = r?.points_credited ?? r?.pointsCredited ?? '?';
    const usd = r?.user_credited_usd ?? r?.userCreditedUsd;
    const sym = selectedAsset?.symbol || selectedAsset?.name || '';

    return h('div', { style: 'text-align:center;padding:12px 0' },
      h('div', { style: 'font-size:13px;color:#6a6;margin-bottom:8px' }, '✓ Purchase complete'),
      h('div', { className: 'wbp-receipt-pts' }, `+${pts} pts`),
      usd ? h('div', { className: 'wbp-receipt-sub' }, `$${safeFixed(usd)} credited`) : null,
      h('div', { className: 'wbp-receipt-sub', style: 'margin-top:4px' }, `${amount} ${sym} deposited`),
      h('div', { className: 'wbp-nav', style: 'justify-content:center;margin-top:16px' },
        this._btn('Close', () => this.close(), 'primary'),
      ),
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  render() {
    if (!this.state.open) return h('div', { style: 'display:none' });

    const { step, error } = this.state;
    const titles = {
      [STEP.ASSET]:   'Buy Points',
      [STEP.AMOUNT]:  'Enter Amount',
      [STEP.REVIEW]:  'Review Purchase',
      [STEP.TX]:      'Transaction',
      [STEP.RECEIPT]: 'Complete',
    };

    let body;
    switch (step) {
      case STEP.ASSET:   body = this._renderAssetStep();   break;
      case STEP.AMOUNT:  body = this._renderAmountStep();  break;
      case STEP.REVIEW:  body = this._renderReviewStep();  break;
      case STEP.TX:      body = this._renderTxStep();      break;
      case STEP.RECEIPT: body = this._renderReceiptStep(); break;
      default:           body = null;
    }

    return h('div', { className: 'wbp-overlay', onClick: (e) => { if (e.target === e.currentTarget) this.close(); } },
      h('div', { className: 'wbp-modal' },
        h('div', { className: 'wbp-header' },
          h('span', { className: 'wbp-title' }, titles[step] || 'Buy Points'),
          h('button', { className: 'wbp-close', onClick: () => this.close() }, '×'),
        ),
        h('div', { className: 'wbp-body' },
          error ? h('div', { className: 'wbp-error' }, error) : null,
          body,
        ),
      ),
    );
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _instance = null;
let _root     = null;

/**
 * Mount (once) and open the widget buy-points modal.
 * @param {{ apiBase: string, getJwt: () => string|null, getProvider: () => any }} opts
 */
export function openBuyPointsModal(opts) {
  if (!_root) {
    _root = document.createElement('div');
    _root.id = 'wbp-root';
    document.body.appendChild(_root);
  }
  if (!_instance) {
    render(h(WidgetBuyPointsModal, {
      ...opts,
      ref: inst => { _instance = inst; },
    }), _root);
  } else {
    // Refresh opts so getJwt/getProvider always read current closure
    Object.assign(_instance.props, opts);
  }
  _instance?.open();
}
