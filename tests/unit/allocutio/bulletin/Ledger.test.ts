import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Ledger } from '../../../../src/allocutio/lexicon/bulletin/Ledger.js'

test('empty ledger has no gens and zeroed summary', () => {
  const l = new Ledger()
  const s = l.summary()
  assert.equal(s.genCount, 0)
  assert.equal(s.totalCostUsd, 0)
  assert.equal(s.avgCostUsd, 0)
  assert.equal(s.avgExecMs, 0)
})

test('records gens and totals cost + exec', () => {
  const l = new Ledger()
  l.record({ costUsd: 0.08, execMs: 12_000 })
  l.record({ costUsd: 0.004, execMs: 10_000 })
  const s = l.summary()
  assert.equal(s.genCount, 2)
  assert.equal(Number(s.totalCostUsd.toFixed(3)), 0.084)
  assert.equal(s.avgCostUsd, 0.042)
  assert.equal(s.avgExecMs, 11_000)
})

test('averages divide by the metric\'s OWN count, not genCount (no understatement)', () => {
  // Two gens, but only one reported cost. avg must be over the 1 cost sample,
  // not 0.08/2 = 0.04 (the old divisor bug).
  const l = new Ledger()
  l.record({ costUsd: 0.08, execMs: 12_000 })
  l.record({ execMs: 8_000 })   // a gen with no cost datum
  const s = l.summary()
  assert.equal(s.genCount, 2)
  assert.equal(s.totalCostUsd, 0.08)
  assert.equal(s.avgCostUsd, 0.08, 'avg cost over the 1 gen that reported it')
  assert.equal(s.avgExecMs, 10_000, 'avg exec over both gens')
})

test('flags whether cost/exec data is present', () => {
  const l = new Ledger()
  l.record({ execMs: 9_000 })
  const s = l.summary()
  assert.equal(s.hasCost, false)
  assert.equal(s.hasExec, true)
})
