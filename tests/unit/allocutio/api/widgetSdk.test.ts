// The SDK is the deployed contract (camel404 loads it from /widget/sdk.js). These
// lock the API surface + the framing hardening (ADR-0011 §7) without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WIDGET_SDK_JS } from '../../../../src/allocutio/api/widgetSdk.js'

test('exposes window.StationThis with init + initGallery', () => {
  assert.match(WIDGET_SDK_JS, /global\.StationThis = StationThis/)
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
