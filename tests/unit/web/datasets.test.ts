import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gardenSummaryLine,
  isGardenOpen,
  toggleGardenId,
} from '../../../src/platforms/web/app/src/lib/datasets.js'

// ---------------------------------------------------------------------------
// noema-283 — the fragment garden under a media item on the dataset detail
// screen: closed by default, one line summarizing what it holds, a press per
// item opens it. These are the pure rules the screen renders from.
// ---------------------------------------------------------------------------

// Test 1 — a media item's garden starts collapsed, and a press expands it (both sides asserted:
// a revert of the default-collapsed state must fail this as much as a revert of the press does).
test('isGardenOpen: closed by default, open after its id is toggled in', () => {
  const empty = new Set<string>()
  assert.equal(isGardenOpen(empty, 'm-1'), false)

  const afterOpen = toggleGardenId(empty, 'm-1')
  assert.equal(isGardenOpen(afterOpen, 'm-1'), true)
})

// Test 2 — opening one item's garden must not open (or close) any other item's.
test('toggleGardenId: only the pressed item moves, siblings are untouched', () => {
  const withOneOpen = toggleGardenId(new Set<string>(), 'm-1')
  const withBothOpen = toggleGardenId(withOneOpen, 'm-2')

  assert.equal(isGardenOpen(withBothOpen, 'm-1'), true)
  assert.equal(isGardenOpen(withBothOpen, 'm-2'), true)

  const closedM1 = toggleGardenId(withBothOpen, 'm-1')
  assert.equal(isGardenOpen(closedM1, 'm-1'), false)
  assert.equal(isGardenOpen(closedM1, 'm-2'), true, 'closing m-1 must not close m-2')
})

// Test 3 — toggleGardenId never mutates the set it was handed (the screen relies on this to
// re-render off a new reference, same as every other piece of state on this screen).
test('toggleGardenId: returns a new Set, never mutates the input', () => {
  const original = new Set<string>(['m-1'])
  const result = toggleGardenId(original, 'm-2')
  assert.equal(original.has('m-2'), false, 'the input set must be untouched')
  assert.notEqual(result, original)
})

// Test 4 — the summary line: count only, until something is excluded.
test('gardenSummaryLine: count alone when nothing is excluded', () => {
  assert.equal(gardenSummaryLine(1, 0), '1 fragment')
  assert.equal(gardenSummaryLine(5, 0), '5 fragments')
})

// Test 5 — the summary line surfaces the excluded count too, once there is one — this is the
// number a user opening the garden is actually there to manage.
test('gardenSummaryLine: names the excluded count once any fragment is excluded', () => {
  assert.equal(gardenSummaryLine(5, 2), '5 fragments · 2 excluded')
  assert.equal(gardenSummaryLine(1, 1), '1 fragment · 1 excluded')
})

// Test 6 — nothing to summarize when the item carries no fragments; the caller only renders
// this when fragmentCount > 0, so an empty result must not read as a real (zero-fragment) line.
test('gardenSummaryLine: empty string when the item carries no fragments', () => {
  assert.equal(gardenSummaryLine(0, 0), '')
})
