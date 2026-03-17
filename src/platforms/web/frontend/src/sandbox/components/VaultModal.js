import { Component, h, eventBus } from '@monygroupcorp/microact';
import { Modal, Loader, ModalError } from './Modal.js';
import { CopyButton, AsyncButton, EmptyState } from './ModalKit.js';
import { fetchJson, postWithCsrf } from '../../lib/api.js';
import { shortenAddress } from '../../lib/format.js';
import { WalletService } from '@monygroupcorp/micro-web3';
import { websocketClient } from '../ws.js';

// ── Views ──────────────────────────────────────────────────

const VIEW = { LIST: 'list', DETAIL: 'detail', CREATE: 'create' };
const CREATE_STEP = { NAME: 1, REVIEW: 2, SIGNING: 3, RECEIPT: 4 };

/**
 * VaultModal — unified referral vault management.
 *
 * Props:
 *   onClose — close handler
 */
export class VaultModal extends Component {
  constructor(props) {
    super(props);
    this.state = {
      view: VIEW.LIST,
      // List
      vaults: [],
      vaultsLoading: true,
      vaultsError: null,
      // Detail
      selectedVault: null,
      dashboard: null,
      dashLoading: false,
      dashError: null,
      // Create
      createStep: CREATE_STEP.NAME,
      createName: '',
      nameAvailable: false,
      nameChecking: false,
      createError: null,
      registering: false,
      registerMessage: null,
      // Wallet
      walletAddress: null,
      walletConnecting: false,
    };
    this._nameDebounce = null;
    this._wsHandler = null;
    this._walletService = new WalletService(eventBus);
  }

  get _provider() {
    return this._walletService.provider || window.ethereum || null;
  }

  async didMount() {
    await this._walletService.initialize();
    this._fetchVaults();
    this._wsHandler = (evt) => this._onVaultUpdate(evt);
    websocketClient.on('referralVaultUpdate', this._wsHandler);

    // Auto-detect connected wallet
    await this._refreshWallet();

    this.registerCleanup(() => {
      websocketClient.off('referralVaultUpdate', this._wsHandler);
      clearTimeout(this._nameDebounce);
      this._walletService.destroy();
    });
  }

  async _refreshWallet() {
    const p = this._provider;
    if (!p) return;
    try {
      const accounts = await p.request({ method: 'eth_accounts' });
      if (accounts && accounts[0]) {
        this.setState({ walletAddress: accounts[0] });
      }
    } catch (err) {
      // Wallet not connected — that's fine
    }
  }

  async _connectWallet() {
    const p = this._provider;
    if (!p) {
      this.setState({ createError: 'No wallet detected. Please install MetaMask or another browser wallet.' });
      return;
    }
    this.setState({ walletConnecting: true, createError: null });
    try {
      const accounts = await p.request({ method: 'eth_requestAccounts' });
      this.setState({ walletAddress: accounts[0], walletConnecting: false });
    } catch (err) {
      this.setState({ createError: 'Wallet connection rejected.', walletConnecting: false });
    }
  }

  // ── Data fetching ────────────────────────────────────────

  async _fetchVaults() {
    this.setState({ vaultsLoading: true, vaultsError: null });
    try {
      const data = await fetchJson('/api/v1/referral-vault/my-vaults');
      // Filter to only vaults with a referral_key (on-chain registrations)
      const vaults = (data.vaults || []).filter(v => v.referral_key);
      this.setState({ vaults, vaultsLoading: false });
    } catch (err) {
      this.setState({ vaultsError: err.message, vaultsLoading: false });
    }
  }

  async _fetchDashboard(vault) {
    this.setState({
      view: VIEW.DETAIL,
      selectedVault: vault,
      dashLoading: true,
      dashError: null,
      dashboard: null,
    });
    try {
      const data = await fetchJson(`/api/v1/referral-vault/${encodeURIComponent(vault.vault_name)}/dashboard`);
      this.setState({ dashboard: data, dashLoading: false });
    } catch (err) {
      this.setState({ dashError: err.message, dashLoading: false });
    }
  }

  // ── Create flow ──────────────────────────────────────────

  _onNameInput(e) {
    const name = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
    this.setState({ createName: name, nameAvailable: false, createError: null });
    clearTimeout(this._nameDebounce);
    if (name.length > 3) {
      this._nameDebounce = setTimeout(() => this._checkName(name), 400);
    }
  }

