// src/api/widget/widgetApi.js
//
// Embeddable widget surface — served at /widget/*.
//
// Routes:
//   GET  /sdk.js                          — browser SDK (CORS: *)
//   GET  /lib/microact.esm.js            — microact ESM build for partner sites (CORS: *)
//   GET  /lib/micro-web3.esm.js          — micro-web3 ESM build for partner sites (CORS: *)
//   GET  /partner                        — partner widget iframe (StationThis.initWidget target)
//   GET   /gallery/:collectionAddress                      — collection gallery iframe
//   GET   /gallery/:collectionAddress/feed                 — gallery JSON feed (CORS: *)
//   PATCH /gallery/:collectionAddress/casts/:castId/hide   — hide cast from gallery (owner JWT)
//   PATCH /gallery/:collectionAddress/casts/:castId/unhide — unhide cast from gallery (owner JWT)
//   PATCH /gallery/:collectionAddress/casts/:castId/pin    — pin cast to top of gallery (owner JWT)
//   PATCH /gallery/:collectionAddress/casts/:castId/unpin  — unpin cast from gallery (owner JWT)
//   GET  /:agentId                        — iframe mini-app HTML shell
//   GET  /:agentId/workspace              — workspace + spells JSON (CORS: *)
//   POST /:agentId/spells/:slug/cast      — guest-safe cast via agent account (CORS: *)
//   GET  /:agentId/casts/:castId          — poll cast status (CORS: *)
//   POST /:agentId/auth/challenge         — public EIP-712 challenge relay (CORS: *)
//   POST /:agentId/auth/verify            — public verify + session JWT relay (CORS: *)
//   POST /:agentId/auth/wallet/nonce      — wallet auth: issue EIP-712 nonce (CORS: *)
//   POST /:agentId/auth/wallet/verify     — wallet auth: verify sig → session JWT (CORS: *)
//   GET  /:agentId/purchase-info          — on-chain purchase: vault addr + calldata (CORS: *)
//   POST /:agentId/session/x402          — pay-per-session USDC on Base → 24h JWT (CORS: *)
//   POST /:agentId/spells/:slug/x402     — pay-per-execution USDC on Base → cast result (CORS: *)
//   GET  /:agentId/session/tx-status     — poll on-chain tx confirmation (CORS: *)
//   GET  /:agentId/delegations            — list delegation links (owner session, CORS: *)
//   POST /:agentId/delegations            — create delegation link (owner session, CORS: *)
//   DELETE /:agentId/delegations/:delId   — revoke delegation link (owner session, CORS: *)

'use strict';

const fs      = require('fs');
const path    = require('path');
const express = require('express');
const jwt     = require('jsonwebtoken');

const { OnChainVerifier }  = require('../../core/services/agents/OnChainVerifier');
const { ChallengeService } = require('../../core/services/agents/ChallengeService');
const { VerifyService }    = require('../../core/services/agents/VerifyService');
const { DelegationService } = require('../../core/services/agents/DelegationService');
const { ethers } = require('ethers');
const { CREDIT_VAULT_ADDRESSES } = require('../../core/services/alchemy/foundationConfig');
const { decodePaymentSignatureHeader, encodePaymentRequiredHeader } = require('@x402/core/http');
const { HTTPFacilitatorClient } = require('@x402/core/server');
const { createFacilitatorConfig } = require('@coinbase/x402');
const { distributeAgentOwnerReward } = require('../../core/services/charging/agentOwnerReward');
const { USD_PER_POINT } = require('../../core/constants/economy');
const { economyService } = require('../../core/services/store/economy/EconomyService');

// ── x402 session constants ──────────────────────────────────────────────────────
const BASE_USDC_ADDRESS  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const X402_NETWORK       = 'eip155:8453';
const X402_SESSION_USDC  = '1000000'; // $1.00 USDC (6 decimals)
const X402_CAST_USDC     = process.env.X402_CAST_USDC || '100000'; // $0.10 default; override per-deploy

// Convert USDC atomic units (6 decimals) to Noema points
function usdcAtomicToPoints(atomicStr) {
    return Math.round(Number(atomicStr) / 1e6 / USD_PER_POINT);
}

// Lazy singleton — only created if CDP credentials are present
let _facilitatorClient = null;
function _getFacilitatorClient() {
    if (_facilitatorClient) return _facilitatorClient;
    const id  = process.env.CDP_API_KEY_ID;
    const sec = process.env.CDP_API_KEY_SECRET;
    if (!id || !sec) return null;
    _facilitatorClient = new HTTPFacilitatorClient(createFacilitatorConfig(id, sec));
    return _facilitatorClient;
}

const SDK_PATH             = path.join(__dirname, 'sdk.browser.js');
const WIDGET_BUY_POINTS    = path.join(__dirname, 'widgetBuyPoints.esm.js');
const FRONTEND_MODS        = path.join(__dirname, '../../platforms/web/frontend/node_modules');
const MICROACT_ESM         = path.join(FRONTEND_MODS, '@monygroupcorp/microact/dist/microact.esm.js');
const MICROWEB3_ESM        = path.join(FRONTEND_MODS, '@monygroupcorp/micro-web3/dist/micro-web3.esm.js');

// ── CORS helper ────────────────────────────────────────────────────────────────

function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Payment');
}

// ── Internal API helper ────────────────────────────────────────────────────────

async function _internalReq(method, path, body) {
    const key  = process.env.INTERNAL_API_KEY_API;
    const base = `http://localhost:${process.env.PORT || 4000}`;
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Internal-Client-Key': key },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(base + path, opts);
    const data = await resp.json().catch(() => ({}));
    return { status: resp.status, data };
}

// ── Iframe mini-app HTML ───────────────────────────────────────────────────────

