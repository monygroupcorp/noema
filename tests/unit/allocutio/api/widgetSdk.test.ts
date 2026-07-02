// The SDK is the deployed contract (camel404 loads it from /widget/sdk.js). These
// lock the API surface + the framing hardening (ADR-0011 §7) without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WIDGET_SDK_JS } from '../../../../src/allocutio/api/widgetSdk.js'

test('exposes window.Noema with init + initGallery', () => {
  assert.match(WIDGET_SDK_JS, /global\.Noema = Noema/)
  assert.match(WIDGET_SDK_JS, /init:\s*function/)
  assert.match(WIDGET_SDK_JS, /initGallery:\s*function/)
})

test('handle preserves the documented methods the client calls', () => {
  for (const m of ['walletConnected', 'destroy', 'setMode', 'redeemCode', 'castSpell', 'getSessionJwt']) {
    assert.match(WIDGET_SDK_JS, new RegExp(m + ':\\s*function'), `handle missing ${m}`)
  }
})

test('receive handlers are origin-pinned (hardened vs legacy frame-ancestors *)', () => {
  // Both the init bridge and the gallery lightbox listener must reject foreign origins.
  const pins = WIDGET_SDK_JS.match(/\.origin !== iframeOrigin/g) ?? []
  assert.ok(pins.length >= 2, `expected >=2 origin pins, found ${pins.length}`)
})

test('parent→iframe posts are pinned to iframeOrigin, never "*"', () => {
  // The session JWT / wallet relay go parent→iframe — those must target iframeOrigin.
  assert.match(WIDGET_SDK_JS, /iframe\.contentWindow\.postMessage\(msg, iframeOrigin\)/)
  // No postMessage receive handler should trust a '*' origin (the legacy gallery bug).
  assert.doesNotMatch(WIDGET_SDK_JS, /addEventListener\('message'[^)]*\)\s*\{[^}]*'\*'/)
})

test('derives baseUrl from its own script origin (must match provisioning origin)', () => {
  assert.match(WIDGET_SDK_JS, /script\[src\*="sdk\.js"\]/)
})

test('connect-wallet: CONNECT_WALLET → eth_requestAccounts → WALLET_AVAILABLE (real, no backend)', () => {
  assert.match(WIDGET_SDK_JS, /CONNECT_WALLET'\)\s*\{ _connectWallet\(\)/)
  assert.match(WIDGET_SDK_JS, /eth_requestAccounts/)
  assert.match(WIDGET_SDK_JS, /type: 'WALLET_AVAILABLE', address: a\[0\]/)
})

test('x402 v2: signs the iframe PaymentRequirements → returns PAYMENT_SIGNED (no session POST)', () => {
  // PAYMENT_REQUIRED routes to the sign-only handler.
  assert.match(WIDGET_SDK_JS, /PAYMENT_REQUIRED'\)\s*\{ _signX402Payment\(msg\.paymentRequired\)/)
  // It signs EIP-3009 and posts the header back, rather than POSTing to a session endpoint.
  assert.match(WIDGET_SDK_JS, /TransferWithAuthorization/)
  assert.match(WIDGET_SDK_JS, /type: 'PAYMENT_SIGNED', header: header/)
  // The legacy /session/x402 payment round-trip is gone.
  assert.doesNotMatch(WIDGET_SDK_JS, /\/session\/x402/)
})