  async _checkName(name) {
    this.setState({ nameChecking: true });
    try {
      const data = await fetchJson(`/api/v1/referral-vault/check-name?name=${encodeURIComponent(name)}`);
      if (this.state.createName === name) {
        this.setState({ nameAvailable: data.isAvailable, nameChecking: false });
      }
    } catch (err) {
      this.setState({ createError: err.message, nameChecking: false });
    }
  }

  async _register() {
    const { createName, walletAddress } = this.state;
    if (!walletAddress) {
      this.setState({ createError: 'Please connect your wallet first.' });
      return;
    }

    this.setState({ createStep: CREATE_STEP.SIGNING, registering: true, createError: null, registerMessage: 'Preparing registration...' });
    try {
      // 1. Get calldata from backend
      const res = await postWithCsrf('/api/v1/referral-vault/register', {
        name: createName,
        userWalletAddress: walletAddress,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to prepare registration.');

      // 2. Prompt wallet to sign the transaction
      this.setState({ registerMessage: 'Please confirm the transaction in your wallet...' });
      const p = this._provider;
      if (!p) throw new Error('Wallet disconnected.');

      const txHash = await p.request({
        method: 'eth_sendTransaction',
        params: [{
          from: data.registerTx.from,
          to: data.registerTx.to,
          data: data.registerTx.data,
        }],
      });

      this.setState({
        registerMessage: 'Transaction submitted! Waiting for on-chain confirmation...',
        registering: false,
      });

      // 3. Wait for the ReferralRegistered webhook to confirm
      // The websocket handler _onVaultUpdate will transition to RECEIPT
      this._pendingTxHash = txHash;

    } catch (err) {
      const msg = err.code === 4001 ? 'Transaction rejected in wallet.' : err.message;
      this.setState({ createError: msg, createStep: CREATE_STEP.REVIEW, registering: false, registerMessage: null });
    }
  }

  _onVaultUpdate({ status }) {
    if (this.state.view !== VIEW.CREATE || this.state.createStep !== CREATE_STEP.SIGNING) return;
    if (status === 'active' || status === 'ACTIVE') {
      this.setState({ createStep: CREATE_STEP.RECEIPT, registering: false, registerMessage: null });
    }
  }

  _goToCreatedVault() {
    this._fetchVaults();
    const name = this.state.createName;
    if (name) {
      this._fetchDashboard({ vault_name: name });
    } else {
      this._resetCreate();
      this.setState({ view: VIEW.LIST });
    }
  }

  _resetCreate() {
    this.setState({
      createStep: CREATE_STEP.NAME,
      createName: '',
      nameAvailable: false,
      nameChecking: false,
      createError: null,
      registering: false,
      registerMessage: null,
    });
  }

  // ── Navigation ───────────────────────────────────────────

  _goList() {
    this._resetCreate();
    this.setState({ view: VIEW.LIST, selectedVault: null, dashboard: null });
  }

  _goCreate() {
    this._resetCreate();
    this.setState({ view: VIEW.CREATE });
  }

  // ── Render: List ─────────────────────────────────────────

  _renderList() {
    const { vaults, vaultsLoading, vaultsError } = this.state;

    if (vaultsLoading) return h(Loader, { message: 'Loading vaults...' });

    if (vaultsError) {
      return h('div', null,
        ModalError({ message: vaultsError }),
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._fetchVaults), label: 'Retry' })
      );
    }

    if (vaults.length === 0) {
      return h(EmptyState, {
        icon: '\uD83C\uDFE6',
        message: 'You don\'t have any referral codes yet. Register one to start earning rewards when others use your code.',
        action: 'Register Referral Code',
        onAction: this.bind(this._goCreate),
      });
    }

