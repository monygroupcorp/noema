import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cycleKey, isoYearWeek } from '../../../src/crystal/subsidyCycle.js'

test('isoYearWeek handles the year-boundary (2026-01-01 is ISO week 1 of 2026)', () => {
  assert.deepEqual(isoYearWeek(new Date('2026-01-01T00:00:00Z')), { year: 2026, week: 1 })
  // 2025-12-29 (Mon) belongs to ISO week 1 of 2026.
  assert.deepEqual(isoYearWeek(new Date('2025-12-29T00:00:00Z')), { year: 2026, week: 1 })
})

test('weekly cycle keys differ across ISO weeks, match within one', () => {
  const a = cycleKey('weekly', new Date('2026-07-01T00:00:00Z'))
  const aSame = cycleKey('weekly', new Date('2026-07-03T23:00:00Z'))
  const b = cycleKey('weekly', new Date('2026-07-08T00:00:00Z'))
  assert.equal(a, aSame, 'same ISO week → same key')
  assert.notEqual(a, b, 'next ISO week → different key')
  assert.match(a, /^\d{4}-W\d{2}$/)
})

test('biweekly folds two ISO weeks into one fortnight key', () => {
  const w1 = cycleKey('biweekly', new Date('2026-01-01T00:00:00Z')) // week 1 → F01
  const w2 = cycleKey('biweekly', new Date('2026-01-08T00:00:00Z')) // week 2 → F01
  const w3 = cycleKey('biweekly', new Date('2026-01-15T00:00:00Z')) // week 3 → F02
  assert.equal(w1, w2, 'weeks 1 & 2 share a fortnight')
  assert.notEqual(w2, w3)
  assert.match(w1, /^\d{4}-F\d{2}$/)
})

test('monthly cycle key is year-month', () => {
  assert.equal(cycleKey('monthly', new Date('2026-07-15T00:00:00Z')), '2026-M07')
  assert.notEqual(cycleKey('monthly', new Date('2026-07-31T23:59:59Z')), cycleKey('monthly', new Date('2026-08-01T00:00:00Z')))
})
