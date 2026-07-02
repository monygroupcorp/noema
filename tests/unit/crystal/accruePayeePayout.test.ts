import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryMerces } from '../../../src/crystal/MemoryMerces.js'
import {
  accruePayeePayout, agentCutMicro, bandFor,
  REPORTABLE_THRESHOLD_MICRO_USD, type AccruePayeeDeps,
} from '../../../src/crystal/accruePayeePayout.js'
import type { Anima, AnimaStore } from '../../../src/types/anima.js'

// A minimal find-or-create-by-custos AnimaStore — one Anima per wallet, as the real store.
function fakeAnimae(): Pick<AnimaStore, 'findByCustos' | 'create'> {
  const byCustos = new Map<string, Anima>()
  let n = 0
  return {
    async findByCustos(custos) { return byCustos.get(custos) ?? null },
    async create(input) {
      const a = { ...input, id: `anima-${++n}`, natum: new Date(), mutatum: new Date() } as Anima
      if (a.custos) byCustos.set(a.custos, a)
      return a
    },
  }
}

const OWNER = '0x' + 'a'.repeat(40)
const AT = new Date('2026-03-01T00:00:00Z')

function deps(over: Partial<AccruePayeeDeps> = {}): AccruePayeeDeps & { mercedum: MemoryMerces } {
  const mercedum = new MemoryMerces()
  return { mercedum, animae: fakeAnimae(), ...over }
}

// ── the margin math (the owner's rule: caller pays price, we serve at cost, agent gets the rest) ──

test('agentCutMicro: take = (price − serveCost) − 20% fee', () => {
  // price 404400 micro-USD; serve = 1000 impetus × 337 = 337000; margin = 67400; fee 20% = 13480.
  assert.equal(agentCutMicro(404400n, 1000n), 53920n)
})

test('agentCutMicro: price at/below serve cost → zero take (no payout)', () => {
  assert.equal(agentCutMicro(337000n, 1000n), 0n)   // exactly cost
  assert.equal(agentCutMicro(300000n, 1000n), 0n)   // below cost
})

test('agentCutMicro: custom fee bps', () => {
  assert.equal(agentCutMicro(404400n, 1000n, 0n), 67400n)      // no fee → whole margin
  assert.equal(agentCutMicro(404400n, 1000n, 10000n), 0n)      // 100% fee → nothing to agent
})

// ── the gate ──────────────────────────────────────────────────────────────────

test('below the $600 line → payable', async () => {
  const d = deps()
  const out = await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 100_000_000n, fmvSource: 'x402', sourceRef: 'e1', kind: 'agent', at: AT })
  assert.equal(out.status, 'accrued')
  if (out.status !== 'accrued') return
  assert.equal(out.gated, false)
  assert.equal(out.merces.status, 'payable')
  assert.equal(out.annualTotal, 100_000_000n)
})

test('crossing $600 with no tax docs → GATED (held) + band fires', async () => {
  const bands: string[] = []
  const d = deps({ onBand: (ev) => bands.push(ev.band) })
  await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 550_000_000n, fmvSource: 'x402', sourceRef: 'e1', kind: 'agent', at: AT }) // $550 ≥ $540 → watch
  const out = await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 200_000_000n, fmvSource: 'x402', sourceRef: 'e2', kind: 'agent', at: AT }) // → $750 ≥ $600
  assert.equal(out.status, 'accrued')
  if (out.status !== 'accrued') return
  assert.equal(out.gated, true)
  assert.equal(out.merces.status, 'gated')
  assert.equal(out.annualTotal, 750_000_000n)
  assert.deepEqual(bands, ['watch', 'reportable'])   // one band emit per crossing
})

test('crossing $600 WITH tax docs on file → payable (not gated)', async () => {
  const d = deps({ hasTaxDocs: async () => true })
  const out = await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 700_000_000n, fmvSource: 'x402', sourceRef: 'e1', kind: 'agent', at: AT })
  assert.equal(out.status, 'accrued')
  if (out.status !== 'accrued') return
  assert.equal(out.gated, false)
  assert.equal(out.merces.status, 'payable')
})

test('idempotent on sourceRef: a re-settled payment does not double-accrue or re-fire the band', async () => {
  const bands: string[] = []
  const d = deps({ onBand: (ev) => bands.push(ev.band) })
  const first = await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 700_000_000n, fmvSource: 'x402', sourceRef: 'same', kind: 'agent', at: AT })
  const again = await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 700_000_000n, fmvSource: 'x402', sourceRef: 'same', kind: 'agent', at: AT })
  assert.equal(first.status, 'accrued'); assert.equal(again.status, 'accrued')
  if (first.status !== 'accrued' || again.status !== 'accrued') return
  assert.equal(again.merces.id, first.merces.id)          // same row
  assert.equal(again.annualTotal, 700_000_000n)           // not doubled
  assert.deepEqual(bands, ['reportable'])                 // fired once, not twice
})

test('per-year reset: a payout in a new calendar year starts the payee fresh', async () => {
  const d = deps()
  await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 500_000_000n, fmvSource: 'x402', sourceRef: 'y2025', kind: 'agent', at: new Date('2025-12-31T00:00:00Z') })
  const y2026 = await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 100_000_000n, fmvSource: 'x402', sourceRef: 'y2026', kind: 'agent', at: new Date('2026-01-01T00:00:00Z') })
  assert.equal(y2026.status, 'accrued')
  if (y2026.status !== 'accrued') return
  assert.equal(y2026.annualTotal, 100_000_000n)           // 2026 total, not 600M
})

test('skips a non-positive take and an invalid payout address', async () => {
  const d = deps()
  assert.equal((await accruePayeePayout(d, { payoutAddress: OWNER, usdMicro: 0n, fmvSource: 'x402', sourceRef: 'z', kind: 'agent' })).status, 'skipped')
  assert.equal((await accruePayeePayout(d, { payoutAddress: 'not-an-address', usdMicro: 100n, fmvSource: 'x402', sourceRef: 'z2', kind: 'agent' })).status, 'skipped')
})

test('bandFor thresholds', () => {
  assert.equal(bandFor(0n), 'clear')
  assert.equal(bandFor(539_999_999n), 'clear')
  assert.equal(bandFor(540_000_000n), 'watch')
  assert.equal(bandFor(REPORTABLE_THRESHOLD_MICRO_USD), 'reportable')
})
