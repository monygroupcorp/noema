import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TimerRegistry } from '../../../../src/allocutio/lexicon/bulletin/TimerRegistry.js'

const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

test('arm fires the callback after the delay', async () => {
  const t = new TimerRegistry()
  let fired = 0
  t.arm('a', 10, () => { fired++ })
  await tick(25)
  assert.equal(fired, 1)
})

test('arm with an existing name replaces the prior timer (no double fire)', async () => {
  const t = new TimerRegistry()
  let fired = 0
  t.arm('a', 10, () => { fired++ })
  t.arm('a', 10, () => { fired++ })   // re-arm same name
  await tick(25)
  assert.equal(fired, 1, 'only the latest timer fires')
})

test('cancel stops a pending timer', async () => {
  const t = new TimerRegistry()
  let fired = 0
  t.arm('a', 10, () => { fired++ })
  t.cancel('a')
  await tick(25)
  assert.equal(fired, 0)
})

test('cancelAll clears every pending timer', async () => {
  const t = new TimerRegistry()
  let fired = 0
  t.arm('a', 10, () => { fired++ })
  t.arm('b', 10, () => { fired++ })
  t.arm('c', 10, () => { fired++ })
  t.cancelAll()
  await tick(25)
  assert.equal(fired, 0)
})

test('a fired timer is forgotten (cancel after fire is a no-op, has() false)', async () => {
  const t = new TimerRegistry()
  t.arm('a', 5, () => {})
  await tick(20)
  assert.equal(t.has('a'), false)
  t.cancel('a')  // must not throw
})

test('has() reflects pending state', () => {
  const t = new TimerRegistry()
  assert.equal(t.has('a'), false)
  t.arm('a', 1000, () => {})
  assert.equal(t.has('a'), true)
  t.cancel('a')
  assert.equal(t.has('a'), false)
})
