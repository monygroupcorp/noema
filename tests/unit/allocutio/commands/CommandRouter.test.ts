import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CommandRouter } from '../../../../src/allocutio/telegram/commands/CommandRouter.js'

function make(extra?: { flows?: () => Promise<string[]> }) {
  const calls: Record<string, unknown[]> = { enter: [], cancel: [], msg: [], start: [], ack: [], shareToken: [], arm: [] }
  const router = new CommandRouter({
    enterExecute: async (userId, state) => { calls.enter.push({ userId, state }) },
    cancel: (userId) => { calls.cancel.push(userId) },
    sendMessage: async (chatId, text) => { calls.msg.push({ chatId, text }) },
    sendStart: async (chatId) => { calls.start.push(chatId) },
    ack: (chatId, messageId) => { calls.ack.push({ chatId, messageId }) },
    setPendingShareToken: (userId, token) => { calls.shareToken.push({ userId, token }) },
    arm: (userId, chatId) => { calls.arm.push({ userId, chatId }) },
    ...(extra?.flows ? { flows: extra.flows } : {}),
  })
  return { router, calls }
}

test('/make parses the prompt and enters execute prefilled (no ack)', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/make a red fox', 50)
  assert.deepEqual(calls.enter, [{ userId: 'u1', state: { modusId: 'flux-schnell', aditus: { prompt: 'a red fox' }, browsePageIndex: 0 } }])
  assert.equal(calls.ack.length, 0, '/make ack is owned by the Stream reaction')
})

test('/make with no prompt enters with empty aditus', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/make', 50)
  assert.deepEqual((calls.enter[0] as { state: { aditus: object } }).state.aditus, {})
})

test('/chat and /flows enter execute and ack', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/chat', 50)
  await router.dispatch('u1', 456, '/flows', 51)
  assert.equal((calls.enter[0] as { state: { modusId: string } }).state.modusId, 'modus.chatgpt')
  assert.equal((calls.enter[1] as { state?: unknown }).state, undefined, '/flows enters with no prefilled state')
  assert.equal(calls.ack.length, 2)
})

test('/start sends the start screen and acks', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/start', 50)
  assert.deepEqual(calls.start, [456])
  assert.deepEqual(calls.ack, [{ chatId: 456, messageId: 50 }])
})

test('/cancel clears the flow and confirms', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/cancel')
  assert.deepEqual(calls.cancel, ['u1'])
  assert.match((calls.msg[0] as { text: string }).text, /Cancelled/)
})

test('/start pod_<token> stashes a valid share token; sends the start screen', async () => {
  const { router, calls } = make()
  // 16-char base32-ish token (matches mintShareToken() format).
  await router.dispatch('u1', 456, '/start pod_abcdefghjkmnpqrs', 50)
  assert.deepEqual(calls.shareToken, [{ userId: 'u1', token: 'abcdefghjkmnpqrs' }])
  assert.equal(calls.start.length, 1, 'start screen still shown')
})

test('/start with a malformed share-token deep link is ignored (no stash)', async () => {
  const { router, calls } = make()
  // Wrong prefix:
  await router.dispatch('u1', 456, '/start hello', 50)
  // Wrong length:
  await router.dispatch('u1', 456, '/start pod_short', 50)
  // Bad chars (uppercase / look-alikes):
  await router.dispatch('u1', 456, '/start pod_ABCDEFGHJKMNPQRS', 50)
  await router.dispatch('u1', 456, '/start pod_il0123456789abcd', 50)
  assert.equal(calls.shareToken.length, 0, 'no malformed token reaches setPendingShareToken')
  assert.equal(calls.start.length, 4, 'each /start still sends the start screen')
})

test('@botname suffix and casing are tolerated; unknown → help hint', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/MAKE@noema_bot a cat', 50)
  assert.equal(calls.enter.length, 1, 'case + @suffix still routes /make')
  await router.dispatch('u1', 456, '/frobnicate')
  assert.match((calls.msg.at(-1) as { text: string }).text, /Unknown command/)
})

test('/arm opens the standalone Mod • menu and acks', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/arm', 50)
  assert.deepEqual(calls.arm, [{ userId: 'u1', chatId: 456 }])
  assert.equal(calls.ack.length, 1)
})

test('/run <slug> <prompt> runs the named flow with the prompt (no ack)', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/run flux-schnell a cat', 50)
  assert.deepEqual(calls.enter, [{ userId: 'u1', state: { modusId: 'flux-schnell', aditus: { prompt: 'a cat' }, browsePageIndex: 0 } }])
  assert.equal(calls.ack.length, 0, '/run ack is owned by the Stream reaction')
})

test('/run <slug> with no prompt runs the flow with empty aditus', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/run sd1-5', 50)
  assert.deepEqual(calls.enter, [{ userId: 'u1', state: { modusId: 'sd1-5', aditus: {}, browsePageIndex: 0 } }])
  assert.equal(calls.ack.length, 0)
})

test('/make is unchanged — still runs the bound default', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/make a fox', 50)
  assert.deepEqual(calls.enter, [{ userId: 'u1', state: { modusId: 'flux-schnell', aditus: { prompt: 'a fox' }, browsePageIndex: 0 } }])
})

test('bare /run sends usage and does not enter execute', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/run', 50)
  assert.equal(calls.enter.length, 0, 'bare /run never dispatches a run')
  assert.match((calls.msg.at(-1) as { text: string }).text, /Usage: \/run/)
})

test('/run with an invalid slug shape sends usage, no enter', async () => {
  const { router, calls } = make()
  await router.dispatch('u1', 456, '/run Bad.Slug', 50)
  assert.equal(calls.enter.length, 0)
  assert.match((calls.msg.at(-1) as { text: string }).text, /Usage: \/run/)
})

test('/run with a flows dep rejects an unknown flow, no enter', async () => {
  const { router, calls } = make({ flows: async () => ['flux-schnell', 'sd1-5'] })
  await router.dispatch('u1', 456, '/run nope', 50)
  assert.equal(calls.enter.length, 0)
  assert.match((calls.msg.at(-1) as { text: string }).text, /Unknown flow 'nope'/)
})
