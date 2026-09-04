import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONDITIONAL_CAP_USD,
  conditionalCapUsd,
  bindingCapUsd,
  activeConditionalLicenses,
  classifyModelLicense,
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

// ── classifyModelLicense — the fallback-chain priority order ─────────────────
// docs/spec/model-base-provenance.md §2/§5: baseModel > provenance.base > nomen > familia.

test('classifyModelLicense: baseModel wins over provenance.base, nomen, and familia', () => {
  const m = {
    baseModel: 'black-forest-labs/FLUX.2-klein-base-4B',   // resolved training-time descriptor
    provenance: { base: 'FLUX.1-dev' },                     // different, external retrain lineage
    nomen: 'some trigger word',
    familia: 'flux2',
  }
  assert.deepEqual(classifyModelLicense(m), { license: 'apache-2.0', commercialUse: 'yes' })
})

test('classifyModelLicense: absent baseModel falls back to provenance.base', () => {
  const m = { provenance: { base: 'FLUX.1-dev' }, nomen: 'some trigger word', familia: 'flux' }
  assert.deepEqual(classifyModelLicense(m), { license: 'flux-1-dev-nc', commercialUse: 'no' })
})

test('classifyModelLicense: absent baseModel and provenance falls back to nomen', () => {
  const m = { nomen: 'FLUX.1 Schnell (fp8 scaled)', familia: 'flux' }
  assert.deepEqual(classifyModelLicense(m), { license: 'apache-2.0', commercialUse: 'yes' })
})

test('classifyModelLicense: an empty baseModel string is skipped, not treated as present', () => {
  // `baseModel: ''` must fall through exactly like `baseModel` being absent — a falsy override
  // must never shadow a real provenance.base/nomen/familia answer underneath it.
  const m = { baseModel: '', provenance: { base: 'FLUX.1-dev' }, familia: 'flux' }
  assert.deepEqual(classifyModelLicense(m), { license: 'flux-1-dev-nc', commercialUse: 'no' })
})

test('classifyModelLicense: the brutalite shape (familia only, no baseModel/provenance) still fails closed to unknown', () => {
  // Reproduces the exact pre-fix record shape (docs/spec/model-base-provenance.md, trigger):
  // familia:'flux2', no provenance, nomen = the trigger word (matches nothing in BASE_TABLE), and
  // no baseModel (the record predates this fix). Must still resolve to 'unknown' — this is the
  // fail-closed behaviour a legacy record keeps until it's backfilled or manually cleared; it's
  // NOT something a NEW record produced by trainingFinalizer.ts should reach any more.
  const m = { familia: 'flux2', nomen: 'brutalite' }
  assert.deepEqual(classifyModelLicense(m), { license: 'unknown', commercialUse: 'unknown' })
})
