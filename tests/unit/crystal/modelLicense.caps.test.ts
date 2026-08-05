import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONDITIONAL_CAP_USD,
  conditionalCapUsd,
  bindingCapUsd,
  activeConditionalLicenses,
} from '../../../src/crystal/modelLicense.js'

// ── The cap registry ─────────────────────────────────────────────────────────

test('conditionalCapUsd returns the cap for a capped license, undefined otherwise', () => {
  assert.equal(conditionalCapUsd('krea-community'), 1_000_000)
  assert.equal(conditionalCapUsd('stability-community'), 1_000_000)
  assert.equal(conditionalCapUsd('apache-2.0'), undefined)   // 'yes' license — no cap
  assert.equal(conditionalCapUsd('unknown'), undefined)
  assert.equal(conditionalCapUsd(undefined), undefined)
})

// ── bindingCapUsd (the min-binding logic) ────────────────────────────────────

test('bindingCapUsd is null when no capped license is active (dormant / ∞)', () => {
  assert.equal(bindingCapUsd([]), null)
  assert.equal(bindingCapUsd(['apache-2.0', 'unknown']), null)   // none carry a cap
})

test('bindingCapUsd takes the tightest (minimum) cap', () => {
  assert.equal(bindingCapUsd(['krea-community']), 1_000_000)
  // Simulate a hypothetical stricter cap alongside a looser one — the min wins.
  const saved = CONDITIONAL_CAP_USD['stability-community']
  try {
    CONDITIONAL_CAP_USD['stability-community'] = 250_000
    assert.equal(bindingCapUsd(['krea-community', 'stability-community']), 250_000)
  } finally {
    CONDITIONAL_CAP_USD['stability-community'] = saved
  }
})

test('bindingCapUsd ignores licenses with no cap entry', () => {
  assert.equal(bindingCapUsd(['apache-2.0', 'krea-community', 'mit']), 1_000_000)
})

// ── activeConditionalLicenses (the public-catalog query, over model views) ───

test('a public/canonical conditional model with a cap is active', () => {
  const models = [{ commercialUse: 'conditional' as const, license: 'krea-community', canonica: true }]
  assert.deepEqual(activeConditionalLicenses(models), ['krea-community'])
})

test('a PRIVATE conditional model does NOT bind (not on the commercial surface)', () => {
  const models = [{ commercialUse: 'conditional' as const, license: 'krea-community', access: 'private' as const, canonica: false }]
  assert.deepEqual(activeConditionalLicenses(models), [])
})

test('a public model with an explicitly public access string binds', () => {
  const models = [{ commercialUse: 'conditional' as const, license: 'stability-community', access: 'public' as const }]
  assert.deepEqual(activeConditionalLicenses(models), ['stability-community'])
})

test('non-conditional models never bind; commercialUse is derived from license when absent', () => {
  const models = [
    { commercialUse: 'yes' as const, license: 'apache-2.0', canonica: true },   // yes → no cap
    { license: 'krea-community', canonica: true },                               // verdict derived → conditional
    { commercialUse: 'no' as const, license: 'flux-1-dev-nc', canonica: true },  // no → never catalog
  ]
  assert.deepEqual(activeConditionalLicenses(models), ['krea-community'])
})

test('distinct licenses are de-duplicated across many models', () => {
  const models = [
    { commercialUse: 'conditional' as const, license: 'krea-community', canonica: true },
    { commercialUse: 'conditional' as const, license: 'krea-community', access: 'public' as const },
    { commercialUse: 'conditional' as const, license: 'stability-community', canonica: true },
  ]
  assert.deepEqual(activeConditionalLicenses(models).sort(), ['krea-community', 'stability-community'])
})
