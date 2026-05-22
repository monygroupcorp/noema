import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ReactionController } from '../../../../src/allocutio/reactions/ReactionController.js'

function make() {
  const reactions: Array<{ messageId: number; emoji: string }> = []
  const ctl = new ReactionController(
    { react: (_c, messageId, emoji) => reactions.push({ messageId, emoji }) },
    { okDelayMs: 30, fireDelayMs: 10 },
  )
  return { ctl, reactions }
}
const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

test('cold start: a deferred 👌 fires when no warm signal arrives', async () => {
  const { ctl, reactions } = make()
  ctl.register('a1', 456, 50)
  assert.deepEqual(reactions, [], 'not immediate — deferred')
  await tick(50)
  assert.deepEqual(reactions, [{ messageId: 50, emoji: '👌' }])
})

test('warm AFTER register: cancels the deferred 👌, fires 🔥 only', async () => {
  const { ctl, reactions } = make()
  ctl.register('a1', 456, 50)
  ctl.noteWarm('a1')
  await tick(60)   // past both the 🔥 (10) and the 👌 deadline (30)
  assert.deepEqual(reactions, [{ messageId: 50, emoji: '🔥' }], 'only 🔥, never 👌')
})

test('warm BEFORE register: registers straight to 🔥, never schedules 👌', async () => {
  const { ctl, reactions } = make()
  ctl.noteWarm('a1')          // warm signal races ahead
  ctl.register('a1', 456, 50)
  await tick(60)
  assert.deepEqual(reactions, [{ messageId: 50, emoji: '🔥' }])
})

test('clear cancels a pending 👌', async () => {
  const { ctl, reactions } = make()
  ctl.register('a1', 456, 50)
  ctl.clear('a1')
  await tick(50)
  assert.deepEqual(reactions, [])
})

test('no command message → no reaction (but no crash)', async () => {
  const { ctl, reactions } = make()
  ctl.register('a1', 456, undefined)
  ctl.noteWarm('a1')
  await tick(50)
  assert.deepEqual(reactions, [])
})
