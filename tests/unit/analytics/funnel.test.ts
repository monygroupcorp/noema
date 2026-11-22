import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeFunnel, DEFAULT_FUNNEL_ORDER } from '../../../src/analytics/funnel.js'

test('first stage is 100% of itself and has no drop', () => {
  const stages = computeFunnel(['a', 'b'], { a: 10, b: 4 })
  assert.equal(stages[0].visitors, 10)
  assert.equal(stages[0].ofStart, 1)
  assert.equal(stages[0].ofPrevious, 1)
  assert.equal(stages[0].droppedHere, 0)
})

test('later stages compute ofStart, ofPrevious and droppedHere correctly', () => {
  const stages = computeFunnel(['a', 'b', 'c'], { a: 100, b: 40, c: 10 })
  assert.deepEqual(stages.map(s => s.visitors), [100, 40, 10])
  assert.equal(stages[1].ofStart, 0.4)
  assert.equal(stages[1].ofPrevious, 0.4)
  assert.equal(stages[1].droppedHere, 60)
  assert.equal(stages[2].ofStart, 0.1)
  assert.equal(stages[2].ofPrevious, 0.25)
  assert.equal(stages[2].droppedHere, 30)
})

test('a stage absent from counts reads as zero, not an error', () => {
  const stages = computeFunnel(['a', 'b'], { a: 5 })
  assert.equal(stages[1].visitors, 0)
  assert.equal(stages[1].droppedHere, 5)
})

test('an empty first stage never divides by zero', () => {
  const stages = computeFunnel(['a', 'b'], { a: 0, b: 0 })
  assert.equal(stages[0].ofStart, 0)
  assert.equal(stages[1].ofStart, 0)
  assert.equal(stages[1].ofPrevious, 0)
})

test('a stage can gain visitors over the previous one — droppedHere clamps at zero, never negative', () => {
  const stages = computeFunnel(['a', 'b'], { a: 5, b: 9 })
  assert.equal(stages[1].droppedHere, 0)
  assert.equal(stages[1].ofPrevious, 9 / 5)
})

test('DEFAULT_FUNNEL_ORDER is the full visitor journey this corpus can see', () => {
  assert.deepEqual(DEFAULT_FUNNEL_ORDER, ['catalog_view', 'quote', 'sign_in', 'funding_attempt', 'run_attempt', 'run_complete'])
})