    return h('div', null,
      h('div', { className: 'vm-list-header' },
        h(AsyncButton, { variant: 'secondary', onclick: this.bind(this._goCreate), label: '+ New Code' })
      ),
      ...vaults.map(v =>
        h('div', {
          className: 'vm-card',
          key: v.referral_key || v._id,
          onclick: () => this._fetchDashboard(v),
        },
          h('div', { className: 'vm-card-name' }, v.vault_name || '(unnamed)'),
          h('div', { className: 'vm-card-addr' }, v.owner_address ? shortenAddress(v.owner_address) : ''),
        )
      )
    );
  }

  // ── Render: Detail ───────────────────────────────────────

  _renderDetail() {
    const { selectedVault, dashboard, dashLoading, dashError } = this.state;

    return h('div', null,
      h('button', { className: 'vm-back', onclick: this.bind(this._goList) }, '\u2190 All Codes'),

      // Vault header
      h('div', { className: 'vm-detail-header' },
        h('h3', { className: 'vm-detail-name' }, selectedVault.vault_name || '(unnamed)'),
        h('div', { className: 'vm-detail-row' },
          h('span', { className: 'vm-detail-label' }, 'Owner'),
          h('code', { className: 'vm-detail-mono' }, selectedVault.owner_address ? shortenAddress(selectedVault.owner_address) : 'Unknown'),
        ),
        h('div', { className: 'vm-detail-row' },
          h('span', { className: 'vm-detail-label' }, 'Referral Link'),
          h('code', { className: 'vm-detail-mono' }, `noema.art/referral/${selectedVault.vault_name}`),
          h(CopyButton, { text: `noema.art/referral/${selectedVault.vault_name}` })
        )
      ),

      // Dashboard body
      dashLoading ? h(Loader, { message: 'Loading stats...' }) : null,
      dashError ? h('div', null,
        ModalError({ message: dashError }),
        h(AsyncButton, { variant: 'secondary', onclick: () => this._fetchDashboard(selectedVault), label: 'Retry' })
      ) : null,

      // Totals
      dashboard && dashboard.totals
        ? h('div', { className: 'vm-totals' },
          h('div', { className: 'vm-total-item' },
            h('span', null, 'Total Volume'),
            h('span', null, this._formatWei(dashboard.totals.referralVolumeWei))
          ),
          h('div', { className: 'vm-total-item' },
            h('span', null, 'Total Earned'),
            h('span', { className: 'vm-total-earned' }, this._formatWei(dashboard.totals.referralRewardsWei))
          )
        )
        : null,

      // Token breakdown
      dashboard && dashboard.tokens && dashboard.tokens.length > 0
        ? h('div', { className: 'vm-tokens' },
          ...dashboard.tokens.map(token => this._renderToken(token))
        )
        : null,

      dashboard && (!dashboard.tokens || dashboard.tokens.length === 0) && !dashLoading
        ? h('div', { className: 'vm-no-tokens' }, 'No referral payments received yet.')
        : null,
    );
  }

  _formatWei(weiStr) {
    if (!weiStr || weiStr === '0') return '0';
    try {
      const val = Number(BigInt(weiStr)) / 1e18;
      return val < 0.0001 ? '<0.0001 ETH' : `${val.toFixed(4)} ETH`;
    } catch {
      return weiStr;
    }
  }

  _renderToken(token) {
    return h('div', { className: 'vm-token', key: token.tokenAddress },
      h('div', { className: 'vm-token-head' },
        h('span', { className: 'vm-token-symbol' }, token.symbol || 'Unknown')
      ),
      h('div', { className: 'vm-token-stat' },
        h('span', null, 'Volume'),
        h('span', null, this._formatWei(token.totalVolume))
      ),
      h('div', { className: 'vm-token-stat' },
        h('span', null, 'Earned'),
        h('span', { className: 'vm-token-val--has' }, this._formatWei(token.totalReferralEarned))
      ),
      h('div', { className: 'vm-token-stat' },
        h('span', null, 'Deposits'),
        h('span', null, String(token.depositCount))
      ),
    );
  }

  // ── Render: Create ───────────────────────────────────────

  _renderCreate() {
    const { createStep } = this.state;
    switch (createStep) {
      case CREATE_STEP.NAME: return this._renderCreateName();
      case CREATE_STEP.REVIEW: return this._renderCreateReview();
      case CREATE_STEP.SIGNING: return this._renderCreateSigning();
      case CREATE_STEP.RECEIPT: return this._renderCreateReceipt();
      default: return h('div', { style: 'display:none' });
    }
  }

  _renderCreateName() {
    const { createName, nameChecking, nameAvailable, walletAddress } = this.state;
    let statusCls = '', statusText = 'Enter a name (4+ characters, letters/numbers/dashes/underscores).';
    if (nameChecking) { statusCls = 'vm-status--checking'; statusText = 'Checking on-chain...'; }
    else if (createName.length > 3 && nameAvailable) { statusCls = 'vm-status--ok'; statusText = `"${createName}" is available!`; }
    else if (createName.length > 3) { statusCls = 'vm-status--bad'; statusText = `"${createName}" is taken.`; }

    return h('div', null,
      h('button', { className: 'vm-back', onclick: this.bind(this._goList) }, '\u2190 Back'),
      h('p', { style: 'color:var(--text-secondary);font-size:var(--fs-md);margin:12px 0' }, 'Register a referral code on-chain. When someone uses your code in a payment, you earn a share of the transaction.'),

      // Wallet connection
      !walletAddress
        ? h('div', { className: 'vm-wallet-prompt' },
          h(AsyncButton, {
            variant: 'secondary',
            onclick: this.bind(this._connectWallet),
            label: this.state.walletConnecting ? 'Connecting...' : 'Connect Wallet',
            disabled: this.state.walletConnecting,
          })
        )
        : h('div', { className: 'vm-wallet-connected' },
          h('span', null, 'Wallet: '),
          h('code', null, shortenAddress(walletAddress))
        ),

      h('div', { className: 'vm-form' },
        h('label', null, 'Referral Code Name'),
        h('input', {
          type: 'text',
          value: createName,
          placeholder: 'e.g., crypto-king',
          oninput: this.bind(this._onNameInput),
          onkeydown: (e) => e.stopPropagation(),
        }),
        h('div', { className: `vm-status ${statusCls}` }, statusText)
      ),
      h('div', { className: 'vm-nav' },
        h(AsyncButton, {
          disabled: !nameAvailable || nameChecking || !walletAddress,
          onclick: () => this.setState({ createStep: CREATE_STEP.REVIEW, createError: null }),
          label: 'Next',
        })
      )
    );
  }

  _renderCreateReview() {
    return h('div', null,
      h('button', { className: 'vm-back', onclick: () => this.setState({ createStep: CREATE_STEP.NAME }) }, '\u2190 Back'),
      h('div', { className: 'vm-review' },
        h('p', null, 'You are about to register:'),
        h('p', null, h('strong', null, 'Code: '), this.state.createName),
        h('p', null, h('strong', null, 'Wallet: '), shortenAddress(this.state.walletAddress)),
        h('p', { style: 'font-size:var(--fs-sm);color:var(--text-label);margin-top:12px' }, 'This will send a transaction to register your referral code on-chain. You will be prompted to sign in your wallet.')
      ),
      h('div', { className: 'vm-nav' },
        h(AsyncButton, { variant: 'secondary', onclick: () => this.setState({ createStep: CREATE_STEP.NAME }), label: 'Back' }),
        h(AsyncButton, { onclick: this.bind(this._register), label: 'Register On-Chain' })
      )
    );
  }

  _renderCreateSigning() {
    const { registerMessage } = this.state;
    return h('div', { className: 'vm-deploy' },
      h(Loader, { message: registerMessage })
    );
  }

  _renderCreateReceipt() {
    return h('div', { className: 'vm-receipt' },
      h('h3', null, 'Registration Successful!'),
      h('p', null, 'Your referral code is now active on-chain.'),
      h('p', null, h('strong', null, 'Code: '), this.state.createName),
      h('div', { className: 'vm-nav' },
        h(AsyncButton, { onclick: this.bind(this._goToCreatedVault), label: 'View Dashboard' })
      )
    );
  }

  // ── Styles ───────────────────────────────────────────────

  static get styles() {
    return `
      /* List */
      .vm-list-header { display: flex; justify-content: flex-end; margin-bottom: 12px; }
      .vm-card { background: var(--surface-2); border: var(--border-width) solid var(--border); border-radius: 0; padding: 14px 16px; margin-bottom: 8px; cursor: pointer; transition: border-color var(--dur-interact) var(--ease); }
      .vm-card:hover { border-color: var(--border-hover); }
      .vm-card-name { font-weight: 600; font-size: var(--fs-lg); color: var(--text-primary); margin-bottom: 4px; }
      .vm-card-addr { font-family: var(--ff-mono); font-size: var(--fs-xs); color: var(--text-secondary); }

      /* Detail */
      .vm-back { background: none; border: none; color: var(--accent); cursor: pointer; font-size: var(--fs-base); padding: 0; margin-bottom: 16px; }
      .vm-back:hover { text-decoration: underline; }
      .vm-detail-header { margin-bottom: 20px; }
      .vm-detail-name { margin: 0 0 12px; font-size: var(--fs-xl); color: var(--text-primary); }
      .vm-detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: var(--fs-base); }
      .vm-detail-label { color: var(--text-secondary); min-width: 90px; }
      .vm-detail-mono { font-family: var(--ff-mono); color: var(--text-primary); font-size: var(--fs-xs); }

      /* Totals */
      .vm-totals { display: flex; gap: 16px; margin-bottom: 16px; }
      .vm-total-item { flex: 1; background: var(--surface-2); border: var(--border-width) solid var(--border); padding: 14px; display: flex; flex-direction: column; gap: 4px; }
      .vm-total-item span:first-child { font-size: var(--fs-sm); color: var(--text-secondary); }
      .vm-total-item span:last-child { font-size: var(--fs-lg); font-weight: 600; color: var(--text-primary); }
      .vm-total-earned { color: var(--accent) !important; }

      /* Tokens */
      .vm-tokens { margin-bottom: 16px; }
      .vm-token { border: var(--border-width) solid var(--border); border-radius: 0; padding: 14px; margin-bottom: 8px; }
      .vm-token-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
      .vm-token-symbol { font-weight: 600; font-size: var(--fs-lg); color: var(--text-primary); }
      .vm-token-stat { display: flex; justify-content: space-between; padding: 4px 0; font-size: var(--fs-base); }
      .vm-token-stat span:first-child { color: var(--text-secondary); }
      .vm-token-stat span:last-child { color: var(--text-primary); }
      .vm-token-val--has { color: var(--accent) !important; font-weight: 600; }
      .vm-no-tokens { color: var(--text-secondary); font-size: var(--fs-md); padding: 20px 0; text-align: center; }

      /* Create */
      .vm-wallet-prompt { margin: 12px 0; }
      .vm-wallet-connected { font-size: var(--fs-base); color: var(--text-secondary); margin: 12px 0; }
      .vm-wallet-connected code { color: var(--accent); font-family: var(--ff-mono); font-size: var(--fs-xs); }
      .vm-form { margin: 16px 0; }
      .vm-form label { display: block; margin-bottom: 8px; color: var(--text-secondary); font-weight: 600; font-size: var(--fs-base); }
      .vm-form input { width: 100%; padding: 10px 14px; background: var(--surface-1); border: var(--border-width) solid var(--border); border-radius: 0; color: var(--text-primary); font-size: var(--fs-md); box-sizing: border-box; outline: none; }
      .vm-form input:focus { border-color: var(--accent-border); }
      .vm-status { font-size: var(--fs-base); margin-top: 8px; min-height: 1.2em; }
      .vm-status--checking { color: var(--accent-dim); }
      .vm-status--ok { color: var(--accent); }
      .vm-status--bad { color: var(--danger); }
      .vm-nav { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
      .vm-review { background: var(--surface-2); border-radius: 0; padding: 16px; margin: 16px 0; color: var(--text-secondary); line-height: 1.6; border: var(--border-width) solid var(--border); }
      .vm-review strong { color: var(--accent); }
      .vm-deploy { text-align: center; padding: 24px 0; }
      .vm-receipt { text-align: center; }
      .vm-receipt h3 { color: var(--accent); margin-bottom: 12px; }
    `;
  }

  // ── Main render ──────────────────────────────────────────

  render() {
    const { view, createStep, createError } = this.state;

    const titles = {
      [VIEW.LIST]: 'Referral Codes',
      [VIEW.DETAIL]: null,
      [VIEW.CREATE]: {
        [CREATE_STEP.NAME]: 'Register Referral Code',
        [CREATE_STEP.REVIEW]: 'Review',
        [CREATE_STEP.SIGNING]: 'Registering...',
        [CREATE_STEP.RECEIPT]: 'Success',
      }[createStep] || 'Register Referral Code',
    };

    const title = titles[view];
    const error = view === VIEW.CREATE ? createError : null;

    let body;
    switch (view) {
      case VIEW.LIST: body = this._renderList(); break;
      case VIEW.DETAIL: body = this._renderDetail(); break;
      case VIEW.CREATE: body = this._renderCreate(); break;
      default: body = h('div', { style: 'display:none' });
    }

    return h(Modal, { onClose: this.props.onClose, title, wide: true, content: [
      error ? ModalError({ message: error }) : null,
      body
    ] });
  }
}