function buildAppHtml(agentId, mode) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>StationThis Agent</title>
<script type="importmap">
{"imports":{"@monygroupcorp/microact":"/widget/lib/microact.esm.js"}}
</script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e8e8e8; height: 100vh; overflow: hidden; }
  #root { display: flex; flex-direction: column; height: 100vh; }
  #status { padding: 8px 12px; font-size: 11px; color: #666; border-bottom: 1px solid #1a1a1a; display: flex; align-items: center; gap: 8px; }
  #status-text { flex: 1; }
  #owner-toggle { font-size: 11px; color: #555; cursor: pointer; padding: 2px 8px; border: 1px solid #2a2a2a; border-radius: 4px; background: none; }
  #owner-toggle:hover { border-color: #444; color: #aaa; }
  #content { flex: 1; overflow: auto; padding: 16px; }
  .loading { color: #555; font-size: 13px; }
  .spell-item { padding: 10px 14px; border: 1px solid #222; border-radius: 6px; margin-bottom: 8px; }
  .spell-item-header { cursor: pointer; }
  .spell-item-header:hover .spell-name { color: #bbb; }
  .spell-name { font-size: 14px; font-weight: 500; }
  .spell-desc { font-size: 12px; color: #666; margin-top: 3px; }
  .spell-inputs { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .spell-input { background: #111; border: 1px solid #2a2a2a; border-radius: 4px; padding: 6px 10px; color: #e8e8e8; font-size: 12px; width: 100%; box-sizing: border-box; }
  .spell-input:focus { outline: none; border-color: #555; }
  .spell-input::placeholder { color: #444; }
  .spell-img-pick { position: relative; cursor: pointer; background: #111; border: 1px dashed #444; border-radius: 4px; height: 80px; display: flex; align-items: center; justify-content: center; color: #555; font-size: 12px; overflow: hidden; }
  .spell-img-pick:hover { border-color: #777; color: #aaa; }
  .spell-img-pick input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .spell-img-pick img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .spell-img-pick .pick-label { pointer-events: none; }
  .spell-img-uploading { opacity: .5; pointer-events: none; }
  .spell-cast { margin-top: 4px; padding: 6px 14px; background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 4px; color: #88a; font-size: 12px; cursor: pointer; align-self: flex-start; }
  .spell-cast:hover { background: #1e1e3a; border-color: #44f; color: #aac; }
  .spell-cast:disabled { opacity: .4; cursor: default; }
  .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .gallery-item { cursor: pointer; border-radius: 4px; overflow: hidden; }
  .gallery-item img { width: 100%; border-radius: 4px; display: block; transition: opacity .2s; }
  .gallery-item:hover img { opacity: .85; }
  /* app lightbox */
  #app-lb { display: none; position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,.92); align-items: center; justify-content: center; padding: 16px; }
  #app-lb.open { display: flex; }
  #app-lb img { max-width: 100%; max-height: 90vh; border-radius: 6px; object-fit: contain; box-shadow: 0 8px 40px rgba(0,0,0,.8); }
  #app-lb-close { position: absolute; top: 12px; right: 16px; font-size: 22px; color: #888; cursor: pointer; background: none; border: none; line-height: 1; }
  #app-lb-close:hover { color: #fff; }
  .canvas-note { color: #555; font-size: 13px; text-align: center; padding: 40px 20px; }
  .cast-state { text-align: center; padding: 40px 20px; }
  .cast-spinner { width: 22px; height: 22px; border: 2px solid #222; border-top-color: #88a; border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto 12px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .cast-msg { font-size: 13px; color: #666; }
  .cast-elapsed { font-size: 11px; color: #444; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .cast-result { padding: 4px; }
  .cast-result img { width: 100%; border-radius: 6px; display: block; }
  .cast-result .cast-text { font-size: 13px; color: #ccc; white-space: pre-wrap; padding: 8px; }
  .cast-back { margin-top: 10px; font-size: 11px; color: #555; cursor: pointer; text-decoration: underline; }
  .cast-back:hover { color: #aaa; }
  .cast-error { color: #f77; font-size: 13px; padding: 16px 8px; }
  .cast-error .cast-back { color: #855; }
  .cast-error .cast-back:hover { color: #a77; }
  #gallery-toggle { font-size: 11px; color: #555; cursor: pointer; padding: 2px 8px; border: 1px solid #2a2a2a; border-radius: 4px; background: none; }
  #gallery-toggle:hover { border-color: #444; color: #aaa; }
  /* entrance gate */
  .entrance { display: flex; flex-direction: column; gap: 0; }
  .entrance-gate { padding: 16px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid #141418; }
  .entrance-section-label { font-size: 10px; color: #444; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 5px; }
  .entrance-code-row { display: flex; gap: 6px; }
  .entrance-input { flex: 1; background: #111; border: 1px solid #2a2a2a; border-radius: 4px; padding: 8px 10px; color: #e8e8e8; font-size: 13px; font-family: monospace; letter-spacing: .06em; }
  .entrance-input:focus { outline: none; border-color: #555; }
  .entrance-input::placeholder { color: #333; letter-spacing: 0; }
  .entrance-submit { padding: 8px 16px; background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 4px; color: #88a; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .entrance-submit:hover { background: #1e1e3a; }
  .entrance-submit:disabled { opacity: .4; cursor: default; }
  .entrance-error { font-size: 11px; color: #f77; min-height: 14px; }
  .entrance-or { font-size: 11px; color: #2a2a2a; text-align: center; display: flex; align-items: center; gap: 10px; }
  .entrance-or::before, .entrance-or::after { content: ''; flex: 1; height: 1px; background: #181818; }
  .entrance-pay-row { display: flex; gap: 8px; }
  .entrance-pay-btn { flex: 1; padding: 9px 4px; background: #0c0c10; border: 1px solid #1a1a22; border-radius: 5px; color: #3a3a4a; font-size: 12px; cursor: pointer; text-align: center; transition: border-color .15s; }
  .entrance-pay-btn:hover { border-color: #2a2a3a; color: #555; }
  .entrance-pay-name { display: block; font-weight: 500; }
  .entrance-pay-soon { display: block; font-size: 10px; color: #252530; margin-top: 3px; }
  .ent-preview-section { padding: 14px 16px; border-bottom: 1px solid #111; }
  .ent-spell-locked { opacity: .55; position: relative; }
  .ent-lock-hint { font-size: 10px; color: #444; margin-top: 6px; }
  /* owner dashboard */
  .dash-section { margin-bottom: 20px; }
  .dash-title { font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
  .del-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #1e1e1e; border-radius: 6px; margin-bottom: 6px; }
  .del-label { flex: 1; font-size: 13px; }
  .del-meta { font-size: 11px; color: #555; white-space: nowrap; }
  .del-copy { font-size: 11px; padding: 3px 8px; border: 1px solid #2a2a2a; border-radius: 4px; background: none; color: #aaa; cursor: pointer; }
  .del-copy:hover { border-color: #555; }
  .del-revoke { font-size: 11px; padding: 3px 8px; border: 1px solid #3a1a1a; border-radius: 4px; background: none; color: #844; cursor: pointer; }
  .del-revoke:hover { border-color: #a33; color: #c66; }
  .create-form { display: flex; flex-direction: column; gap: 8px; }
  .create-form input { background: #111; border: 1px solid #2a2a2a; border-radius: 4px; padding: 6px 10px; color: #e8e8e8; font-size: 13px; }
  .create-form input:focus { outline: none; border-color: #444; }
  .create-form input::placeholder { color: #444; }
  .create-row { display: flex; gap: 8px; }
  .create-row input { flex: 1; }
  .btn-create { padding: 7px 16px; background: #1a2a1a; border: 1px solid #2a3a2a; border-radius: 4px; color: #6a6; font-size: 13px; cursor: pointer; }
  .btn-create:hover { background: #1e321e; border-color: #3a4a3a; }
  .btn-create:disabled { opacity: .4; cursor: default; }
  .copied { color: #6a6 !important; }
</style>
</head>
<body>
<div id="root">
  <div id="status">
    <span id="status-text">Connecting…</span>
  </div>
  <div id="content"><p class="loading">Waiting for authentication…</p></div>
</div>
<div id="app-lb">
  <button id="app-lb-close">✕</button>
  <img id="app-lb-img" src="" alt="">
</div>
<script>
(function() {
  'use strict';
  var AGENT_ID  = ${JSON.stringify(agentId)};
  var BASE_URL  = window.location.origin;
  var _mode     = ${JSON.stringify(mode)};
  var _jwt      = null;
  var _ws       = null;
  var _isOwner  = false;
  var _showingDash      = false;
  var _galleryToggleBtn = null;
  var _walletAddress    = null; // wallet connected on the host page

  var $statusText = document.getElementById('status-text');
  var $status     = document.getElementById('status');
  var $content    = document.getElementById('content');

  // ── App lightbox ──────────────────────────────────────────────────────────
  var $appLb    = document.getElementById('app-lb');
  var $appLbImg = document.getElementById('app-lb-img');
  function openAppLb(url) { $appLbImg.src = url; $appLb.classList.add('open'); }
  function closeAppLb() { $appLb.classList.remove('open'); $appLbImg.src = ''; }
  document.getElementById('app-lb-close').addEventListener('click', closeAppLb);
  $appLb.addEventListener('click', function(e) { if (e.target === $appLb) closeAppLb(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeAppLb(); });

  function setStatus(txt) { $statusText.textContent = txt; }
  function setContent(html) { $content.innerHTML = html; }

  function decodeJwtPayload(token) {
    try {
      var b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(b64));
    } catch(e) { return {}; }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  function _onAuthenticated(jwt) {
    _jwt = jwt;
    window._widgetJwt = jwt; // exposed for ESM module
    var payload = decodeJwtPayload(jwt);
    _isOwner = payload.tier === 'agent_owner';
    if (_isOwner) {
      setStatus('Owner');
      _addOwnerControls();
    } else {
      setStatus('Access granted');
    }
    loadWorkspace();
    _loadPointsChip();
  }

  function _loadPointsChip() {
    if (!_jwt) return;
    fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/bp/balance', {
      headers: { 'Authorization': 'Bearer ' + _jwt },
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var pts = Number(d.balance || 0);
      var chip = document.getElementById('pts-chip');
      if (!chip) {
        chip = document.createElement('button');
        chip.id = 'pts-chip';
        chip.style.cssText = 'font-size:11px;color:#88a;cursor:pointer;padding:2px 8px;border:1px solid #2a2a3a;border-radius:3px;background:none;flex-shrink:0;';
        chip.title = 'Buy more points';
        chip.addEventListener('click', function() { if (window._openBuyPoints) window._openBuyPoints(); });
        $status.appendChild(chip);
      }
      chip.textContent = pts.toLocaleString() + ' pts';
    })
    .catch(function() {});
  }

  // ── postMessage bridge ────────────────────────────────────────────────────
  window.addEventListener('message', function(evt) {
    var msg = evt.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'SESSION_READY') {
      _onAuthenticated(msg.sessionJwt);
    } else if (msg.type === 'AUTH_ERROR') {
      setStatus('Access required');
      showEntrance(); // auto-auth fallthrough — show clean gate
    } else if (msg.type === 'PAYMENT_HEADER') {
      // SDK signed an x402 payment — exchange it for a session JWT
      _redeemX402(msg.header);
    } else if (msg.type === 'TX_HASH') {
      // SDK submitted an on-chain tx — wait for confirmation then auth
      _awaitTxAuth(msg.txHash, msg.walletAddress);
    } else if (msg.type === 'WALLET_AVAILABLE') {
      _walletAddress = msg.address;
      _refreshEntranceWallet();
    } else if (msg.type === 'WALLET_DISCONNECTED') {
      _walletAddress = null;
      _refreshEntranceWallet();
    } else if (msg.type === 'WALLET_AUTH_ERROR') {
      showEntrance(msg.error || 'Wallet auth failed');
    } else if (msg.type === 'PAYMENT_ERROR') {
      showEntrance(msg.error || 'Payment failed');
    } else if (msg.type === 'TX_ERROR') {
      showEntrance(msg.error || 'Transaction failed');
    } else if (msg.type === 'SET_MODE') {
      _mode = msg.mode;
      if (!_isOwner && _ws) render(_ws);
    } else if (msg.type === 'CAST_SPELL') {
      castSpell(msg.spellSlug, msg.inputs);
    }
  });

  // Guest mode — skip auth (dev / embed-without-SDK)
  if (new URLSearchParams(window.location.search).get('guest') === '1') {
    setStatus('Guest');
    loadWorkspace();
  } else {
    showEntrance();
  }

  window.parent.postMessage({ type: 'WIDGET_READY' }, '*');

  // ── Entrance gate ─────────────────────────────────────────────────────────

  function _refreshEntranceWallet() {
    var btn = document.getElementById('ent-wallet');
    if (!btn) return;
    var nameEl = btn.querySelector('.entrance-pay-name');
    var hintEl = btn.querySelector('.entrance-pay-soon');
    if (_walletAddress) {
      nameEl.textContent = 'Sign in with Wallet';
      hintEl.textContent = _walletAddress.slice(0, 6) + '…' + _walletAddress.slice(-4);
    } else {
      nameEl.textContent = 'Connect Wallet';
      hintEl.textContent = 'sign in · or buy points on-chain';
    }
  }

  function showEntrance(errorMsg) {
    setStatus('Access required');
    setContent(
      '<div class="entrance">'
      + '<div class="entrance-gate">'
      +   '<div class="entrance-code-row">'
      +     '<input class="entrance-input" id="ent-code" placeholder="Enter invite code" autocomplete="off" spellcheck="false">'
      +     '<button class="entrance-submit" id="ent-submit">Enter</button>'
      +   '</div>'
      +   '<div class="entrance-error" id="ent-error">' + esc(errorMsg || '') + '</div>'
      +   '<div class="entrance-or">or</div>'
      +   '<button class="entrance-pay-btn" id="ent-wallet" style="width:100%">'
      +     '<span class="entrance-pay-name">Connect Wallet</span>'
      +     '<span class="entrance-pay-soon">sign in · or buy points on-chain</span>'
      +   '</button>'
      +   '<div class="entrance-or">or pay direct</div>'
      +   '<div class="entrance-pay-row">'
      +     '<button class="entrance-pay-btn" id="ent-x402">'
      +       '<span class="entrance-pay-name">Pay USDC</span>'
      +       '<span class="entrance-pay-soon">$1 · Base · instant</span>'
      +     '</button>'
      +     '<button class="entrance-pay-btn" id="ent-tx">'
      +       '<span class="entrance-pay-name">Buy Points</span>'
      +       '<span class="entrance-pay-soon">ETH · CAMEL · more</span>'
      +     '</button>'
      +   '</div>'
      + '</div>'
      + '<div id="ent-preview"></div>'
      + '</div>'
    );

    var codeInput  = document.getElementById('ent-code');
    var submitBtn  = document.getElementById('ent-submit');
    var errorEl    = document.getElementById('ent-error');

    function doRedeem() {
      var code = codeInput.value.trim();
      if (!code) return;
      submitBtn.disabled = true;
      submitBtn.textContent = '…';
      errorEl.textContent = '';
      fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/auth/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: code }),
      })
      .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(resp) {
        if (!resp.ok) {
          errorEl.textContent = resp.data?.error?.message || 'Invalid code';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enter';
          return;
        }
        _onAuthenticated(resp.data.sessionJwt);
      })
      .catch(function(err) {
        errorEl.textContent = err.message;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enter';
      });
    }

    submitBtn.addEventListener('click', doRedeem);
    codeInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') doRedeem(); });

    document.getElementById('ent-wallet').addEventListener('click', function() {
      var btn = document.getElementById('ent-wallet');
      btn.disabled = true;
      var nameEl = btn.querySelector('.entrance-pay-name');
      var hintEl = btn.querySelector('.entrance-pay-soon');
      if (_walletAddress) {
        nameEl.textContent = 'Signing…';
        hintEl.textContent = 'check your wallet';
      } else {
        nameEl.textContent = 'Connecting…';
        hintEl.textContent = 'check your wallet';
      }
      window.parent.postMessage({ type: 'WALLET_AUTH_REQUEST', agentId: AGENT_ID }, '*');
    });
    document.getElementById('ent-x402').addEventListener('click', function() {
      var btn = document.getElementById('ent-x402');
      btn.disabled = true;
      btn.querySelector('.entrance-pay-name').textContent = 'Confirm in wallet…';
      btn.querySelector('.entrance-pay-soon').textContent = 'signing $1 USDC';
      window.parent.postMessage({ type: 'PAYMENT_REQUIRED', agentId: AGENT_ID }, '*');
    });
    document.getElementById('ent-tx').addEventListener('click', function() {
      if (window._openBuyPoints) { window._openBuyPoints(); }
      else { window.parent.postMessage({ type: 'TX_REQUEST', agentId: AGENT_ID }, '*'); }
    });

    // Reflect current host-page wallet state immediately
    _refreshEntranceWallet();

    // Fetch workspace for preview (no auth required)
    fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/workspace')
      .then(function(r) { return r.json(); })
      .then(function(ws) {
        var preview = document.getElementById('ent-preview');
        if (!preview) return;
        var html = '';

        // Gallery preview only — no spell preview on entrance
        var outputs = ws.recentOutputs || [];
        if (outputs.length) {
          html += '<div class="ent-preview-section">'
            + '<div class="entrance-section-label">Recent outputs</div>'
            + '<div class="gallery-grid">';
          outputs.forEach(function(o) {
            html += '<div class="gallery-item"><img src="' + esc(o.url) + '" loading="lazy"></div>';
          });
          html += '</div></div>';
        }

        preview.innerHTML = html;
      })
      .catch(function() { /* preview is best-effort */ });
  }

  function _redeemX402(paymentHeader) {
    fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/session/x402', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Payment': paymentHeader },
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
    .then(function(resp) {
      if (!resp.ok) { showEntrance(resp.data?.error?.message || 'Payment session failed'); return; }
      _onAuthenticated(resp.data.sessionJwt);
    })
    .catch(function(err) { showEntrance(err.message); });
  }

  function _awaitTxAuth(txHash, walletAddress) {
    // Tx is on-chain — poll for confirmation then trigger wallet auth
    setContent('<div class="cast-state"><div class="cast-spinner"></div><div class="cast-msg">Waiting for tx…<br><span style="font-size:10px;color:#444;word-break:break-all">' + esc(txHash) + '</span></div></div>');
    var attempts = 0;
    function poll() {
      if (attempts++ > 60) { showEntrance('Tx confirmation timed out'); return; }
      setTimeout(function() {
        fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/session/tx-status?tx=' + encodeURIComponent(txHash))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.status === 'confirmed') { _onAuthenticated(d.sessionJwt); }
          else if (d.status === 'failed') { showEntrance('Transaction failed on-chain'); }
          else { poll(); }
        })
        .catch(function() { poll(); });
      }, 5000);
    }
    poll();
  }

  // ── Owner controls (link back to Noema + delegations button) ─────────────
  function _addOwnerControls() {
    // Noema management link
    var link = document.createElement('a');
    link.id = 'owner-noema-link';
    link.textContent = 'Manage ↗';
    link.href = BASE_URL;
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'font-size:11px;color:#88a;text-decoration:none;padding:2px 8px;border:1px solid #2a2a3a;border-radius:4px;white-space:nowrap;flex-shrink:0;';
    $status.appendChild(link);

    // Delegations toggle
    var btn = document.createElement('button');
    btn.id = 'owner-toggle';
    btn.textContent = 'Links';
    btn.addEventListener('click', function() {
      _showingDash = !_showingDash;
      btn.textContent = _showingDash ? 'Spells' : 'Links';
      if (_showingDash) { loadOwnerDashboard(); } else { loadWorkspace(); }
    });
    $status.appendChild(btn);
  }

  // ── Owner dashboard ───────────────────────────────────────────────────────
  function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _jwt };
  }

  function delegationBase() {
    return BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/delegations';
  }

  function loadOwnerDashboard() {
    _showingDash = true;
    setContent('<p class="loading">Loading delegations…</p>');
    fetch(delegationBase(), { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(data) { renderOwnerDashboard(data.delegations || []); })
      .catch(function(err) { setContent('<p class="loading">Failed to load delegations: ' + err.message + '</p>'); });
  }

  function renderOwnerDashboard(delegations) {
    var now = Date.now();
    var rows = delegations.length
      ? delegations.map(function(d) {
          var expired = d.expiresAt && new Date(d.expiresAt) < now;
          var cap = d.spendCapPoints != null
            ? (d.pointsSpent || 0) + ' / ' + d.spendCapPoints + ' pts'
            : 'no cap';
          var shareUrl = BASE_URL + '/join/' + encodeURIComponent(AGENT_ID) + '/' + d.token;
          return '<div class="del-row" data-id="' + esc(String(d._id)) + '">'
            + '<span class="del-label">' + esc(d.label || 'Unnamed link') + (expired ? ' <span style="color:#844">(expired)</span>' : '') + '</span>'
            + '<span class="del-meta">' + esc(cap) + '</span>'
            + '<button class="del-copy" data-url="' + esc(shareUrl) + '">Copy</button>'
            + '<button class="del-revoke">Revoke</button>'
            + '</div>';
        }).join('')
      : '<p class="loading" style="margin-bottom:16px">No delegation links yet.</p>';

    var html = '<div class="dash-section">'
      + '<div class="dash-title">Delegation Links</div>'
      + rows
      + '</div>'
      + '<div class="dash-section">'
      + '<div class="dash-title">Create Link</div>'
      + '<div class="create-form">'
      + '<input id="del-label" placeholder="Label (e.g. Friends &amp; family)">'
      + '<div class="create-row">'
      + '<input id="del-cap" type="number" min="0" placeholder="Spend cap (points, optional)">'
      + '<input id="del-exp" type="number" min="1" placeholder="Expires in hours (optional)">'
      + '</div>'
      + '<button class="btn-create" id="btn-create">Create link</button>'
      + '</div>'
      + '</div>';

    setContent(html);

    // Copy buttons
    $content.querySelectorAll('.del-copy').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var url = btn.dataset.url;
        navigator.clipboard.writeText(url).then(function() {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
        });
      });
    });

    // Revoke buttons
    $content.querySelectorAll('.del-revoke').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.closest('.del-row').dataset.id;
        btn.disabled = true;
        btn.textContent = '…';
        fetch(delegationBase() + '/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: authHeaders(),
        })
        .then(function() { loadOwnerDashboard(); })
        .catch(function() { btn.disabled = false; btn.textContent = 'Revoke'; });
      });
    });

    // Create form
    var btnCreate = document.getElementById('btn-create');
    btnCreate.addEventListener('click', function() {
      var label = document.getElementById('del-label').value.trim() || null;
      var cap   = document.getElementById('del-cap').value;
      var exp   = document.getElementById('del-exp').value;
      btnCreate.disabled = true;
      btnCreate.textContent = 'Creating…';
      fetch(delegationBase(), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          label: label,
          spendCapPoints:  cap  ? parseInt(cap, 10)  : null,
          expiresInHours:  exp  ? parseInt(exp, 10)  : null,
        }),
      })
      .then(function(r) { return r.json(); })
      .then(function() { loadOwnerDashboard(); })
      .catch(function() { btnCreate.disabled = false; btnCreate.textContent = 'Create link'; });
    });
  }

  // ── Workspace loading ─────────────────────────────────────────────────────
  function _addGalleryToggle() {
    if (_galleryToggleBtn) return;
    var btn = document.createElement('button');
    btn.id = 'gallery-toggle';
    btn.textContent = 'Gallery';
    btn.addEventListener('click', function() {
      if (_mode === 'gallery') {
        goBack();
      } else {
        _mode = 'gallery';
        btn.textContent = 'Spells';
        loadWorkspace();
      }
    });
    $status.appendChild(btn);
    _galleryToggleBtn = btn;
  }

  function loadWorkspace() {
    _showingDash = false;
    setContent('<p class="loading">Loading workspace…</p>');
    fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/workspace', {
      headers: _jwt ? { 'Authorization': 'Bearer ' + _jwt } : {},
    })
    .then(function(r) { return r.json(); })
    .then(function(data) { _ws = data; _addGalleryToggle(); render(_ws); })
    .catch(function(err) { setContent('<p class="loading">Failed to load workspace: ' + err.message + '</p>'); });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function render(ws) {
    if (_mode === 'gallery') return renderGallery(ws);
    if (_mode === 'canvas')  return renderCanvas(ws);
    return renderList(ws);
  }

  function _buildGalleryStrip(ws) {
    var outputs = ws.recentOutputs || [];
    if (!outputs.length) return '';
    return '<div class="gallery-grid" style="margin-bottom:12px">'
      + outputs.map(function(o) {
          return '<div class="gallery-item" data-url="' + esc(o.url) + '"><img src="' + esc(o.url) + '" loading="lazy"></div>';
        }).join('')
      + '</div>';
  }

  function renderList(ws) {
    var spells = ws.spells || [];
    var galleryHtml = _buildGalleryStrip(ws);
    if (!spells.length) {
      var msg = _isOwner
        ? '<p class="loading">No spells in this workspace yet.<br><a href="' + BASE_URL + '" target="_blank" rel="noopener" style="color:#88a">Configure on Noema ↗</a></p>'
        : '<p class="loading">No spells configured yet.</p>';
      setContent(galleryHtml + msg);
      // Wire gallery clicks even on empty-spell view
      $content.querySelectorAll('.gallery-item').forEach(function(el) {
        el.addEventListener('click', function() { openAppLb(el.dataset.url); });
      });
      return;
    }
    var html = galleryHtml + spells.map(function(s) {
      var inputs = s.exposedInputs || [];
      var inputsHtml = inputs.map(function(inp) {
        if (inp.type === 'image') {
          return '<div class="spell-img-pick" data-key="' + esc(inp.paramKey) + '" data-url="">'
            + '<input type="file" accept="image/*">'
            + '<span class="pick-label">📷 ' + esc(inp.label || inp.paramKey) + '</span>'
            + '</div>';
        }
        return '<input class="spell-input" data-key="' + esc(inp.paramKey) + '"'
          + ' placeholder="' + esc(inp.label || inp.paramKey) + '"'
          + (inp.defaultValue ? ' value="' + esc(inp.defaultValue) + '"' : '')
          + '>';
      }).join('');
      return '<div class="spell-item" data-slug="' + esc(s.slug) + '">'
        + '<div class="spell-item-header">'
        + '<div class="spell-name">' + esc(s.name) + '</div>'
        + (s.description ? '<div class="spell-desc">' + esc(s.description) + '</div>' : '')
        + '</div>'
        + '<div class="spell-inputs">' + inputsHtml + '<button class="spell-cast">Cast</button></div>'
        + '</div>';
    }).join('');
    setContent(html);
    $content.querySelectorAll('.gallery-item').forEach(function(el) {
      el.addEventListener('click', function() { openAppLb(el.dataset.url); });
    });
    $content.querySelectorAll('.spell-item').forEach(function(el) {
      var slug = el.dataset.slug;
      var castBtn = el.querySelector('.spell-cast');

      // Wire image pickers: on file select, upload and store URL
      el.querySelectorAll('.spell-img-pick').forEach(function(picker) {
        var fileInput = picker.querySelector('input[type=file]');
        fileInput.addEventListener('change', function() {
          var file = fileInput.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(e) {
            var b64 = e.target.result.split(',')[1];
            picker.classList.add('spell-img-uploading');
            fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: b64, contentType: file.type, fileName: file.name }),
            })
            .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
            .then(function(resp) {
              picker.classList.remove('spell-img-uploading');
              if (resp.ok && resp.data.url) {
                picker.dataset.url = resp.data.url;
                var label = picker.querySelector('.pick-label');
                if (label) label.textContent = '';
                var prev = picker.querySelector('img');
                if (!prev) { prev = document.createElement('img'); picker.appendChild(prev); }
                prev.src = resp.data.url;
              } else {
                var errMsg = resp.status === 413
                  ? 'Image too large (max ~8 MB)'
                  : (resp.data?.error?.message || 'Upload failed');
                var label = picker.querySelector('.pick-label');
                if (label) { label.textContent = '⚠ ' + errMsg; label.style.color = '#f87'; }
                picker.dataset.url = '';
              }
            })
            .catch(function(err) {
              picker.classList.remove('spell-img-uploading');
              var label = picker.querySelector('.pick-label');
              if (label) { label.textContent = '⚠ Upload failed'; label.style.color = '#f87'; }
            });
          };
          reader.readAsDataURL(file);
        });
      });

      castBtn.addEventListener('click', function() {
        var inputs = {};
        el.querySelectorAll('.spell-input').forEach(function(inp) {
          inputs[inp.dataset.key] = inp.value;
        });
        el.querySelectorAll('.spell-img-pick').forEach(function(picker) {
          if (picker.dataset.url) inputs[picker.dataset.key] = picker.dataset.url;
        });
        castBtn.disabled = true;
        castBtn.textContent = 'Casting…';
        castSpell(slug, inputs);
      });
    });
  }

  function renderGallery(ws) {
    var outputs = ws.recentOutputs || [];
    if (!outputs.length) {
      setContent('<p class="loading" style="text-align:center;padding:40px 20px">No outputs yet — cast a spell to see results here.</p>');
      return;
    }
    var html = '<div class="gallery-grid">'
      + outputs.map(function(o) {
          return '<div class="gallery-item" data-url="' + esc(o.url) + '"><img src="' + esc(o.url) + '" loading="lazy"></div>';
        }).join('')
      + '</div>';
    setContent(html);
    $content.querySelectorAll('.gallery-item').forEach(function(el) {
      el.addEventListener('click', function() { openAppLb(el.dataset.url); });
    });
  }

  function renderCanvas(ws) {
    // Canvas mode is driven by the host page via postMessage; fall through to list for standalone use.
    window.parent.postMessage({ type: 'WORKSPACE_LOADED', workspace: ws }, '*');
    renderList(ws);
  }

  // ── Spell execution ───────────────────────────────────────────────────────
  function castSpell(slug, inputs) {
    window.parent.postMessage({ type: 'SPELL_STARTED', spellSlug: slug }, '*');
    setContent('<div class="cast-state"><div class="cast-spinner"></div><div class="cast-msg">Casting…</div><div class="cast-elapsed"></div></div>');

    fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/spells/' + encodeURIComponent(slug) + '/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: inputs }),
    })
    .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, status: r.status, data: d }; }); })
    .then(function(resp) {
      if (!resp.ok) {
        showCastError(resp.data?.error?.message || resp.data?.message || ('Error ' + resp.status));
        return;
      }
      var castId = resp.data.castId;
      if (!castId) { showCastResult(resp.data); return; }
      pollCast(castId, 0, Date.now());
    })
    .catch(function(err) { showCastError(err.message); });
  }

  function pollCast(castId, attempts, startedAt) {
    if (attempts > 60) { showCastError('Timed out waiting for result.'); return; }
    setTimeout(function() {
      fetch(BASE_URL + '/widget/' + encodeURIComponent(AGENT_ID) + '/casts/' + encodeURIComponent(castId))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.status === 'completed') { showCastResult(d); return; }
        if (d.status === 'failed') { showCastError(d.failureReason || 'Generation failed.'); return; }

        // Update step progress and elapsed time while pending/running
        var steps = (d.stepGenerationIds || []).length;
        var elapsed = Math.floor((Date.now() - startedAt) / 1000);
        var mins = Math.floor(elapsed / 60);
        var secs = elapsed % 60;
        var elapsedStr = mins > 0
          ? mins + 'm ' + secs + 's'
          : secs + 's';
        var msgEl = document.querySelector('.cast-msg');
        var elapsedEl = document.querySelector('.cast-elapsed');
        if (msgEl) msgEl.textContent = steps > 0 ? 'Step ' + steps + ' complete…' : 'Running…';
        if (elapsedEl) elapsedEl.textContent = elapsedStr;

        pollCast(castId, attempts + 1, startedAt);
      })
      .catch(function(err) { showCastError(err.message); });
    }, 2000);
  }

  function goBack() {
    _mode = 'list';
    if (_galleryToggleBtn) _galleryToggleBtn.textContent = 'Gallery';
    loadWorkspace(); // reload so completed casts appear in gallery strip
  }

  function showCastResult(data) {
    var out = data.output || data.result;
    var imgUrl = (out && out.url) || (out && out.type === 'image' && out.url);
    var textVal = (out && out.type === 'text' && out.value)
               || (typeof out === 'string' && out);
    var html;
    if (imgUrl) {
      html = '<div class="cast-result"><img src="' + esc(imgUrl) + '" alt="Result" style="cursor:zoom-in;" data-url="' + esc(imgUrl) + '">'
           + '<div class="cast-back">← Back</div></div>';
    } else if (textVal) {
      html = '<div class="cast-result"><div class="cast-text">' + esc(textVal) + '</div>'
           + '<div class="cast-back">← Back</div></div>';
    } else {
      var raw = typeof out === 'string' ? out : JSON.stringify(out || data, null, 2);
      html = '<div class="cast-result"><div class="cast-text">' + esc(raw) + '</div>'
           + '<div class="cast-back">← Back</div></div>';
    }
    setContent(html);
    var back = $content.querySelector('.cast-back');
    if (back) back.addEventListener('click', goBack);
    var resImg = $content.querySelector('img[data-url]');
    if (resImg) resImg.addEventListener('click', function() { openAppLb(resImg.dataset.url); });
    window.parent.postMessage({ type: 'SPELL_CAST', result: data }, '*');
  }

  function showCastError(msg) {
    setContent('<div class="cast-error">⚠ ' + esc(msg)
      + '<div class="cast-back">← Back</div></div>');
    var back = $content.querySelector('.cast-back');
    if (back) back.addEventListener('click', goBack);
    window.parent.postMessage({ type: 'SPELL_ERROR', error: msg }, '*');
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
})();
</script>
<script type="module">
import { openBuyPointsModal } from '/widget/lib/widget-buy-points.esm.js';
var _agentId = ${JSON.stringify(agentId)};
window._openBuyPoints = function() {
  openBuyPointsModal({
    apiBase:     '/widget/' + encodeURIComponent(_agentId) + '/bp',
    getJwt:      function() { return window._widgetJwt || null; },
    getProvider: function() { return window.ethereum || null; },
  });
};
</script>
</body>
</html>`;
}

function buildGalleryHtml(collectionAddress) {
    const escapedAddr = JSON.stringify(collectionAddress);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gallery</title>
<style>
  :root {
    --bg:          #0a0a0a;
    --card-bg:     #141414;
    --card-radius: 8px;
    --accent:      #8888aa;
    --text:        #e0e0e0;
    --text-dim:    #777;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; min-height: 100%; }
  body { padding: 14px; }

  #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }

  .card {
    position: relative; border-radius: var(--card-radius); overflow: hidden;
    background: var(--card-bg); cursor: pointer;
    transition: transform .18s ease, box-shadow .18s ease;
  }
  .card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,.55); }

  .card img {
    display: block; width: 100%; aspect-ratio: 1; object-fit: cover;
    opacity: 0; transition: opacity .35s ease;
  }
  .card img.loaded { opacity: 1; }

  /* shimmer skeleton */
  .card .skel {
    position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(90deg, var(--card-bg) 0%, #252528 50%, var(--card-bg) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  .card img.loaded ~ .skel { display: none; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* meta overlay */
  .card .meta {
    position: absolute; bottom: 0; left: 0; right: 0; padding: 28px 8px 7px;
    background: linear-gradient(transparent, rgba(0,0,0,.88));
    font-size: 10px; color: var(--text);
    opacity: 0; transition: opacity .2s;
    pointer-events: none;
  }
  .card:hover .meta { opacity: 1; }
  .meta .agent { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta .time  { color: var(--text-dim); margin-top: 2px; }

  /* delete button */
  .card .del-btn {
    position: absolute; top: 6px; right: 6px; z-index: 5;
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(180,30,30,.9); border: 1px solid rgba(255,80,80,.3);
    color: #fff; font-size: 11px; line-height: 1; cursor: pointer;
    display: none; align-items: center; justify-content: center;
    opacity: 0; transition: opacity .15s;
  }
  .card:hover .del-btn { opacity: 1; }
  body.has-owner .card .del-btn { display: flex; }

  #empty { display: none; padding: 60px 20px; text-align: center; color: var(--text-dim); font-size: 14px; }

  /* lightbox */
  #lb {
    display: none; position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,.93); align-items: center; justify-content: center;
    padding: 20px;
  }
  #lb.open { display: flex; }
  #lb-img {
    max-width: min(900px, 100%); max-height: 90vh;
    border-radius: 6px; object-fit: contain;
    box-shadow: 0 12px 60px rgba(0,0,0,.8);
  }
  #lb-close {
    position: absolute; top: 14px; right: 18px;
    font-size: 22px; color: #888; cursor: pointer;
    background: none; border: none; line-height: 1;
    transition: color .15s;
  }
  #lb-close:hover { color: #fff; }
  #lb-meta {
    position: absolute; bottom: 18px; left: 0; right: 0;
    text-align: center; font-size: 11px; color: #666;
    pointer-events: none;
  }
</style>
</head>
<body>
<div id="grid"></div>
<div id="empty">No outputs yet.</div>
<div id="lb">
  <button id="lb-close">✕</button>
  <img id="lb-img" src="" alt="">
  <div id="lb-meta"></div>
</div>
<script>
(function () {
  var COLLECTION = ${escapedAddr};
  var BASE       = location.origin;
  var FEED_URL   = BASE + '/widget/gallery/' + encodeURIComponent(COLLECTION) + '/feed';

  // Apply CSS overrides and read owner JWT from URL params
  var params = new URLSearchParams(location.search);
  var ownerJwt = params.get('ownerJwt') || null;
  var cssMap = { bg: '--bg', 'card-bg': '--card-bg', 'card-radius': '--card-radius', accent: '--accent', text: '--text', 'text-dim': '--text-dim' };
  Object.keys(cssMap).forEach(function (k) {
    var v = params.get(k);
    if (v) document.documentElement.style.setProperty(cssMap[k], decodeURIComponent(v));
  });
  if (ownerJwt) document.body.classList.add('has-owner');

  var grid   = document.getElementById('grid');
  var empty  = document.getElementById('empty');
  var lb     = document.getElementById('lb');
  var lbImg  = document.getElementById('lb-img');
  var lbMeta = document.getElementById('lb-meta');
  var _seen  = {};

  function timeAgo(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60)    return 'just now';
    if (d < 3600)  return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Lightbox — prefer postMessage to parent (works regardless of iframe size/overflow)
  // Falls back to in-iframe overlay when opened standalone (no parent SDK)
  function openLb(url, label) {
    // Always try postMessage first — parent SDK creates full-page overlay
    window.parent.postMessage({ type: 'GALLERY_LIGHTBOX', url: url, label: label || '' }, '*');
    // In-iframe fallback: also show local overlay (SDK listener will suppress if it handles it)
    lbImg.src = url;
    lbMeta.textContent = label || '';
    lb.classList.add('open');
  }
  function closeLb() { lb.classList.remove('open'); lbImg.src = ''; }

  document.getElementById('lb-close').addEventListener('click', closeLb);
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); });
  // Listen for parent-initiated close
  window.addEventListener('message', function (e) { if (e.data && e.data.type === 'GALLERY_LIGHTBOX_CLOSE') closeLb(); });

  // Hide action
  function doHide(castId, card) {
    fetch(BASE + '/widget/gallery/' + encodeURIComponent(COLLECTION) + '/casts/' + encodeURIComponent(castId) + '/hide', {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + ownerJwt },
    }).then(function (r) {
      if (!r.ok) return;
      card.style.transition = 'opacity .25s, transform .25s';
      card.style.opacity = '0';
      card.style.transform = 'scale(.88)';
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 260);
      delete _seen[castId];
    }).catch(function () {});
  }

  function makeCard(it) {
    var card = document.createElement('div');
    card.className = 'card';

    var img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    var _t0 = Date.now();
    function _reveal() {
      var wait = Math.max(0, 600 - (Date.now() - _t0));
      setTimeout(function () { img.classList.add('loaded'); }, wait);
    }
    img.addEventListener('load',  _reveal);
    img.addEventListener('error', function () { img.classList.add('loaded'); });
    img.src = it.url;

    var skel = document.createElement('div');
    skel.className = 'skel';

    var meta = document.createElement('div');
    meta.className = 'meta';
    var label = (it.agentName || it.agentId || '');
    var ago   = timeAgo(it.updatedAt);
    meta.innerHTML = '<div class="agent">' + esc(label) + '</div><div class="time">' + esc(ago) + '</div>';

    card.appendChild(img);
    card.appendChild(skel);
    card.appendChild(meta);

    if (ownerJwt) {
      var del = document.createElement('button');
      del.className = 'del-btn';
      del.textContent = '✕';
      del.title = 'Hide from gallery';
      del.addEventListener('click', function (e) { e.stopPropagation(); doHide(it.castId, card); });
      card.appendChild(del);
    }

    card.addEventListener('click', function () {
      openLb(it.url, label + (label && ago ? '  ·  ' : '') + ago);
    });

    return card;
  }

  function render(items) {
    if (!items.length && !Object.keys(_seen).length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    var frag = document.createDocumentFragment();
    var hasNew = false;
    items.forEach(function (it) {
      if (_seen[it.castId]) return;
      _seen[it.castId] = true;
      hasNew = true;
      frag.appendChild(makeCard(it));
    });
    if (hasNew) grid.insertBefore(frag, grid.firstChild);
  }

  function load() {
    fetch(FEED_URL)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) { render(d.items || []); })
      .catch(function () {});
  }

  load();
  setInterval(load, 20000);
})();
</script>
</body>
</html>`;
}

// ── Partner iframe HTML ────────────────────────────────────────────────────────

function buildPartnerHtml(partnerId) {
    const escapedId = JSON.stringify(partnerId);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Noema Partner</title>
<style>
  :root {
    --bg:       #0a0a0a;
    --text:     #e0e0e0;
    --text-dim: #777;
    --accent:   #8888aa;
    --border:   #1e1e1e;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; min-height: 100%; }
  body { padding: 20px; display: flex; flex-direction: column; min-height: 100vh; }
  #partner-root { flex: 1; display: flex; flex-direction: column; }
  .partner-placeholder { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 40px 20px; text-align: center; }
  .partner-placeholder-label { font-size: 13px; color: var(--text-dim); }
  .partner-placeholder-id { font-size: 11px; color: var(--border); font-family: monospace; }
  .partner-footer { font-size: 10px; color: var(--border); text-align: center; padding-top: 12px; border-top: 1px solid var(--border); }
  .partner-footer a { color: var(--accent); text-decoration: none; }
  .partner-footer a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="partner-root">
  <div class="partner-placeholder">
    <div class="partner-placeholder-label">Powered by Noema</div>
    <div class="partner-placeholder-id" id="partner-id-display"></div>
  </div>
  <div class="partner-footer">
    <a href="https://noema.so" target="_blank" rel="noopener">noema.so</a>
  </div>
</div>
<script>
(function () {
  'use strict';
  var PARTNER_ID = ${escapedId};

  // Apply CSS custom-property overrides from query params (same convention as gallery)
  var params = new URLSearchParams(location.search);
  var cssMap = { bg: '--bg', text: '--text', 'text-dim': '--text-dim', accent: '--accent', border: '--border' };
  Object.keys(cssMap).forEach(function (k) {
    var v = params.get(k);
    if (v) document.documentElement.style.setProperty(cssMap[k], decodeURIComponent(v));
  });

  // Display partner id as lightweight confirmation the iframe loaded
  var el = document.getElementById('partner-id-display');
  if (el) el.textContent = PARTNER_ID;

  // Notify parent frame that the partner widget is ready
  window.parent.postMessage({ type: 'PARTNER_READY', partnerId: PARTNER_ID }, '*');
})();
</script>
</body>
</html>`;
}

// ── Router factory ─────────────────────────────────────────────────────────────

/**
 * @param {{ db, logger }} deps
 * @returns {express.Router}
 */
function createWidgetApi(deps = {}) {
    const router = express.Router();
    const logger = deps.logger || console;

    // Shared auth services (one instance per router, in-memory state)
    const onChainVerifier = new OnChainVerifier({ logger });
    const challengeService = new ChallengeService();
    const verifySvc = new VerifyService({ challengeService, onChainVerifier, logger });

    const delegationSvc = new DelegationService({
        delegationsDb: deps.db?.agentDelegations,
        userCoreDb:    deps.db?.userCore,
        logger,
    });

    // In-memory wallet auth nonce store — nonce → { address, domain, types, message, expiresAt }
    const _walletNonces = new Map();

    // Allow CORS preflight for all widget routes
    router.options('*', (req, res) => { cors(res); res.sendStatus(204); });

    // ── SDK ──────────────────────────────────────────────────────────────────

    router.get('/sdk.js', (req, res) => {
        cors(res);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.sendFile(SDK_PATH);
    });

    // Serve ESM builds of micro-web3 and microact for embedding on partner sites
    router.get('/lib/microact.esm.js', (req, res) => {
        cors(res);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.sendFile(MICROACT_ESM);
    });

    router.get('/lib/micro-web3.esm.js', (req, res) => {
        cors(res);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.sendFile(MICROWEB3_ESM);
    });

    router.get('/lib/widget-buy-points.esm.js', (req, res) => {
        cors(res);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(WIDGET_BUY_POINTS);
    });

    // ── Helper ───────────────────────────────────────────────────────────────

    async function findAgent(agentId) {
        const legacyDoc = await deps.db?.userCore?.findByAgentId(agentId).catch(() => null);
        if (legacyDoc) return legacyDoc;

        if (!deps.db?.agentAccount) return null;
        const provDoc = await deps.db.agentAccount.findByAgentId(agentId).catch(() => null);
        if (!provDoc || provDoc.status !== 'active') return null;

        const { ObjectId: OID } = require('mongodb');
        return {
            _id: OID.isValid(provDoc.noemaAccountId) ? new OID(provDoc.noemaAccountId) : provDoc.noemaAccountId,
            agentId:              provDoc.agentId,
            agentChainId:         provDoc.agentChainId || null,
            agentAdapter:         provDoc.agentAdapter || null,
            agentTokenId:         provDoc.tokenId || null,
            agentCollection:      null,
            agentOwnerAddress:    provDoc.ownerAddress || null,
            starterWorkspaceSlug: provDoc.workspaceSlug,
            displayName:          provDoc.tokenId ? `Agent #${provDoc.tokenId}` : provDoc.agentId,
            scope:                provDoc.scope || [],
            _provisionedDoc:      provDoc,
        };
    }

    async function _verifyGalleryOwner(payload, addr) {
        if (deps.db?.userCore) {
            const doc = await deps.db.userCore.findByAgentId(payload.sub).catch(() => null);
            if (doc && (doc.agentCollection || '').toLowerCase() === addr) return true;
        }
        if (deps.db?.agentAccount) {
            const doc = await deps.db.agentAccount.findByAgentId(payload.sub).catch(() => null);
            if (doc && doc.status === 'active' && (doc.agentAdapter || '').toLowerCase() === addr) return true;
        }
        return false;
    }

    function handleErr(res, err, label) {
        logger.error(`[WidgetApi] ${label}: ${err.message}`);
        const map = {
            NOT_FOUND: 404, INVALID_PARAMS: 400, FORBIDDEN: 403,
            CHALLENGE_NOT_FOUND: 400, CHALLENGE_EXPIRED: 400, INVALID_NONCE: 400,
            INVALID_SIGNATURE: 400, OWNERSHIP_MISMATCH: 403, CONFIG_ERROR: 500,
        };
        res.status(map[err.code] || 500).json({ error: { code: err.code || 'INTERNAL_ERROR', message: err.message } });
    }

    // ── Owner session guard ───────────────────────────────────────────────────
    // Verifies the Bearer JWT is a valid agent_owner session for this agentId.

    function requireOwner(req, res, agentId) {
        const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
        if (!secret) { res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } }); return null; }
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        if (!token) { res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } }); return null; }
        try {
            const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
            if (payload.tier !== 'agent_owner') { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner session required' } }); return null; }
            if (payload.sub !== agentId) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Session does not match this agent' } }); return null; }
            return payload;
        } catch {
            res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired session' } });
            return null;
        }
    }

    // ── Auth relay ───────────────────────────────────────────────────────────

    // Redeem a delegation code (opaque token from owner dashboard)
    router.post('/:agentId/auth/redeem', async (req, res) => {
        cors(res);
        try {
            const { token } = req.body || {};
            if (!token) return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'token is required' } });
            const result = await delegationSvc.redeem(req.params.agentId, token);
            res.json({ sessionJwt: result.sessionJwt });
        } catch (err) { handleErr(res, err, 'POST auth/redeem'); }
    });

    // Wallet auth — step 1: issue EIP-712 nonce challenge
    router.post('/:agentId/auth/wallet/nonce', async (req, res) => {
        cors(res);
        try {
            const { address } = req.body || {};
            if (!address) return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'address is required' } });

            let checksumAddress;
            try { checksumAddress = ethers.getAddress(address); }
            catch { return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Invalid Ethereum address' } }); }

            const nonce   = require('crypto').randomBytes(16).toString('hex');
            const expiry  = Math.floor(Date.now() / 1000) + 300;
            const domain  = { name: 'StationThis Widget', version: '1', chainId: 1 };
            const types   = { Auth: [
                { name: 'widget', type: 'string'  },
                { name: 'nonce',  type: 'string'  },
                { name: 'expiry', type: 'uint256' },
            ]};
            const message = { widget: req.params.agentId, nonce, expiry };

            _walletNonces.set(nonce, { address: checksumAddress, domain, types, message, expiresAt: Date.now() + 300_000 });

            // Prune when store gets large
            if (_walletNonces.size > 1000) {
                const now = Date.now();
                for (const [k, v] of _walletNonces) { if (v.expiresAt < now) _walletNonces.delete(k); }
            }

            res.json({ domain, types, message });
        } catch (err) { handleErr(res, err, 'POST auth/wallet/nonce'); }
    });

    // Wallet auth — step 2: verify signature → issue session JWT
    router.post('/:agentId/auth/wallet/verify', async (req, res) => {
        cors(res);
        try {
            const { nonce, signature } = req.body || {};
            if (!nonce || !signature) return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'nonce and signature are required' } });

            const entry = _walletNonces.get(nonce);
            if (!entry) return res.status(400).json({ error: { code: 'INVALID_NONCE', message: 'Invalid or expired nonce' } });
            if (entry.expiresAt < Date.now()) {
                _walletNonces.delete(nonce);
                return res.status(400).json({ error: { code: 'CHALLENGE_EXPIRED', message: 'Nonce expired' } });
            }

            let recovered;
            try {
                recovered = ethers.verifyTypedData(entry.domain, entry.types, entry.message, signature);
            } catch {
                return res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Could not recover signer' } });
            }

            if (ethers.getAddress(recovered) !== entry.address) {
                return res.status(400).json({ error: { code: 'SIGNATURE_MISMATCH', message: 'Signature does not match address' } });
            }

            _walletNonces.delete(nonce);

            const { status: s, data } = await _internalReq('POST', '/internal/v1/data/auth/find-or-create-by-wallet', { address: recovered });
            if (s >= 400) return res.status(s).json(data);

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            // Check if this wallet is the agent owner (DB-level check)
            const agentDoc = await findAgent(req.params.agentId);
            const recoveredLC = recovered.toLowerCase();
            const isOwner = agentDoc && (
                agentDoc.wallets?.some(w => w.address?.toLowerCase() === recoveredLC) ||
                agentDoc.agentOwnerAddress?.toLowerCase() === recoveredLC
            );

            const sessionJwt = jwt.sign({
                sub:             req.params.agentId,
                userId:          data.user._id.toString(),
                masterAccountId: data.user._id.toString(),
                walletAddress:   recovered,
                sessionType:     'wallet',
                tier:            isOwner ? 'agent_owner' : 'user',
            }, secret, { algorithm: 'HS256', expiresIn: '24h' });

            res.json({ sessionJwt, isNewUser: data.isNewUser, isOwner });
        } catch (err) { handleErr(res, err, 'POST auth/wallet/verify'); }
    });

    // Purchase info — credit vault address + pre-encoded calldata for payETH
    router.get('/:agentId/purchase-info', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            const chainId           = '8453'; // Base
            const creditVaultAddress = CREDIT_VAULT_ADDRESSES[chainId];
            const referralKey       = ethers.id(req.params.agentId); // keccak256(utf8(agentId))
            const selector          = ethers.id('pay(bytes32)').slice(0, 10);
            const calldata          = selector + referralKey.slice(2);

            res.json({
                creditVaultAddress,
                referralKey,
                calldata,
                suggestedAmountsWei: ['0x2386f26fc10000', '0xb1a2bc2ec50000', '0x16345785d8a0000'], // 0.01, 0.05, 0.1 ETH
                chainId: 8453,
            });
        } catch (err) { handleErr(res, err, 'GET purchase-info'); }
    });

    // x402 session — pay $1 USDC on Base → 24-hour session JWT
    router.post('/:agentId/session/x402', async (req, res) => {
        cors(res);
        const { agentId } = req.params;
        const receiverAddress = process.env.X402_RECEIVER_ADDRESS;

        if (!receiverAddress) {
            return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'x402 payments not configured on this server' } });
        }

        const paymentHeader = req.headers['x-payment'];

        if (!paymentHeader) {
            // First call: return 402 + PaymentRequired so the SDK can build the EIP-3009 signature
            const paymentRequired = {
                x402Version: 2,
                resource: {
                    url: `${req.protocol}://${req.get('host')}/widget/${encodeURIComponent(agentId)}/session/x402`,
                    description: 'Agent session — 24 h access',
                    mimeType: 'application/json',
                },
                accepts: [{
                    scheme: 'exact',
                    network: X402_NETWORK,
                    asset:   BASE_USDC_ADDRESS,
                    amount:  X402_SESSION_USDC,
                    payTo:   receiverAddress,
                    maxTimeoutSeconds: 300,
                    extra: { name: 'USD Coin', version: '2' },
                }],
            };
            const headerValue = encodePaymentRequiredHeader(paymentRequired);
            return res
                .status(402)
                .set('X-PAYMENT-REQUIRED', headerValue)
                .set('Access-Control-Expose-Headers', 'X-PAYMENT-REQUIRED')
                .json({ error: 'PAYMENT_REQUIRED', message: 'USDC payment required for session access', paymentRequired });
        }

        // Second call: verify + issue JWT + settle
        try {
            const facilitatorClient = _getFacilitatorClient();
            if (!facilitatorClient) {
                return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'CDP credentials not configured' } });
            }

            let paymentPayload;
            try { paymentPayload = decodePaymentSignatureHeader(paymentHeader); }
            catch { return res.status(400).json({ error: { code: 'INVALID_PAYMENT_HEADER', message: 'Malformed X-Payment header' } }); }

            // Amount, asset, and network come from server constants — never trust the header for these.
            const paymentRequirements = {
                scheme:            'exact',
                network:           X402_NETWORK,
                asset:             BASE_USDC_ADDRESS,
                amount:            X402_SESSION_USDC,
                payTo:             receiverAddress,
                maxTimeoutSeconds: 300,
                extra:             { name: 'USD Coin', version: '2' },
            };

            const verifyResult = await facilitatorClient.verify(paymentPayload, paymentRequirements);
            if (!verifyResult.isValid) {
                return res.status(402).json({ error: { code: 'PAYMENT_INVALID', message: verifyResult.invalidReason || 'Payment verification failed' } });
            }

            const payer = verifyResult.payer;
            const { status: userStatus, data: userData } = await _internalReq(
                'POST', '/internal/v1/data/auth/find-or-create-by-wallet', { address: payer }
            );
            if (userStatus >= 400) {
                return res.status(500).json({ error: { code: 'USER_ERROR', message: 'Failed to establish user session' } });
            }

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            const sessionJwt = jwt.sign({
                sub:             agentId,
                userId:          userData.user._id.toString(),
                masterAccountId: userData.user._id.toString(),
                walletAddress:   payer,
                sessionType:     'x402',
                tier:            'user',
            }, secret, { algorithm: 'HS256', expiresIn: '24h' });

            // Settle is fire-and-forget — user gets their session regardless of on-chain timing
            facilitatorClient.settle(paymentPayload, paymentRequirements).catch(err => {
                logger.error('[widget/x402] settlement failed (non-fatal):', err.message);
            });

            return res.json({ sessionJwt, payer });
        } catch (err) {
            logger.error('[widget/x402] error:', err.message);
            return res.status(400).json({ error: { code: 'PAYMENT_ERROR', message: 'Payment processing failed' } });
        }
    });

    // x402 spell execution — pay per cast on Base USDC → execute spell → castId + pollUrl
    router.post('/:agentId/spells/:spellSlug/x402', async (req, res) => {
        cors(res);
        const { agentId, spellSlug } = req.params;
        const receiverAddress = process.env.X402_RECEIVER_ADDRESS;

        if (!receiverAddress) {
            return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'x402 payments not configured on this server' } });
        }

        const paymentHeader = req.headers['x-payment'];

        if (!paymentHeader) {
            // Probe: return 402 so caller can build EIP-3009 signature
            const paymentRequired = {
                x402Version: 2,
                resource: {
                    url: `${req.protocol}://${req.get('host')}/widget/${encodeURIComponent(agentId)}/spells/${encodeURIComponent(spellSlug)}/x402`,
                    description: `Spell execution: ${spellSlug}`,
                    mimeType: 'application/json',
                },
                accepts: [{
                    scheme:            'exact',
                    network:           X402_NETWORK,
                    asset:             BASE_USDC_ADDRESS,
                    amount:            X402_CAST_USDC,
                    payTo:             receiverAddress,
                    maxTimeoutSeconds: 300,
                    extra: { name: 'USD Coin', version: '2' },
                }],
            };
            const headerValue = encodePaymentRequiredHeader(paymentRequired);
            return res
                .status(402)
                .set('X-PAYMENT-REQUIRED', headerValue)
                .set('Access-Control-Expose-Headers', 'X-PAYMENT-REQUIRED')
                .json({ error: 'PAYMENT_REQUIRED', paymentRequired });
        }

        // Payment submitted — verify, execute, settle
        try {
            const facilitatorClient = _getFacilitatorClient();
            if (!facilitatorClient) {
                return res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: 'CDP credentials not configured' } });
            }

            let paymentPayload;
            try { paymentPayload = decodePaymentSignatureHeader(paymentHeader); }
            catch { return res.status(400).json({ error: { code: 'INVALID_PAYMENT_HEADER', message: 'Malformed X-Payment header' } }); }

            // Amount, asset, and network come from server constants — never trust the header for these.
            const paymentRequirements = {
                scheme:            'exact',
                network:           X402_NETWORK,
                asset:             BASE_USDC_ADDRESS,
                amount:            X402_CAST_USDC,
                payTo:             receiverAddress,
                maxTimeoutSeconds: 300,
                extra:             { name: 'USD Coin', version: '2' },
            };

            const verifyResult = await facilitatorClient.verify(paymentPayload, paymentRequirements);
            if (!verifyResult.isValid) {
                return res.status(402).json({ error: { code: 'PAYMENT_INVALID', message: verifyResult.invalidReason || 'Payment verification failed' } });
            }

            const agentDoc = await findAgent(agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            // Verify the spell belongs to this agent's workspace before charging them for it
            if (deps.db?.workspaces && agentDoc.starterWorkspaceSlug) {
                const ws = await deps.db.workspaces.findBySlug(agentDoc.starterWorkspaceSlug);
                const agentSpellSlugs = new Set(
                    (ws?.snapshot?.toolWindows || [])
                        .filter(w => w.isSpell && w.spell?.slug)
                        .map(w => w.spell.slug)
                );
                if (!agentSpellSlugs.has(spellSlug)) {
                    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Spell not found in this agent workspace' } });
                }
            }

            // Compute gross points from x402 payment amount
            const grossPoints = usdcAtomicToPoints(X402_CAST_USDC);
            const runId = require('crypto').randomUUID();

            // Agent/collection owner rev-share — before dispatch
            // For provisioned ERC-8004 agents, synthesize a collection-like object from the
            // noemaAccountId so distributeAgentOwnerReward credits them directly instead of
            // falling through to the split_ledger unclaimed path.
            let agentCollection = null;
            if (agentDoc._provisionedDoc?.noemaAccountId) {
                agentCollection = { userId: agentDoc._provisionedDoc.noemaAccountId };
            } else if (agentDoc.agentCollection && deps.db?.cookCollections) {
                agentCollection = await deps.db.cookCollections.findById(agentDoc.agentCollection);
            }
            await distributeAgentOwnerReward({
                agentDoc,
                collection: agentCollection,
                grossPoints,
                runId,
                spellSlug,
                economyService,
                splitLedgerDb: deps.db?.splitLedger || null,
                logger,
            }).catch(err => logger.error('[widget/x402/spell] agentOwnerReward failed:', err.message));

            const inputs = req.body?.inputs || {};
            const { status, data } = await _internalReq('POST', '/internal/v1/data/spells/cast', {
                slug:    spellSlug,
                context: {
                    masterAccountId:    agentDoc._id.toString(),
                    parameterOverrides: inputs,
                    platform:           'widget-x402',
                    payerAddress:       verifyResult.payer,
                    isX402:             true,
                    x402BasePoints:     grossPoints,
                    runId,
                },
            });

            // Settle fire-and-forget — caller gets their cast regardless of on-chain timing
            facilitatorClient.settle(paymentPayload, paymentRequirements).catch(err => {
                logger.error('[widget/x402/spell] settlement failed (non-fatal):', err.message);
            });

            const castId = data?.castId || data?._id?.toString();
            const pollUrl = castId
                ? `${req.protocol}://${req.get('host')}/widget/${encodeURIComponent(agentId)}/casts/${castId}`
                : null;

            res.status(status).json({ ...data, ...(pollUrl && { pollUrl }) });
        } catch (err) {
            logger.error('[widget/x402/spell] error:', err.message);
            res.status(400).json({ error: { code: 'PAYMENT_ERROR', message: 'Payment processing failed' } });
        }
    });

    // On-chain tx confirmation poll — issues JWT once credit_ledger entry is confirmed
    router.get('/:agentId/session/tx-status', async (req, res) => {
        cors(res);
        const { tx } = req.query;
        if (!tx) return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'tx is required' } });
        try {
            const entry = deps.db?.creditLedger
                ? await deps.db.creditLedger.findOne({ deposit_tx_hash: tx, status: 'CONFIRMED' })
                : null;
            if (!entry) return res.json({ status: 'pending' });

            const { status: s, data } = await _internalReq('POST', '/internal/v1/data/auth/find-or-create-by-wallet', { address: entry.depositor_address });
            if (s >= 400) return res.json({ status: 'pending' });

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            const sessionJwt = jwt.sign({
                sub:             req.params.agentId,
                userId:          data.user._id.toString(),
                masterAccountId: data.user._id.toString(),
                walletAddress:   entry.depositor_address,
                sessionType:     'purchase',
                tier:            'user',
            }, secret, { algorithm: 'HS256', expiresIn: '24h' });

            res.json({ status: 'confirmed', sessionJwt });
        } catch (err) { handleErr(res, err, 'GET tx-status'); }
    });

    router.post('/:agentId/auth/challenge', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
            res.json(verifySvc.issueChallenge(agentDoc));
        } catch (err) { handleErr(res, err, 'POST challenge'); }
    });

    router.post('/:agentId/auth/verify', async (req, res) => {
        cors(res);
        try {
            const { nonce, signature } = req.body;
            if (!nonce || !signature) {
                return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'nonce and signature are required' } });
            }
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
            const result = await verifySvc.verify(agentDoc, { nonce, signature });
            res.json(result);
        } catch (err) { handleErr(res, err, 'POST verify'); }
    });

    // ── Workspace data ───────────────────────────────────────────────────────

    router.get('/:agentId/workspace', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            const slug = agentDoc.starterWorkspaceSlug;
            if (!slug) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent has no starter workspace' } });

            const workspace = await deps.db?.workspaces?.findBySlug(slug);
            if (!workspace) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });

            // Pull snapshot live from the origin template (if this is a derived workspace)
            // so edits to the template propagate immediately to all downstream widgets.
            const originSlug = workspace.origin?.slug;
            let liveSnap = workspace.snapshot || {};
            if (originSlug && deps.db?.workspaces) {
                const template = await deps.db.workspaces.findBySlug(originSlug);
                if (template?.snapshot) liveSnap = template.snapshot;
            }

            // Build templateWindowId → cloned spell slug map so execution
            // uses per-agent cloned spells even though we display from the template.
            const agentSnap = workspace.snapshot || {};
            const clonedSlugByTemplateId = {};
            for (const w of (agentSnap.toolWindows || [])) {
                if (w.isSpell && w.templateWindowId && w.spell?.slug) {
                    clonedSlugByTemplateId[w.templateWindowId] = w.spell.slug;
                }
            }

            const templateWindows = (liveSnap.toolWindows || []).filter(w => w.type !== 'agent-context');

            // Resolve spells from the live template snapshot.
            // Use cloned slug for execution; read metadata from template spell.
            const spells = [];
            for (const win of templateWindows) {
                const templateSpellSlug = win.spellRef || win.spell?.slug;
                if (!templateSpellSlug || !win.isSpell || !deps.db?.spells) continue;

                const execSlug = clonedSlugByTemplateId[win.id] || templateSpellSlug;
                const isCloned = execSlug !== templateSpellSlug;
                try {
                    const spell = await deps.db.spells.findBySlug(templateSpellSlug);
                    // Read exposedInputs from the exec (cloned) spell — the factory may have
                    // baked some inputs as static and removed them from exposedInputs there.
                    const execSpell = isCloned ? await deps.db.spells.findBySlug(execSlug).catch(() => null) : null;
                    if (spell) {
                        spells.push({
                            slug:          execSlug,
                            name:          spell.name,
                            description:   spell.description || null,
                            exposedInputs: (execSpell || spell).exposedInputs || [],
                            windowId:      win.id,
                            x402Url:       `${req.protocol}://${req.get('host')}/widget/${encodeURIComponent(req.params.agentId)}/spells/${encodeURIComponent(execSlug)}/x402`,
                        });
                    }
                } catch (e) {
                    logger.warn(`[WidgetApi] Could not resolve spell ${templateSpellSlug}: ${e.message}`);
                }
            }

            // Fetch recent cast outputs for the gallery
            // initiatorAccountId is stored as ObjectId — match both forms to be safe
            let recentOutputs = [];
            const { ObjectId: OIDg } = require('mongodb');
            const _oidMatch = OIDg.isValid(agentDoc._id) ? new OIDg(agentDoc._id) : agentDoc._id;
            if (deps.db?.casts) {
                try {
                    const rawOutputs = await deps.db.casts.aggregate([
                        { $match: { initiatorAccountId: _oidMatch, status: 'completed' } },
                        { $sort: { updatedAt: -1 } },
                        { $limit: 20 },
                        { $project: { castId: { $toString: '$_id' }, url: '$output.url', updatedAt: 1 } },
                    ]);
                    const needsUrl = rawOutputs.filter(r => !r.url);
                    if (needsUrl.length && deps.db?.generationOutputs) {
                        const gens = await deps.db.generationOutputs.findMany(
                            { 'metadata.castId': { $in: needsUrl.map(r => r.castId) }, status: { $in: ['completed', 'succeeded'] }, responsePayload: { $exists: true } },
                            { sort: { _id: -1 } }
                        );
                        const genByCastId = {};
                        for (const g of gens) { const c = g.metadata?.castId; if (c && !genByCastId[c]) genByCastId[c] = g; }
                        const writes = [];
                        for (const r of needsUrl) {
                            const gen = genByCastId[r.castId];
                            if (!gen?.responsePayload) continue;
                            const p = Array.isArray(gen.responsePayload) ? gen.responsePayload[0] : gen.responsePayload;
                            const imgUrl = p?.data?.images?.[0]?.url || p?.data?.url;
                            if (imgUrl) {
                                r.url = imgUrl;
                                writes.push(deps.db.casts.updateOne({ _id: new OIDg(r.castId) }, { $set: { output: { type: 'image', url: imgUrl }, updatedAt: new Date() } }).catch(() => {}));
                            }
                        }
                        if (writes.length) await Promise.all(writes);
                    }
                    recentOutputs = rawOutputs.filter(r => r.url).map(r => ({ castId: r.castId, url: r.url }));
                } catch (_) {}
            }

            res.json({
                agentId:       agentDoc.agentId,
                workspaceSlug: slug,
                toolWindows:   templateWindows,
                connections:   (liveSnap.connections || []).filter(c => {
                    const agentContextIds = new Set(
                        (liveSnap.toolWindows || []).filter(w => w.type === 'agent-context').map(w => w.id)
                    );
                    return !agentContextIds.has(c.fromWindowId || c.from) && !agentContextIds.has(c.toWindowId || c.to);
                }),
                spells,
                recentOutputs,
            });
        } catch (err) { handleErr(res, err, 'GET workspace'); }
    });

    // ── Guest-safe spell cast ─────────────────────────────────────────────────
    // Casts the spell using the agent's masterAccountId so guests don't need a JWT.

    router.post('/:agentId/spells/:spellSlug/cast', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            const inputs = req.body?.inputs || {};
            const { status, data } = await _internalReq('POST', '/internal/v1/data/spells/cast', {
                slug:    req.params.spellSlug,
                context: {
                    masterAccountId: agentDoc._id.toString(),
                    parameterOverrides: inputs,
                    platform: 'widget-guest',
                    isGuest: true,
                },
            });
            res.status(status).json(data);
        } catch (err) { handleErr(res, err, 'POST widget cast'); }
    });

    // ── Cast status poll ──────────────────────────────────────────────────────

    router.get('/:agentId/casts/:castId', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            const { status, data } = await _internalReq('GET', `/internal/v1/data/spells/casts/${req.params.castId}`);

            // Attach output URL from the final step's generation record.
            // stepGenerationIds may be empty on the cast doc even when the spell ran — fall back
            // to querying by metadata.castId (the pipeline always writes it there).
            if (data?.status === 'completed' && !data.output && deps.db?.generationOutputs) {
                try {
                    const { ObjectId: OID } = require('mongodb');
                    let gen = null;

                    if (data.stepGenerationIds?.length) {
                        const lastGenId = data.stepGenerationIds[data.stepGenerationIds.length - 1];
                        gen = await deps.db.generationOutputs.findOne({ _id: typeof lastGenId === 'string' ? new OID(lastGenId) : lastGenId });
                    }

                    // Fallback: find the last completed generation whose metadata links to this cast
                    if (!gen) {
                        gen = await deps.db.generationOutputs.findOne(
                            { 'metadata.castId': req.params.castId, status: { $in: ['completed', 'succeeded'] }, responsePayload: { $exists: true } },
                            { sort: { _id: -1 } }
                        );
                    }

                    if (gen?.responsePayload) {
                        const payload = Array.isArray(gen.responsePayload) ? gen.responsePayload[0] : gen.responsePayload;
                        const imgUrl = payload?.data?.images?.[0]?.url || payload?.data?.url;
                        const textVal = payload?.data?.text || payload?.data?.result || payload?.result;
                        if (imgUrl) data.output = { type: 'image', url: imgUrl };
                        else if (textVal) data.output = { type: 'text', value: typeof textVal === 'string' ? textVal : textVal[0] || '' };

                        // Persist output on the cast so the gallery query can find it
                        if (data.output && deps.db?.casts) {
                            try {
                                await deps.db.casts.updateOne(
                                    { _id: new OID(req.params.castId) },
                                    { $set: { output: data.output, updatedAt: new Date() } }
                                );
                            } catch (_) {}
                        }
                    }
                } catch (_) {}
            }

            res.status(status).json(data);
        } catch (err) { handleErr(res, err, 'GET widget cast status'); }
    });

    // ── Image upload ──────────────────────────────────────────────────────────
    // Accepts { data: base64, contentType, fileName? } JSON, uploads to R2, returns { url }.
    // Uses its own body-parser with a 12 MB limit (base64 inflates ~33% over raw).

    router.post('/:agentId/upload', async (req, res) => {
        cors(res);
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });

            if (!deps.storageService) return res.status(503).json({ error: { code: 'UNAVAILABLE', message: 'Upload service not configured' } });

            const { data: b64, contentType, fileName } = req.body || {};
            if (!b64 || !contentType) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'data and contentType are required' } });

            const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            if (!allowed.includes(contentType)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Unsupported image type' } });

            const buf = Buffer.from(b64, 'base64');
            const ext = contentType.split('/')[1] || 'jpg';
            const key = `widget-uploads/${agentDoc.agentId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

            const { Readable } = require('stream');
            const stream = Readable.from(buf);
            const { permanentUrl } = await deps.storageService.uploadFromStream(stream, key, contentType);

            res.json({ url: permanentUrl });
        } catch (err) { handleErr(res, err, 'POST widget upload'); }
    });

    // ── Buy-points proxy ──────────────────────────────────────────────────────
    // Accepts widget JWT for user context; forwards to internal API (no CSRF needed).
    // Supported-chains and wallets/balances are public on the external API — widget
    // calls those directly. These proxy routes cover the auth-gated points endpoints.

    function _decodeWidgetJwt(req) {
        const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
        if (!secret) return null;
        const auth  = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
        if (!token) return null;
        try { return jwt.verify(token, secret, { algorithms: ['HS256'] }); }
        catch { return null; }
    }

    router.get('/:agentId/bp/supported-assets', async (req, res) => {
        cors(res);
        try {
            const { chainId } = req.query;
            const url = `/internal/v1/data/points/supported-assets${chainId ? '?chainId=' + encodeURIComponent(chainId) : ''}`;
            const { status, data } = await _internalReq('GET', url);
            res.status(status).json(data);
        } catch (err) { res.status(500).json({ error: { message: err.message } }); }
    });

    router.post('/:agentId/bp/quote', async (req, res) => {
        cors(res);
        try {
            const { status, data } = await _internalReq('POST', '/internal/v1/data/points/quote', req.body);
            res.status(status).json(data);
        } catch (err) { res.status(500).json({ error: { message: err.message } }); }
    });

    router.post('/:agentId/bp/purchase', async (req, res) => {
        cors(res);
        try {
            const session = _decodeWidgetJwt(req);
            let userId = session?.userId || session?.masterAccountId;

            // No session yet (pre-auth purchase) — find-or-create by wallet address
            if (!userId && req.body.userWalletAddress) {
                const { status: s, data: d } = await _internalReq('POST', '/internal/v1/data/auth/find-or-create-by-wallet', {
                    address: req.body.userWalletAddress,
                });
                if ((s === 200 || s === 201) && d?.user?._id) userId = d.user._id.toString();
            }

            if (!userId) {
                return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Connect your wallet to purchase' } });
            }

            const body = { ...req.body, userId };
            const { status, data } = await _internalReq('POST', '/internal/v1/data/points/purchase', body);
            res.status(status).json(data);
        } catch (err) { res.status(500).json({ error: { message: err.message } }); }
    });

    router.get('/:agentId/bp/tx-status', async (req, res) => {
        cors(res);
        try {
            const { txHash } = req.query;
            if (!txHash) return res.status(400).json({ error: { message: 'txHash required' } });
            const { status, data } = await _internalReq('GET', `/internal/v1/data/points/tx-status?txHash=${encodeURIComponent(txHash)}`);
            res.status(status).json(data);
        } catch (err) { res.status(500).json({ error: { message: err.message } }); }
    });

    router.get('/:agentId/bp/balance', async (req, res) => {
        cors(res);
        try {
            const session = _decodeWidgetJwt(req);
            if (!session) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
            const wallet = session.walletAddress;
            if (!wallet) return res.json({ balance: 0 });
            const { status, data } = await _internalReq('GET', `/internal/v1/data/ledger/points/by-wallet/${encodeURIComponent(wallet)}`);
            res.status(status).json({ balance: data.points || 0 });
        } catch (err) { res.status(500).json({ error: { message: err.message } }); }
    });

    // ── Delegation management (owner session required) ────────────────────────

    router.get('/:agentId/delegations', async (req, res) => {
        cors(res);
        if (!requireOwner(req, res, req.params.agentId)) return;
        try {
            const delegations = await delegationSvc.list(req.params.agentId);
            res.json({ delegations });
        } catch (err) { handleErr(res, err, 'GET delegations'); }
    });

    router.post('/:agentId/delegations', async (req, res) => {
        cors(res);
        if (!requireOwner(req, res, req.params.agentId)) return;
        try {
            const { label, spendCapPoints, expiresInHours } = req.body;
            const result = await delegationSvc.create(req.params.agentId, { label, spendCapPoints, expiresInHours });
            res.status(201).json(result);
        } catch (err) { handleErr(res, err, 'POST delegations'); }
    });

    router.delete('/:agentId/delegations/:delId', async (req, res) => {
        cors(res);
        if (!requireOwner(req, res, req.params.agentId)) return;
        try {
            await delegationSvc.revoke(req.params.agentId, req.params.delId);
            res.json({ success: true });
        } catch (err) { handleErr(res, err, 'DELETE delegations'); }
    });

    // ── Partner iframe ───────────────────────────────────────────────────────

    router.get('/partner', async (req, res) => {
        const { partnerId } = req.query;
        if (!partnerId) {
            return res.status(400).send('Missing required query param: partnerId');
        }
        try {
            const partnerDoc = deps.db?.partner
                ? await deps.db.partner.findPartnerById(partnerId)
                : null;
            if (!partnerDoc) {
                return res.status(404).send('Partner not found');
            }
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('X-Frame-Options', 'ALLOWALL');
            res.setHeader('Content-Security-Policy', "frame-ancestors *");
            res.setHeader('Cache-Control', 'no-cache');
            res.send(buildPartnerHtml(partnerId));
        } catch (err) {
            logger.error(`[WidgetApi] GET /partner: ${err.message}`);
            res.status(500).send('Internal server error');
        }
    });

    // ── Collection gallery ───────────────────────────────────────────────────

    router.get('/gallery/:collectionAddress', (req, res) => {
        const addr = req.params.collectionAddress.toLowerCase();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Frame-Options', 'ALLOWALL');
        res.setHeader('Content-Security-Policy', "frame-ancestors *");
        res.setHeader('Cache-Control', 'no-cache');
        res.send(buildGalleryHtml(addr));
    });

    router.get('/gallery/:collectionAddress/feed', async (req, res) => {
        cors(res);
        try {
            const addr = req.params.collectionAddress.toLowerCase();
            if (!deps.db?.casts) return res.json({ items: [] });

            // Gather agents from legacy userCore (pre-ERC-8004) and provisioned agentAccountDb
            const [legacyAgents, provisionedAgents] = await Promise.all([
                deps.db.userCore
                    ? deps.db.userCore.findByAccountType('agent', { agentCollection: addr })
                    : Promise.resolve([]),
                deps.db.agentAccount
                    ? deps.db.agentAccount.findByCollection(addr)
                    : Promise.resolve([]),
            ]);

            // Build noemaId → display metadata map
            const metaByNoemaId = {};
            for (const a of legacyAgents) {
                metaByNoemaId[a._id.toString()] = {
                    agentId:   a.agentId || null,
                    agentName: a.displayName || a.agentId || null,
                };
            }
            for (const a of provisionedAgents) {
                metaByNoemaId[a.noemaAccountId] = {
                    agentId:   a.agentId || null,
                    agentName: a.tokenId ? `Agent #${a.tokenId}` : (a.agentId || null),
                };
            }

            const noemaIds = Object.keys(metaByNoemaId);
            if (!noemaIds.length) return res.json({ items: [] });

            const { ObjectId: OID } = require('mongodb');
            const noemaObjectIds = noemaIds
                .map(id => { try { return new OID(id); } catch { return null; } })
                .filter(Boolean);

            // Fetch completed casts — output.url may not be set yet (lazy-written on first status poll).
            const raw = await deps.db.casts.aggregate([
                { $match: { initiatorAccountId: { $in: noemaObjectIds }, status: 'completed', galleryHidden: { $ne: true } } },
                { $sort: { galleryPinned: -1, updatedAt: -1 } },
                { $limit: 60 },
                { $project: { castId: { $toString: '$_id' }, initiatorAccountId: 1, url: '$output.url', updatedAt: 1, galleryPinned: 1 } },
            ]);

            // For casts without output.url, resolve from generationOutputs and persist back.
            const needsResolve = raw.filter(r => !r.url);
            if (needsResolve.length && deps.db?.generationOutputs) {
                const castIdStrs = needsResolve.map(r => r.castId);
                const gens = await deps.db.generationOutputs.findMany(
                    { 'metadata.castId': { $in: castIdStrs }, status: { $in: ['completed', 'succeeded'] }, responsePayload: { $exists: true } },
                    { sort: { _id: -1 } }
                );
                const genByCastId = {};
                for (const g of gens) {
                    const cid = g.metadata?.castId;
                    if (cid && !genByCastId[cid]) genByCastId[cid] = g;
                }
                const writes = [];
                for (const r of needsResolve) {
                    const gen = genByCastId[r.castId];
                    if (!gen?.responsePayload) continue;
                    const payload = Array.isArray(gen.responsePayload) ? gen.responsePayload[0] : gen.responsePayload;
                    const imgUrl = payload?.data?.images?.[0]?.url || payload?.data?.url;
                    if (imgUrl) {
                        r.url = imgUrl;
                        writes.push(deps.db.casts.updateOne(
                            { _id: new OID(r.castId) },
                            { $set: { output: { type: 'image', url: imgUrl }, updatedAt: new Date() } }
                        ).catch(() => {}));
                    }
                }
                if (writes.length) await Promise.all(writes);
            }

            const items = raw
                .filter(r => r.url)
                .map(r => {
                    const meta = metaByNoemaId[r.initiatorAccountId?.toString()] || {};
                    return {
                        castId:    r.castId,
                        url:       r.url,
                        updatedAt: r.updatedAt,
                        agentId:   meta.agentId || null,
                        agentName: meta.agentName || null,
                        pinned:    r.galleryPinned || false,
                    };
                });

            res.json({ items });
        } catch (err) {
            logger.error(`[WidgetApi] GET gallery feed: ${err.message}`);
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load gallery' } });
        }
    });

    // Hide a cast from the collection gallery (requires owner JWT for any agent in the collection)
    router.patch('/gallery/:collectionAddress/casts/:castId/hide', async (req, res) => {
        cors(res);
        try {
            const addr   = req.params.collectionAddress.toLowerCase();
            const castId = req.params.castId;

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            const auth  = req.headers.authorization || '';
            const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
            if (!token) return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });

            let payload;
            try { payload = jwt.verify(token, secret, { algorithms: ['HS256'] }); }
            catch { return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired token' } }); }

            if (payload.tier !== 'agent_owner') {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner session required' } });
            }

            if (!await _verifyGalleryOwner(payload, addr)) {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Agent not in this collection' } });
            }

            if (deps.db?.casts) {
                const { ObjectId: OID } = require('mongodb');
                await deps.db.casts.updateOne(
                    { _id: new OID(castId) },
                    { $set: { galleryHidden: true, updatedAt: new Date() } }
                );
            }

            res.json({ ok: true });
        } catch (err) {
            logger.error(`[WidgetApi] PATCH gallery hide: ${err.message}`);
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to hide cast' } });
        }
    });

    // Unhide a cast from the collection gallery (requires owner JWT for any agent in the collection)
    router.patch('/gallery/:collectionAddress/casts/:castId/unhide', async (req, res) => {
        cors(res);
        try {
            const addr   = req.params.collectionAddress.toLowerCase();
            const castId = req.params.castId;

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            const auth  = req.headers.authorization || '';
            const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
            if (!token) return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });

            let payload;
            try { payload = jwt.verify(token, secret, { algorithms: ['HS256'] }); }
            catch { return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired token' } }); }

            if (payload.tier !== 'agent_owner') {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner session required' } });
            }

            if (!await _verifyGalleryOwner(payload, addr)) {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Agent not in this collection' } });
            }

            if (deps.db?.casts) {
                const { ObjectId: OID } = require('mongodb');
                await deps.db.casts.updateOne(
                    { _id: new OID(castId) },
                    { $set: { galleryHidden: false, updatedAt: new Date() } }
                );
            }

            res.json({ ok: true });
        } catch (err) {
            logger.error(`[WidgetApi] PATCH gallery unhide: ${err.message}`);
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to unhide cast' } });
        }
    });

    // Pin a cast to the top of the gallery (requires owner JWT for any agent in the collection)
    router.patch('/gallery/:collectionAddress/casts/:castId/pin', async (req, res) => {
        cors(res);
        try {
            const addr   = req.params.collectionAddress.toLowerCase();
            const castId = req.params.castId;

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            const auth  = req.headers.authorization || '';
            const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
            if (!token) return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });

            let payload;
            try { payload = jwt.verify(token, secret, { algorithms: ['HS256'] }); }
            catch { return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired token' } }); }

            if (payload.tier !== 'agent_owner') {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner session required' } });
            }

            if (!await _verifyGalleryOwner(payload, addr)) {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Agent not in this collection' } });
            }

            if (deps.db?.casts) {
                const { ObjectId: OID } = require('mongodb');
                await deps.db.casts.updateOne(
                    { _id: new OID(castId) },
                    { $set: { galleryPinned: true, updatedAt: new Date() } }
                );
            }

            res.json({ ok: true });
        } catch (err) {
            logger.error(`[WidgetApi] PATCH gallery pin: ${err.message}`);
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to pin cast' } });
        }
    });

    // Unpin a cast from the top of the gallery (requires owner JWT for any agent in the collection)
    router.patch('/gallery/:collectionAddress/casts/:castId/unpin', async (req, res) => {
        cors(res);
        try {
            const addr   = req.params.collectionAddress.toLowerCase();
            const castId = req.params.castId;

            const secret = process.env.AGENT_SESSION_SECRET || process.env.JWT_SECRET;
            if (!secret) return res.status(500).json({ error: { code: 'CONFIG_ERROR', message: 'Session secret not configured' } });

            const auth  = req.headers.authorization || '';
            const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
            if (!token) return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });

            let payload;
            try { payload = jwt.verify(token, secret, { algorithms: ['HS256'] }); }
            catch { return res.status(401).json({ error: { code: 'TOKEN_INVALID', message: 'Invalid or expired token' } }); }

            if (payload.tier !== 'agent_owner') {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner session required' } });
            }

            if (!await _verifyGalleryOwner(payload, addr)) {
                return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Agent not in this collection' } });
            }

            if (deps.db?.casts) {
                const { ObjectId: OID } = require('mongodb');
                await deps.db.casts.updateOne(
                    { _id: new OID(castId) },
                    { $set: { galleryPinned: false, updatedAt: new Date() } }
                );
            }

            res.json({ ok: true });
        } catch (err) {
            logger.error(`[WidgetApi] PATCH gallery unpin: ${err.message}`);
            res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to unpin cast' } });
        }
    });

    // ── Iframe mini-app ──────────────────────────────────────────────────────

    router.get('/:agentId', async (req, res) => {
        try {
            const agentDoc = await findAgent(req.params.agentId);
            if (!agentDoc) return res.status(404).send('Agent not found');

            const mode = ['canvas', 'list', 'gallery'].includes(req.query.mode)
                ? req.query.mode
                : 'canvas';

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('X-Frame-Options', 'ALLOWALL');
            res.setHeader('Content-Security-Policy', "frame-ancestors *");
            res.send(buildAppHtml(req.params.agentId, mode));
        } catch (err) {
            logger.error(`[WidgetApi] GET /:agentId: ${err.message}`);
            res.status(500).send('Internal server error');
        }
    });

    return router;
}

module.exports = { createWidgetApi };
