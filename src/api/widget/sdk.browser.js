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
      var agentId   = opts.agentId;
      var container = opts.container;
      var mode      = opts.mode || 'canvas';
      var baseUrl   = (opts.baseUrl || _scriptOrigin()).replace(/\/$/, '');
      var onReady   = opts.onReady   || function () {};
      var onEvent   = opts.onEvent   || function () {};

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
          _doAuth();
        } else {
          // Forward all other widget events to the parent callback
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
        var eth = global.ethereum;
        if (!eth) return Promise.resolve(null);
        return eth.request({ method: 'eth_accounts' }).then(function (accs) {
          return accs && accs.length ? accs[0] : null;
        });
      }

      function _signChallenge(account, challenge) {
        var eth = global.ethereum;
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

      // ── Widget handle ───────────────────────────────────────────────────────

      var handle = {
        /** Switch to a different mode without re-authenticating */
        setMode: function (newMode) {
          mode = newMode;
          _postToIframe({ type: 'SET_MODE', mode: newMode });
        },

        /** Request the agent to run a specific spell by slug */
        castSpell: function (spellSlug, inputs) {
          _postToIframe({ type: 'CAST_SPELL', spellSlug: spellSlug, inputs: inputs || {} });
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
  };

  global.StationThis = StationThis;
})(window);
