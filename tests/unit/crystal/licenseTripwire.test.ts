import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  band,
  evaluateTripwire,
  startLicenseTripwire,
  MemoryTripwireBandStore,
  type OnThresholdBand,
  type ThresholdBand,
  type TripwireContext,
} from '../../../src/crystal/licenseTripwire.js'
import { MemoryRedituum } from '../../../src/ledger/MemoryRedituum.js'
import { USD } from '../../../src/types/reditus.js'

const CAP = 1_000_000n * USD   // $1M in micro-USD
const NOW = new Date('2026-07-02T00:00:00Z')

// ── band() edges ─────────────────────────────────────────────────────────────

test('band: null cap is always clear (dormant — no conditional model active)', () => {
  assert.equal(band(0n, null), 'clear')
  assert.equal(band(CAP * 10n, null), 'clear')
})

test('band: clear/watch edge is exactly 75%', () => {
  assert.equal(band(CAP * 74n / 100n, CAP), 'clear')
  assert.equal(band(CAP * 75n / 100n, CAP), 'watch')   // 0.75 → watch (inclusive lower)
})

test('band: watch/warn edge is exactly 90%', () => {
  assert.equal(band(CAP * 89n / 100n, CAP), 'watch')
  assert.equal(band(CAP * 90n / 100n, CAP), 'warn')
})

test('band: warn/breach edge is exactly 100%', () => {
  assert.equal(band(CAP - 1n, CAP), 'warn')
  assert.equal(band(CAP, CAP), 'breach')               // ≥ cap → breach
  assert.equal(band(CAP * 2n, CAP), 'breach')
})

// ── evaluateTripwire ─────────────────────────────────────────────────────────

/** A minimal fake catalog with a mutable model list. */
function fakeIntellarum(models: unknown[]) {
  return { list: async () => models as never }
}

/** Records `usd` whole-dollars of revenue into a fresh in-window Reditus. */
async function withRevenue(usdWhole: bigint) {
  const redituum = new MemoryRedituum()
  if (usdWhole > 0n) {
    await redituum.record({ usdFmv: usdWhole * USD, fmvSource: 'test', origo: 'crypto', natum: NOW })
  }
  return redituum
}

const KREA_PUBLIC = { commercialUse: 'conditional', license: 'krea-community', canonica: true }

function spyOnBand() {
  const calls: Array<{ prev: ThresholdBand | null; next: ThresholdBand; ctx: TripwireContext }> = []
  const fn: OnThresholdBand = (prev, next, ctx) => { calls.push({ prev, next, ctx }) }
  return { calls, fn }
}

test('dormant: no conditional model active → clear, NO alert', async () => {
  const redituum = await withRevenue(5_000_000n)   // $5M — would breach IF anything bound
  const spy = spyOnBand()
  const r = await evaluateTripwire(
    { redituum, intellarum: fakeIntellarum([]), bandStore: new MemoryTripwireBandStore(), onThresholdBand: spy.fn },
    NOW,
  )
  assert.equal(r.band, 'clear')
  assert.equal(r.bindingCapUsd, null)
  assert.equal(spy.calls.length, 0, 'dormant baseline must not alert')
})

test('booting straight into watch fires one alert (null → watch)', async () => {
  const redituum = await withRevenue(800_000n)      // 80% of $1M
  const spy = spyOnBand()
  const r = await evaluateTripwire(
    { redituum, intellarum: fakeIntellarum([KREA_PUBLIC]), bandStore: new MemoryTripwireBandStore(), onThresholdBand: spy.fn },
    NOW,
  )
  assert.equal(r.band, 'watch')
  assert.equal(r.bindingCapUsd, 1_000_000)
  assert.deepEqual(spy.calls.map(c => [c.prev, c.next]), [[null, 'watch']])
  assert.deepEqual(spy.calls[0].ctx.licenses, ['krea-community'])
})

