// =============================================================================
// widgetSdk — the `/widget/sdk.js` browser client (ADR-0011 §7).
// =============================================================================
//
// The human-facing embed surface is a SCRIPT-INJECTED SDK, not a raw iframe URL:
// a partner does `<script src="https://noema.art/widget/sdk.js">` and gets
// `window.StationThis`. THE CONTRACT TO PRESERVE IS THAT SDK API — the camel404
// client (deployed, referenced from on-chain agentURI data) calls exactly:
//   StationThis.init({ agentId, container, getProvider, onEvent })  → handle
//     .walletConnected(address) / .destroy()
//   StationThis.initGallery({ collectionAddress, container })       → { destroy }
// The iframe the SDK builds (served by widgetRouter) is an implementation detail.
//
// This is a faithful port of the legacy SDK with the framing HARDENED:
//   • parent→iframe posts are pinned to the iframe origin (carry the session JWT);
//   • the gallery RECEIVE handler now verifies `evt.origin` (legacy trusted '*').
// It is a browser string (served with a JS content-type), not compiled by tsc — so
// it lives as one exported constant, versioned in crystal alongside the router.

export const WIDGET_SDK_JS = `/* StationThis Widget SDK — served by noema-crystal (ADR-0011 §7).
 * <script src="https://noema.art/widget/sdk.js"></script>
 *   const w = await StationThis.init({ agentId, container, getProvider, onEvent })
 *   w.walletConnected(addr); w.destroy();
 *   const g = await StationThis.initGallery({ collectionAddress, container }); g.destroy();
 */
(function (global) {
  'use strict';

  // Derive base URL from this script's own src (must match where agents are provisioned).
  function _scriptOrigin() {
    var scripts = document.querySelectorAll('script[src*="sdk.js"]');
    if (scripts.length) {
      try { return new URL(scripts[scripts.length - 1].src).origin; } catch (e) {}
    }
    return global.location.origin;
  }

  var StationThis = {
    init: function (opts) {
      opts = opts || {};
      var agentId      = opts.agentId;
      var container    = opts.container;
      var mode         = opts.mode || 'list';
      var baseUrl      = (opts.baseUrl || _scriptOrigin()).replace(/\\/$/, '');
      var onReady      = opts.onReady     || function () {};
      var onEvent      = opts.onEvent     || function () {};
      var _getProvider = opts.getProvider || function () { return global.ethereum; };

      if (!agentId)   return Promise.reject(new Error('StationThis.init: agentId is required'));
      if (!container) return Promise.reject(new Error('StationThis.init: container element is required'));

      var iframeOrigin = baseUrl;
      var iframe = document.createElement('iframe');
      iframe.src = baseUrl + '/widget/' + encodeURIComponent(agentId) + '?mode=' + encodeURIComponent(mode);
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.allow = 'clipboard-write';
      iframe.setAttribute('allowfullscreen', '');
      container.appendChild(iframe);

      var _destroyed = false;
      var _sessionJwt = null;

      // ── postMessage bridge (parent→iframe pinned to iframeOrigin) ──────────────
      function _postToIframe(msg) {
        if (_destroyed || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(msg, iframeOrigin);
      }
      function _handleIframeMessage(evt) {
        if (evt.origin !== iframeOrigin) return;           // pinned — reject foreign origins
        try { if (evt.source !== iframe.contentWindow) return; } catch (e) { return; }
        var msg = evt.data;
        if (!msg || !msg.type) return;
        if (msg.type === 'WIDGET_READY') {
          onEvent({ type: 'WIDGET_READY' });
          _getAccount().then(function (a) { if (a) _postToIframe({ type: 'WALLET_AVAILABLE', address: a }); }).catch(function () {});
        } else if (msg.type === 'WALLET_AUTH_REQUEST') { _doWalletAuth(msg);
        } else if (msg.type === 'PAYMENT_REQUIRED')    { _signX402Payment(msg.paymentRequired);
        } else { onEvent(msg); }
      }
      global.addEventListener('message', _handleIframeMessage);

      function _fetch(url, o) {
        return fetch(baseUrl + url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, o));
      }
      function _getAccount() {
        var eth = _getProvider();
        if (!eth) return Promise.resolve(null);
        return eth.request({ method: 'eth_accounts' }).then(function (a) { return a && a.length ? a[0] : null; });
      }

      // ── Wallet sign-in (one signature; server issues owner/user-tier JWT) ──────
      function _doWalletAuth(msg) {
        var authAgentId = (msg && msg.agentId) || agentId;
        var eth = _getProvider(), account;
        if (!eth) { _postToIframe({ type: 'WALLET_AUTH_ERROR', error: 'No wallet connected' }); return; }
        eth.request({ method: 'eth_accounts' })
          .then(function (a) { return (a && a.length) ? a[0] : eth.request({ method: 'eth_requestAccounts' }).then(function (b) { return b && b.length ? b[0] : null; }).catch(function () { return null; }); })
          .then(function (acct) {
            if (!acct) { _postToIframe({ type: 'WALLET_AUTH_ERROR', error: 'No wallet connected' }); return; }
            account = acct;
            return _fetch('/widget/' + encodeURIComponent(authAgentId) + '/auth/wallet/nonce', { method: 'POST', body: JSON.stringify({ address: account }) })
              .then(function (r) { return r.json(); })
              .then(function (ch) {
                if (!ch) return; if (ch.error) throw new Error(ch.error.message || 'nonce failed');
                var typedData = JSON.stringify({
                  domain: ch.domain,
                  types: Object.assign({ EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }] }, ch.types),
                  primaryType: 'Auth', message: ch.message,
                });
                return eth.request({ method: 'eth_signTypedData_v4', params: [account, typedData] })
                  .then(function (sig) { return _fetch('/widget/' + encodeURIComponent(authAgentId) + '/auth/wallet/verify', { method: 'POST', body: JSON.stringify({ nonce: ch.message.nonce, signature: sig }) }); })
                  .then(function (r) { return r.json(); })
                  .then(function (res) { if (res.error) throw new Error(res.error.message || 'auth failed'); _sessionJwt = res.sessionJwt; _postToIframe({ type: 'SESSION_READY', sessionJwt: _sessionJwt }); onReady(); });
              });
          })
          .catch(function (err) { _postToIframe({ type: 'WALLET_AUTH_ERROR', error: err.message }); });
      }

      // ── x402 pay-per-call (v2, §5): SIGN the iframe's PaymentRequirements → return the
      // X-Payment header. The iframe probed the run endpoint and does the paid POST itself;
      // the SDK's only job is to sign the EIP-3009 authorization with the host-page wallet.
      // No server round-trip here, no session — each run is one payment (PAYMENT_SIGNED).
      function _signX402Payment(pr) {
        var eth = _getProvider();
        if (!eth) { _postToIframe({ type: 'PAYMENT_ERROR', error: 'No wallet connected' }); return; }
        var req = pr && pr.accepts && pr.accepts[0];
        if (!req) { _postToIframe({ type: 'PAYMENT_ERROR', error: 'Malformed PaymentRequired' }); return; }
        eth.request({ method: 'eth_accounts' }).then(function (a) {
          var account = a && a.length ? a[0] : null;
          if (!account) { _postToIframe({ type: 'PAYMENT_ERROR', error: 'No wallet connected' }); return; }
          var chainId = parseInt(req.network.split(':')[1], 10);
          var now = Math.floor(Date.now() / 1000);
          var nb = new Uint8Array(32); (global.crypto || global.msCrypto).getRandomValues(nb);
          var nonce = '0x' + Array.from(nb, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
          var authorization = { from: account, to: req.payTo, value: req.amount, validAfter: String(now - 600), validBefore: String(now + (req.maxTimeoutSeconds || 300)), nonce: nonce };
          var typedData = JSON.stringify({
            types: {
              EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
              TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }],
            },
            domain: { name: (req.extra && req.extra.name) || 'USD Coin', version: (req.extra && req.extra.version) || '2', chainId: chainId, verifyingContract: req.asset },
            primaryType: 'TransferWithAuthorization', message: authorization,
          });
          return eth.request({ method: 'eth_signTypedData_v4', params: [account, typedData] }).then(function (signature) {
            var header = btoa(JSON.stringify({ x402Version: 2, payload: { authorization: authorization, signature: signature }, accepted: req, resource: pr.resource }));
            _postToIframe({ type: 'PAYMENT_SIGNED', header: header });
          });
        }).catch(function (err) { _postToIframe({ type: 'PAYMENT_ERROR', error: err.message }); });
      }

      return Promise.resolve({
        setMode: function (m) { mode = m; _postToIframe({ type: 'SET_MODE', mode: m }); },
        castSpell: function (slug, inputs) { _postToIframe({ type: 'CAST_SPELL', spellSlug: slug, inputs: inputs || {} }); },
        redeemCode: function (token) {
          return _fetch('/widget/' + encodeURIComponent(agentId) + '/auth/redeem', { method: 'POST', body: JSON.stringify({ token: token }) })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.sessionJwt) _postToIframe({ type: 'SESSION_READY', sessionJwt: d.sessionJwt }); return d; });
        },
        walletConnected: function (address) { _postToIframe({ type: 'WALLET_AVAILABLE', address: address }); },
        walletDisconnected: function () { _postToIframe({ type: 'WALLET_DISCONNECTED' }); },
        getSessionJwt: function () { return _sessionJwt; },
        destroy: function () { _destroyed = true; global.removeEventListener('message', _handleIframeMessage); if (iframe.parentNode) iframe.parentNode.removeChild(iframe); },
        iframe: iframe,
      });
    },

    initGallery: function (opts) {
      opts = opts || {};
      var collectionAddress = opts.collectionAddress;
      var container = opts.container;
      if (!collectionAddress) return Promise.reject(new Error('StationThis.initGallery: collectionAddress is required'));
      if (!container)         return Promise.reject(new Error('StationThis.initGallery: container element is required'));

      var baseUrl = (opts.baseUrl || _scriptOrigin()).replace(/\\/$/, '');
      var iframeOrigin = baseUrl;
      var addr = String(collectionAddress).toLowerCase();
      var qs = new URLSearchParams();
      if (opts.chainId && opts.chainId !== '1') qs.set('chainId', opts.chainId);
      var theme = opts.theme || {};
      var themeKeys = { bg: 'bg', cardBg: 'card-bg', accent: 'accent', text: 'text', textDim: 'text-dim' };
      Object.keys(themeKeys).forEach(function (k) { if (theme[k]) qs.set(themeKeys[k], theme[k]); });
      var q = qs.toString();
      var iframe = document.createElement('iframe');
      iframe.src = baseUrl + '/widget/gallery/' + encodeURIComponent(addr) + (q ? '?' + q : '');
      iframe.style.cssText = 'border:none;width:100%;height:100%;display:block;';
      iframe.setAttribute('allowtransparency', 'true');
      container.appendChild(iframe);

      // Parent-page lightbox for gallery clicks — hardened: verify the sending origin.
      var _lb = null;
      function _closeLb() { if (_lb) { _lb.parentNode.removeChild(_lb); _lb = null; } document.removeEventListener('keydown', _key); }
      function _key(e) { if (e.key === 'Escape') _closeLb(); }
      function _openLb(url, label) {
        if (_lb) _closeLb();
        var el = document.createElement('div');
        el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;cursor:pointer;';
        var img = document.createElement('img');
        img.src = url; img.style.cssText = 'max-width:min(900px,100%);max-height:85vh;border-radius:6px;object-fit:contain;cursor:default;';
        img.addEventListener('click', function (e) { e.stopPropagation(); });
        el.appendChild(img);
        if (label) { var m = document.createElement('div'); m.textContent = label; m.style.cssText = 'position:absolute;bottom:16px;left:0;right:0;text-align:center;font-size:11px;color:#666;font-family:system-ui,sans-serif;'; el.appendChild(m); }
        el.addEventListener('click', _closeLb); document.body.appendChild(el); _lb = el; document.addEventListener('keydown', _key);
      }
      function _onMsg(e) {
        if (e.origin !== iframeOrigin) return;             // pinned — legacy trusted '*'
        try { if (e.source !== iframe.contentWindow) return; } catch (x) { return; }
        if (!e.data || e.data.type !== 'GALLERY_LIGHTBOX') return;
        _openLb(e.data.url, e.data.label);
      }
      global.addEventListener('message', _onMsg);

      return Promise.resolve({
        iframe: iframe,
        destroy: function () { global.removeEventListener('message', _onMsg); _closeLb(); if (iframe.parentNode) iframe.parentNode.removeChild(iframe); },
      });
    },
  };

  global.StationThis = StationThis;
})(window);
`
