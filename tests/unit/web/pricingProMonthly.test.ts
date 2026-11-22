import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { canCheckout, buildProMonthlySubscribeRequest, signInThenSubscribe } from '../../../src/platforms/web/app/src/lib/checkout.js'

// The Pro Monthly plan (Option B) must be surfaced on the public pricing page with a working
// subscribe CTA, alongside the existing one-time packs — without the page's own copy
// contradicting itself (a blanket "no subscription" claim stops being true the moment a
// subscription plan exists). No jsdom/testing-library in this app's toolchain (see
// Funding.test.ts), so the page's own source is read as text, the same pattern every other
// tests/unit/web screen-shape test uses.

const here = dirname(fileURLToPath(import.meta.url))
const pricingSrc = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/Pricing.tsx'), 'utf8')
const landingPricingSrc = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/LandingPricing.tsx'), 'utf8')

test('the pricing page surfaces Pro Monthly with a real subscribe action', () => {
  assert.match(pricingSrc, /Pro Monthly/, 'Pricing.tsx no longer names the Pro Monthly plan')
  // The CTA calls the real checkout rail (POST /v1/payments/promonthly/checkout via the api
  // client) rather than linking to marketing copy — "working", not just "mentioned".
  assert.match(pricingSrc, /createProMonthlyCheckoutSession/, 'no call wires the subscribe button to the Pro Monthly checkout rail')
  assert.match(pricingSrc, /onSubscribeClick/, 'no click handler is wired to a Subscribe control')
})

test('an anon/purse caller is sent to sign in, not silently refused', () => {
  // Same identified-only invariant as a credit pack (a fiat subscription can't fund an anon
  // purse) — the page must route an anon caller to the door rather than eating the server's 401.
  assert.match(pricingSrc, /signInThenSubscribe/, 'no sign-in redirect is wired for an anon caller trying to subscribe')
  assert.equal(canCheckout(null), false)
  assert.equal(canCheckout({ token: 't', animaId: 'a1' }), true)
})

test('the subscribe request points Stripe back at the pricing page', () => {
  const req = buildProMonthlySubscribeRequest('https://noema.example')
  assert.equal(req.successUrl, 'https://noema.example/pricing?promonthly=success')
  assert.equal(req.cancelUrl, 'https://noema.example/pricing?promonthly=cancel')
})

test('signInThenSubscribe hands the door back to the exact same subscribe action', () => {
  assert.equal(signInThenSubscribe(), '/onboard?next=%2Fpricing%3Fpromonthly%3D1')
})

test('the existing packs are still offered, unchanged, alongside Pro Monthly', () => {
  assert.match(pricingSrc, /No subscription, no recurring charge/, 'a pack card no longer states its own no-subscription terms')
  assert.match(pricingSrc, /Buy \{p\.label\}/, 'a pack\'s own Buy CTA is gone')
})

test('the page makes no blanket "no subscription" claim once a subscription plan exists', () => {
  // The old lede and section heading claimed, site-wide, that there is no subscription at all.
  // That stopped being true the moment Pro Monthly shipped — a per-pack claim ("this pack has no
  // recurring charge") stays true and is kept; a page-wide claim does not and must be gone.
  assert.doesNotMatch(pricingSrc, /No subscription —/, 'a page-wide "no subscription" claim still contradicts the Pro Monthly plan on the same page')
  assert.doesNotMatch(pricingSrc, /No subscription\.$/m, 'a page-wide "no subscription" heading still contradicts the Pro Monthly plan on the same page')
})

test('the landing teaser no longer claims no subscription exists', () => {
  assert.doesNotMatch(landingPricingSrc, /No subscription and no monthly seat/, 'the landing pricing teaser still claims no subscription exists, contradicting Pro Monthly')
})