test('edge-triggered: re-evaluating at the same band does NOT re-alert', async () => {
  const redituum = await withRevenue(800_000n)
  const spy = spyOnBand()
  const store = new MemoryTripwireBandStore()
  const deps = { redituum, intellarum: fakeIntellarum([KREA_PUBLIC]), bandStore: store, onThresholdBand: spy.fn }
  await evaluateTripwire(deps, NOW)
  const second = await evaluateTripwire(deps, NOW)
  assert.equal(second.band, 'watch')
  assert.equal(second.transitioned, false)
  assert.equal(spy.calls.length, 1, 'only the first entry into the band alerts')
})

test('escalation watch → warn → breach each fires exactly once', async () => {
  const spy = spyOnBand()
  const store = new MemoryTripwireBandStore()
  const models = [KREA_PUBLIC]

  // watch (80%)
  await evaluateTripwire({ redituum: await withRevenue(800_000n), intellarum: fakeIntellarum(models), bandStore: store, onThresholdBand: spy.fn }, NOW)
  // warn (92%)
  await evaluateTripwire({ redituum: await withRevenue(920_000n), intellarum: fakeIntellarum(models), bandStore: store, onThresholdBand: spy.fn }, NOW)
  // breach (110%)
  const breach = await evaluateTripwire({ redituum: await withRevenue(1_100_000n), intellarum: fakeIntellarum(models), bandStore: store, onThresholdBand: spy.fn }, NOW)

  assert.equal(breach.band, 'breach')
  assert.deepEqual(spy.calls.map(c => [c.prev, c.next]), [[null, 'watch'], ['watch', 'warn'], ['warn', 'breach']])
})

test('pulling the last conditional model lifts the constraint (warn → clear)', async () => {
  const spy = spyOnBand()
  const store = new MemoryTripwireBandStore()
  const redituum = await withRevenue(920_000n)   // 92%

  // warn while the model is catalog-active
  await evaluateTripwire({ redituum, intellarum: fakeIntellarum([KREA_PUBLIC]), bandStore: store, onThresholdBand: spy.fn }, NOW)
  // model delisted → dormant → clear (same high revenue, but nothing binds)
  const after = await evaluateTripwire({ redituum, intellarum: fakeIntellarum([]), bandStore: store, onThresholdBand: spy.fn }, NOW)

  assert.equal(after.band, 'clear')
  assert.equal(after.bindingCapUsd, null)
  assert.deepEqual(spy.calls.map(c => [c.prev, c.next]), [[null, 'warn'], ['warn', 'clear']])
})

test('startLicenseTripwire evaluates once IMMEDIATELY on boot (catches a breach at deploy)', async () => {
  const spy = spyOnBand()
  const store = new MemoryTripwireBandStore()
  const handle = startLicenseTripwire(
    { redituum: await withRevenue(1_100_000n), intellarum: fakeIntellarum([KREA_PUBLIC]), bandStore: store, onThresholdBand: spy.fn },
    { intervalMs: 60 * 60 * 1000, now: () => NOW },   // long interval → only the boot tick runs
  )
  handle.stop()
  await new Promise(r => setImmediate(r))              // let the fire-and-forget boot tick settle
  assert.deepEqual(spy.calls.map(c => [c.prev, c.next]), [[null, 'breach']])
  assert.equal((await store.last())?.band, 'breach')
})

test('startLicenseTripwire with immediate:false does NOT tick on boot', async () => {
  const spy = spyOnBand()
  const store = new MemoryTripwireBandStore()
  const handle = startLicenseTripwire(
    { redituum: await withRevenue(1_100_000n), intellarum: fakeIntellarum([KREA_PUBLIC]), bandStore: store, onThresholdBand: spy.fn },
    { intervalMs: 60 * 60 * 1000, now: () => NOW, immediate: false },
  )
  handle.stop()
  await new Promise(r => setImmediate(r))
  assert.equal(spy.calls.length, 0)
  assert.equal(await store.last(), null)
})

test('the persisted band survives across store reads (restart-detectable)', async () => {
  const store = new MemoryTripwireBandStore()
  await evaluateTripwire({ redituum: await withRevenue(800_000n), intellarum: fakeIntellarum([KREA_PUBLIC]), bandStore: store }, NOW)
  const persisted = await store.last()
  assert.equal(persisted?.band, 'watch')
  assert.equal(persisted?.bindingCapUsd, 1_000_000)
  assert.equal(persisted?.R, 800_000n * USD)
})
