/**
 * StationThis Widget SDK
 * Load on your page:  <script src="https://your-domain/widget/sdk.js"></script>
 *
 * Usage:
 *   const widget = await StationThis.init({
 *     agentId:   'my-agent-id',
 *     container: document.getElementById('widget-container'),
 *     mode:      'canvas',          // 'canvas' | 'list' | 'gallery'
 *     baseUrl:   'https://your-domain', // optional, defaults to script src origin
 *     onReady:   () => {},          // called when iframe is authenticated and ready
 *     onEvent:   (evt) => {},       // called for all widget events
 *   });
 *
 *   // widget.setMode('list')  — switch modes without reloading
 *   // widget.destroy()         — remove iframe and listeners
 */
(function (global) {
  'use strict';

  // Derive base URL from this script's own src if not provided.
  function _scriptOrigin() {
    var scripts = document.querySelectorAll('script[src*="sdk.js"]');
    if (scripts.length) {
      try { return new URL(scripts[scripts.length - 1].src).origin; } catch (e) {}
    }
    return global.location.origin;
  }

  var StationThis = {
    /**
     * Initialises the widget inside `container`.
     * Returns a Promise that resolves to the widget handle once the iframe is ready.
     */
    init: function (opts) {
      opts = opts || {};
      var agentId      = opts.agentId;
      var container    = opts.container;
      var mode         = opts.mode || 'list';
      var baseUrl      = (opts.baseUrl || _scriptOrigin()).replace(/\/$/, '');
      var onReady      = opts.onReady      || function () {};
      var onEvent      = opts.onEvent      || function () {};
      var _getProvider = opts.getProvider  || function () { return global.ethereum; };

      if (!agentId)   return Promise.reject(new Error('StationThis.init: agentId is required'));
      if (!container) return Promise.reject(new Error('StationThis.init: container element is required'));

      var iframeOrigin = baseUrl;
      var iframeSrc    = baseUrl + '/widget/' + encodeURIComponent(agentId) + '?mode=' + mode;

      // Build iframe
      var iframe = document.createElement('iframe');
      iframe.src    = iframeSrc;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.allow  = 'clipboard-write';
      iframe.setAttribute('allowfullscreen', '');
      container.appendChild(iframe);

      var _destroyed = false;
      var _sessionJwt = null;

      // ── postMessage bridge ──────────────────────────────────────────────────

      function _postToIframe(msg) {
        if (_destroyed || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(msg, iframeOrigin);
      }

      function _handleIframeMessage(evt) {
        if (evt.origin !== iframeOrigin) return;
        var msg = evt.data;
        if (!msg || !msg.type) return;

        if (msg.type === 'WIDGET_READY') {
          onEvent({ type: 'WIDGET_READY' });
          // Relay any already-connected wallet so the iframe shows "Sign in with Wallet"
          // immediately without triggering the owner-only challenge/verify flow.
          _getAccount().then(function (account) {
            if (account) _postToIframe({ type: 'WALLET_AVAILABLE', address: account });
          }).catch(function () {});
        } else if (msg.type === 'WALLET_AUTH_REQUEST') {
          _doWalletAuth(msg);
        } else if (msg.type === 'PAYMENT_REQUIRED') {
          _doX402Payment(msg);
        } else if (msg.type === 'TX_REQUEST') {
          _doTxRequest(msg);
        } else {
          onEvent(msg);
        }
      }

      global.addEventListener('message', _handleIframeMessage);

      // ── Auth relay ──────────────────────────────────────────────────────────

      function _fetch(url, fetchOpts) {
        return fetch(baseUrl + url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, fetchOpts));
      }

      function _doAuth() {
        _getAccount()
          .then(function (account) {
            if (!account) {
              onEvent({ type: 'AUTH_ERROR', error: 'WALLET_NOT_CONNECTED' });
              _postToIframe({ type: 'AUTH_ERROR', error: 'WALLET_NOT_CONNECTED' });
              return;
            }
            // Let the iframe know a wallet is present immediately — button becomes "Sign in with Wallet"
            // before the challenge round-trip completes.
            _postToIframe({ type: 'WALLET_AVAILABLE', address: account });
            return _fetch('/widget/' + encodeURIComponent(agentId) + '/auth/challenge', { method: 'POST' })
              .then(function (r) { return r.json(); })
              .then(function (challenge) {
                return _signChallenge(account, challenge);
              })
              .then(function (sig) {
                return _fetch('/widget/' + encodeURIComponent(agentId) + '/auth/verify', {
                  method: 'POST',
                  body: JSON.stringify({ nonce: sig.nonce, signature: sig.signature }),
                });
              })
              .then(function (r) { return r.json(); })
              .then(function (result) {
                if (result.error) throw new Error(result.error.message || 'Auth failed');
                _sessionJwt = result.sessionJwt;
                _postToIframe({ type: 'SESSION_READY', sessionJwt: _sessionJwt });
                onReady();
              });
          })
          .catch(function (err) {
            onEvent({ type: 'AUTH_ERROR', error: err.message });
            _postToIframe({ type: 'AUTH_ERROR', error: err.message });
          });
      }

      function _getAccount() {
        var eth = _getProvider();
        if (!eth) return Promise.resolve(null);
        return eth.request({ method: 'eth_accounts' }).then(function (accs) {
          return accs && accs.length ? accs[0] : null;
        });
      }

      function _signChallenge(account, challenge) {
        var eth = _getProvider();
        var typedData = JSON.stringify({
          domain:      challenge.domain,
          types:       Object.assign({ EIP712Domain: [
            { name: 'name',    type: 'string'  },
            { name: 'version', type: 'string'  },
            { name: 'chainId', type: 'uint256' },
          ]}, challenge.types),
          primaryType: challenge.primaryType,
          message:     challenge.message,
        });
        return eth.request({
          method: 'eth_signTypedData_v4',
          params: [account, typedData],
        }).then(function (signature) {
          return { nonce: challenge.message.nonce, signature: signature };
        });
      }

      // ── x402 payment signing ───────────────────────────────────────────────
      // Flow:
      //  1. Probe POST /session/x402 → 402 + PaymentRequired (USDC amount, payTo, domain)
      //  2. Build EIP-3009 transferWithAuthorization + sign via eth_signTypedData_v4
      //  3. POST again with X-Payment: base64(paymentPayload) → { sessionJwt }
      //  4. Forward SESSION_READY to iframe
      function _doX402Payment(msg) {
        var eth = _getProvider();
        if (!eth) {
          _postToIframe({ type: 'PAYMENT_ERROR', error: 'No wallet connected' });
          return;
        }

        eth.request({ method: 'eth_accounts' })
          .then(function (accs) {
            var account = accs && accs.length ? accs[0] : null;
            if (!account) {
              _postToIframe({ type: 'PAYMENT_ERROR', error: 'No wallet connected' });
              return;
            }

            // Step 1: probe for payment requirements
            return _fetch('/widget/' + encodeURIComponent(agentId) + '/session/x402', { method: 'POST' })
              .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
              .then(function (probe) {
                if (probe.status !== 402) {
                  throw new Error('x402 not available (status ' + probe.status + ')');
                }
                var pr = probe.data.paymentRequired;
                if (!pr || !pr.accepts || !pr.accepts[0]) throw new Error('Malformed PaymentRequired response');

                var req = pr.accepts[0];
                var chainId = parseInt(req.network.split(':')[1], 10);
                var now = Math.floor(Date.now() / 1000);

                // Random bytes32 nonce
                var nonceBytes = new Uint8Array(32);
                (global.crypto || global.msCrypto).getRandomValues(nonceBytes);
                var nonce = '0x' + Array.from(nonceBytes, function (b) {
                  return ('0' + b.toString(16)).slice(-2);
                }).join('');

                var authorization = {
                  from:        account,
                  to:          req.payTo,
                  value:       req.amount,
                  validAfter:  String(now - 600),
                  validBefore: String(now + (req.maxTimeoutSeconds || 300)),
                  nonce:       nonce,
                };

                // Step 2: sign EIP-3009 transferWithAuthorization
                var typedData = JSON.stringify({
                  types: {
                    EIP712Domain: [
                      { name: 'name',              type: 'string'  },
                      { name: 'version',           type: 'string'  },
                      { name: 'chainId',           type: 'uint256' },
                      { name: 'verifyingContract', type: 'address' },
                    ],
                    TransferWithAuthorization: [
                      { name: 'from',        type: 'address' },
                      { name: 'to',          type: 'address' },
                      { name: 'value',       type: 'uint256' },
                      { name: 'validAfter',  type: 'uint256' },
                      { name: 'validBefore', type: 'uint256' },
                      { name: 'nonce',       type: 'bytes32' },
                    ],
                  },
                  domain: {
                    name:              (req.extra && req.extra.name)    || 'USD Coin',
                    version:           (req.extra && req.extra.version) || '2',
                    chainId:           chainId,
                    verifyingContract: req.asset,
                  },
                  primaryType: 'TransferWithAuthorization',
                  message: authorization,
                });

                return eth.request({ method: 'eth_signTypedData_v4', params: [account, typedData] })
                  .then(function (signature) {
                    // Step 3: encode X-Payment header
                    var paymentPayload = {
                      x402Version: 2,
                      payload:  { authorization: authorization, signature: signature },
                      accepted: req,
                      resource: pr.resource,
                    };
                    var headerValue = btoa(JSON.stringify(paymentPayload));

                    return _fetch('/widget/' + encodeURIComponent(agentId) + '/session/x402', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Payment': headerValue },
                    });
                  })
                  .then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
                  .then(function (result) {
                    if (!result.data.sessionJwt) {
                      throw new Error((result.data.error && result.data.error.message) || 'Payment rejected');
                    }
                    _sessionJwt = result.data.sessionJwt;
                    _postToIframe({ type: 'SESSION_READY', sessionJwt: _sessionJwt });
                    onReady();
                  });
              });
          })
          .catch(function (err) {
            _postToIframe({ type: 'PAYMENT_ERROR', error: err.message });
          });
      }

      // ── Wallet auth ─────────────────────────────────────────────────────────
      // Called when the iframe requests wallet-based sign-in.
      // One signing request — server detects ownership and issues agent_owner
      // or user tier JWT accordingly.
      function _doWalletAuth(msg) {
        var authAgentId = msg.agentId || agentId;
        var eth, account;

        // Resolve account: try silent first, then prompt connection if needed
        function _resolveAccount() {
          eth = _getProvider();
          if (!eth) return Promise.resolve(null);
          return eth.request({ method: 'eth_accounts' }).then(function (accs) {
            if (accs && accs.length) return accs[0];
            // No authorized account — prompt the user to connect their wallet
            return eth.request({ method: 'eth_requestAccounts' })
              .then(function (accs2) { return accs2 && accs2.length ? accs2[0] : null; })
              .catch(function () { return null; }); // user rejected
          });
        }

        _resolveAccount()
          .then(function (acct) {
            if (!acct) {
              _postToIframe({ type: 'WALLET_AUTH_ERROR', error: 'No wallet connected — install MetaMask or a web3 wallet' });
              return;
            }
            account = acct;
            return _fetch('/widget/' + encodeURIComponent(authAgentId) + '/auth/wallet/nonce', {
              method: 'POST',
              body: JSON.stringify({ address: account }),
            });
          })
          .then(function (r) { return r && r.json(); })
          .then(function (challenge) {
            if (!challenge) return;
            if (challenge.error) throw new Error(challenge.error.message || 'Failed to get nonce');
            var typedData = JSON.stringify({
              domain:      challenge.domain,
              types:       Object.assign({ EIP712Domain: [
                { name: 'name',    type: 'string'  },
                { name: 'version', type: 'string'  },
                { name: 'chainId', type: 'uint256' },
              ]}, challenge.types),
              primaryType: 'Auth',
              message:     challenge.message,
            });
            return eth.request({ method: 'eth_signTypedData_v4', params: [account, typedData] })
              .then(function (signature) {
                return _fetch('/widget/' + encodeURIComponent(authAgentId) + '/auth/wallet/verify', {
                  method: 'POST',
                  body: JSON.stringify({ nonce: challenge.message.nonce, signature: signature }),
                });
              })
              .then(function (r) { return r.json(); })
              .then(function (result) {
                if (result.error) throw new Error(result.error.message || 'Auth failed');
                _sessionJwt = result.sessionJwt;
                _postToIframe({ type: 'SESSION_READY', sessionJwt: _sessionJwt });
                onReady();
              });
          })
          .catch(function (err) {
            _postToIframe({ type: 'WALLET_AUTH_ERROR', error: err.message });
          });
      }

      // ── On-chain purchase tx ────────────────────────────────────────────────
      // Fetches purchase-info (vault address + pre-encoded calldata) from server,
      // switches chain to Base, submits eth_sendTransaction, sends TX_HASH to iframe.
      function _doTxRequest(msg) {
        var txAgentId = msg.agentId || agentId;
        _getAccount()
          .then(function (account) {
            if (!account) {
              _postToIframe({ type: 'TX_ERROR', error: 'No wallet connected' });
              return;
            }
            return _fetch('/widget/' + encodeURIComponent(txAgentId) + '/purchase-info')
              .then(function (r) { return r.json(); })
              .then(function (info) {
                if (info.error) throw new Error(info.error.message || 'Failed to get purchase info');
                var eth = _getProvider();
                var chainHex = '0x' + info.chainId.toString(16);
                // Switch to the correct chain (Base), ignore if already there
                return eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
                  .catch(function () { /* already on chain or chain not added */ })
                  .then(function () {
                    return eth.request({
                      method: 'eth_sendTransaction',
                      params: [{
                        from:  account,
                        to:    info.creditVaultAddress,
                        data:  info.calldata,
                        value: info.suggestedAmountsWei[0],
                      }],
                    });
                  })
                  .then(function (txHash) {
                    _postToIframe({ type: 'TX_HASH', txHash: txHash, walletAddress: account });
                  });
              });
          })
          .catch(function (err) {
            _postToIframe({ type: 'TX_ERROR', error: err.message });
          });
      }

      // ── Widget handle ───────────────────────────────────────────────────────

      var handle = {
        /** Switch to a different mode without re-authenticating */
        setMode: function (newMode) {
          mode = newMode;
          _postToIframe({ type: 'SET_MODE', mode: newMode });
        },

        /** Supply a delegation code programmatically (skips the entrance gate UI) */
        redeemCode: function (token) {
          return fetch(baseUrl + '/widget/' + encodeURIComponent(agentId) + '/auth/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token }),
          })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.sessionJwt) _postToIframe({ type: 'SESSION_READY', sessionJwt: d.sessionJwt });
            return d;
          });
        },

        /** Request the agent to run a specific spell by slug */
        castSpell: function (spellSlug, inputs) {
          _postToIframe({ type: 'CAST_SPELL', spellSlug: spellSlug, inputs: inputs || {} });
        },

        /** Notify iframe that a wallet is now connected on the host page */
        walletConnected: function (address) {
          _postToIframe({ type: 'WALLET_AVAILABLE', address: address });
        },

        /** Notify iframe that the host page wallet disconnected */
        walletDisconnected: function () {
          _postToIframe({ type: 'WALLET_DISCONNECTED' });
        },

        /** Remove iframe and clean up listeners */
        destroy: function () {
          _destroyed = true;
          global.removeEventListener('message', _handleIframeMessage);
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        },

        getSessionJwt: function () { return _sessionJwt; },
        iframe: iframe,
      };

      return Promise.resolve(handle);
    },

    /**
     * Mounts a collection gallery iframe that polls recent outputs across all
     * agents sharing the given NFT collection address.
     *
     * @param {{ collectionAddress: string, container: Element, chainId?: string, baseUrl?: string }} opts
     * @returns {Promise<{ iframe: HTMLIFrameElement, destroy: () => void }>}
     */
    initGallery: function (opts) {
      opts = opts || {};
      var collectionAddress = opts.collectionAddress;
      var container         = opts.container;
      var chainId           = opts.chainId || '1';
      var ownerJwt          = opts.ownerJwt  || null;
      var theme             = opts.theme     || {};

      if (!collectionAddress) return Promise.reject(new Error('StationThis.initGallery: collectionAddress is required'));
      if (!container)         return Promise.reject(new Error('StationThis.initGallery: container element is required'));

      var baseUrl = opts.baseUrl || _scriptOrigin();
      var addr    = collectionAddress.toLowerCase();
      var qs = new URLSearchParams();
      if (chainId !== '1') qs.set('chainId', chainId);
      if (ownerJwt) qs.set('ownerJwt', ownerJwt);
      // Theme keys map to CSS custom property param names
      var themeKeys = { bg: 'bg', cardBg: 'card-bg', cardRadius: 'card-radius', accent: 'accent', text: 'text', textDim: 'text-dim' };
      Object.keys(themeKeys).forEach(function (k) {
        if (theme[k]) qs.set(themeKeys[k], theme[k]);
      });
      var qstr = qs.toString();
      var src  = baseUrl + '/widget/gallery/' + encodeURIComponent(addr) + (qstr ? '?' + qstr : '');

      var iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.style.cssText = 'border:none;width:100%;height:100%;display:block;';
      iframe.setAttribute('allowtransparency', 'true');
      container.appendChild(iframe);

      // ── Parent-page lightbox for gallery image clicks ─────────────────────
      // The gallery iframe sends GALLERY_LIGHTBOX via postMessage; we create
      // a full-page overlay here in the parent document where there are no
      // iframe sizing constraints.
      var _lb = null;

      function _createLb(url, label) {
        if (_lb) _lb.parentNode.removeChild(_lb);
        var el = document.createElement('div');
        el.style.cssText = [
          'position:fixed;inset:0;z-index:2147483647',
          'background:rgba(0,0,0,.93)',
          'display:flex;flex-direction:column;align-items:center;justify-content:center',
          'padding:20px',
          'cursor:pointer',
        ].join(';');

        var img = document.createElement('img');
        img.src = url;
        img.style.cssText = 'max-width:min(900px,100%);max-height:85vh;border-radius:6px;object-fit:contain;box-shadow:0 12px 60px rgba(0,0,0,.8);cursor:default;';
        img.addEventListener('click', function (e) { e.stopPropagation(); });

        var close = document.createElement('button');
        close.textContent = '✕';
        close.style.cssText = 'position:absolute;top:14px;right:18px;font-size:22px;color:#aaa;background:none;border:none;cursor:pointer;line-height:1;padding:4px;';
        close.addEventListener('click', _closeLb);

        var meta = document.createElement('div');
        meta.textContent = label || '';
        meta.style.cssText = 'position:absolute;bottom:16px;left:0;right:0;text-align:center;font-size:11px;color:#666;pointer-events:none;font-family:system-ui,sans-serif;';

        el.appendChild(img);
        el.appendChild(close);
        if (label) el.appendChild(meta);
        el.addEventListener('click', _closeLb);
        document.body.appendChild(el);
        _lb = el;

        document.addEventListener('keydown', _lbKeyDown);
        // Tell iframe to suppress its local fallback overlay
        iframe.contentWindow.postMessage({ type: 'GALLERY_LIGHTBOX_CLOSE' }, '*');
      }

      function _closeLb() {
        if (_lb) { _lb.parentNode.removeChild(_lb); _lb = null; }
        document.removeEventListener('keydown', _lbKeyDown);
      }

      function _lbKeyDown(e) { if (e.key === 'Escape') _closeLb(); }

      function _onGalleryMsg(e) {
        if (!e.data || e.data.type !== 'GALLERY_LIGHTBOX') return;
        // Only handle messages from our iframe
        try { if (e.source !== iframe.contentWindow) return; } catch (_) {}
        _createLb(e.data.url, e.data.label);
      }

      global.addEventListener('message', _onGalleryMsg);

      return Promise.resolve({
        iframe:  iframe,
        destroy: function () {
          global.removeEventListener('message', _onGalleryMsg);
          _closeLb();
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        },
      });
    },

    /**
     * Mounts a partner widget iframe inside `el`.
     *
     * @param {{ partnerId: string, el: string|Element, theme?: string }} opts
     * @returns {{ destroy: () => void }}
     */
    initWidget: function (opts) {
      opts = opts || {};
      var partnerId = opts.partnerId;
      if (!partnerId) {
        console.error('[StationThis] initWidget: partnerId is required');
        return { destroy: function () {} };
      }
      var el = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
      if (!el) {
        console.error('[StationThis] initWidget: element not found', opts.el);
        return { destroy: function () {} };
      }

      var BASE_URL = _scriptOrigin();
      var iframeOrigin = _scriptOrigin();
      var src = BASE_URL + '/widget/partner?partnerId=' + encodeURIComponent(partnerId);
      if (opts.theme) src += '&theme=' + encodeURIComponent(opts.theme);

      var iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
      iframe.allow = 'clipboard-write';
      el.appendChild(iframe);

      // Lightbox handler — same pattern as initGallery
      var _lb = null;

      function _closeLb() {
        if (_lb) { document.body.removeChild(_lb); _lb = null; }
        if (iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'GALLERY_LIGHTBOX_CLOSE' }, iframeOrigin);
      }

      function _onMsg(e) {
        if (!e.data) return;
        try { if (e.source !== iframe.contentWindow) return; } catch (_) {}
        if (e.data.type === 'GALLERY_LIGHTBOX') {
          if (_lb) _closeLb();
          var overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.93);display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:zoom-out;';
          var img = document.createElement('img');
          img.src = e.data.url;
          img.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;border-radius:4px;';
          var meta = document.createElement('p');
          meta.textContent = e.data.label || '';
          meta.style.cssText = 'color:#fff;margin-top:12px;font-size:14px;opacity:.7;';
          overlay.appendChild(img);
          overlay.appendChild(meta);
          overlay.addEventListener('click', _closeLb);
          document.body.appendChild(overlay);
          _lb = overlay;
        }
      }

      global.addEventListener('message', _onMsg);

      return {
        destroy: function () {
          global.removeEventListener('message', _onMsg);
          if (_lb) _closeLb();
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        },
      };
    },
  };

  global.StationThis = StationThis;
})(window);
