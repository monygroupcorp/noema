import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryRedituum } from '../../../src/ledger/MemoryRedituum.js'
import { USD } from '../../../src/types/reditus.js'

// Reditus — the USD revenue book (ADR-0013 §2/§5, docs/spec/conditional-license-revenue.md).
// The load-bearing property is FAIL-CLOSED: no inbound payment is recorded without a priced
// usdFmv AND a logged fmvSource. These tests are the "no deposit without a USD FMV + price
// source" assertion ADR-0013 §consequences requires.

// ── fail-closed FMV stamp ─────────────────────────────────────────────────────

test('record: rejects a deposit with no usdFmv', async () => {
  const r = new MemoryRedituum()
  await assert.rejects(
    // @ts-expect-error — omitting usdFmv is the exact misuse the invariant guards
    () => r.record({ fmvSource: 'coingecko@block-19000000', origo: 'crypto' }),
    /fail-closed: usdFmv/,
  )
})

test('record: rejects a zero usdFmv (could-not-price is not a silent zero)', async () => {
  const r = new MemoryRedituum()
  await assert.rejects(
    () => r.record({ usdFmv: 0n, fmvSource: 'coingecko@block', origo: 'crypto' }),
    /fail-closed: usdFmv/,
  )
})

test('record: rejects a negative usdFmv', async () => {
  const r = new MemoryRedituum()
  await assert.rejects(
    () => r.record({ usdFmv: -1n * USD, fmvSource: 'stripe:ch_123', origo: 'fiat' }),
    /fail-closed: usdFmv/,
  )
})

test('record: rejects a missing fmvSource', async () => {
  const r = new MemoryRedituum()
  await assert.rejects(
    // @ts-expect-error — omitting fmvSource is the second half of the invariant
    () => r.record({ usdFmv: 50n * USD, origo: 'crypto' }),
    /fail-closed: fmvSource/,
  )
})

test('record: rejects an empty / whitespace fmvSource', async () => {
  const r = new MemoryRedituum()
  await assert.rejects(
    () => r.record({ usdFmv: 50n * USD, fmvSource: '   ', origo: 'fiat' }),
    /fail-closed: fmvSource/,
  )
})

// ── the happy path, incl. anonymous-in-aggregate (§7) ─────────────────────────

test('record: a fully-priced crypto deposit is struck with an id and receipt time', async () => {
  const r = new MemoryRedituum()
  const natum = new Date('2026-01-15T00:00:00Z')
  const rec = await r.record({ usdFmv: 250n * USD, fmvSource: 'chainlink-eth-usd@block-21000000', origo: 'crypto', natum })
  assert.ok(rec.id)
  assert.equal(rec.usdFmv, 250n * USD)
  assert.equal(rec.origo, 'crypto')
  assert.equal(rec.natum.getTime(), natum.getTime())
})

test('record: anonymous deposits carry NO identity but still land in the top line (§7)', async () => {
  const r = new MemoryRedituum()
  // There is no identity field to supply — anonymity limits per-user reporting, not the total.
  const rec = await r.record({ usdFmv: 40n * USD, fmvSource: 'bursa-anon@block', origo: 'crypto' })
  assert.ok(rec.id)
  assert.equal(rec.usdFmv, 40n * USD)
  assert.deepEqual(Object.keys(rec).sort(), ['fmvSource', 'id', 'natum', 'origo', 'usdFmv'])
})

// ── idempotency on depositumId (webhook re-delivery must not double-count) ─────

test('record: is idempotent on depositumId — re-delivery returns the same row, no double-count', async () => {
  const r = new MemoryRedituum()
  const now = new Date('2026-07-01T00:00:00Z')
  const first = await r.record({ usdFmv: 100n * USD, fmvSource: 'chainlink@block-21000000', origo: 'crypto', depositumId: 'dep-1', natum: now })
  const again = await r.record({ usdFmv: 100n * USD, fmvSource: 'chainlink@block-21000000', origo: 'crypto', depositumId: 'dep-1', natum: now })
  assert.equal(again.id, first.id)                                  // same row, not a new one
  assert.equal(await r.trailingUsdRevenue(now), 100n * USD)         // counted exactly once
})

test('record: distinct depositumIds are distinct rows; fiat rows (no depositumId) always append', async () => {
  const r = new MemoryRedituum()
  const now = new Date('2026-07-01T00:00:00Z')
  const a = await r.record({ usdFmv: 10n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'dep-a', natum: now })
  const b = await r.record({ usdFmv: 10n * USD, fmvSource: 'o', origo: 'crypto', depositumId: 'dep-b', natum: now })
  const f1 = await r.record({ usdFmv: 10n * USD, fmvSource: 'stripe:ch_1', origo: 'fiat', natum: now })
  const f2 = await r.record({ usdFmv: 10n * USD, fmvSource: 'stripe:ch_2', origo: 'fiat', natum: now })
  assert.equal(new Set([a.id, b.id, f1.id, f2.id]).size, 4)         // all four distinct
  assert.equal(await r.trailingUsdRevenue(now), 40n * USD)
})

test('record: natum defaults to now when the caller omits the receipt time', async () => {
  const r = new MemoryRedituum()
  const before = Date.now()
  const rec = await r.record({ usdFmv: 5n * USD, fmvSource: 'stripe:ch_abc', origo: 'fiat' })
  assert.ok(rec.natum.getTime() >= before)
})

// ── trailing-12-month rollup (§5) ─────────────────────────────────────────────

test('trailingUsdRevenue: sums gross usdFmv across sources over the window', async () => {
  const r = new MemoryRedituum()
  const now = new Date('2026-07-01T00:00:00Z')
  await r.record({ usdFmv: 100n * USD, fmvSource: 'o', origo: 'crypto', natum: new Date('2026-06-01T00:00:00Z') })
  await r.record({ usdFmv: 250n * USD, fmvSource: 'o', origo: 'fiat',   natum: new Date('2026-02-01T00:00:00Z') })
  await r.record({ usdFmv: 999n * USD, fmvSource: 'o', origo: 'crypto', natum: new Date('2026-06-30T23:59:00Z') })
  assert.equal(await r.trailingUsdRevenue(now), 1349n * USD)
})

test('trailingUsdRevenue: excludes receipts older than 12 months', async () => {
  const r = new MemoryRedituum()
  const now = new Date('2026-07-01T00:00:00Z')
  await r.record({ usdFmv: 500n * USD, fmvSource: 'o', origo: 'crypto', natum: new Date('2025-06-01T00:00:00Z') }) // >12mo → out
  await r.record({ usdFmv: 700n * USD, fmvSource: 'o', origo: 'crypto', natum: new Date('2025-08-01T00:00:00Z') }) // <12mo → in
  assert.equal(await r.trailingUsdRevenue(now), 700n * USD)
})

test('trailingUsdRevenue: excludes future-dated receipts (clock skew) and is 0 when empty', async () => {
  const r = new MemoryRedituum()
  const now = new Date('2026-07-01T00:00:00Z')
  assert.equal(await r.trailingUsdRevenue(now), 0n)
  await r.record({ usdFmv: 42n * USD, fmvSource: 'o', origo: 'fiat', natum: new Date('2026-08-01T00:00:00Z') })
  assert.equal(await r.trailingUsdRevenue(now), 0n)
})
