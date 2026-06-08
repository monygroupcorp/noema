import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeliveryMenu, type DeliverySink } from '../../../../src/allocutio/lexicon/delivery/DeliveryMenu.js'
import { menuKeyboard, formatStats } from '../../../../src/allocutio/lexicon/delivery/DeliveryView.js'
import type { UiKeyboard } from '../../../../src/allocutio/lexicon/ui/Keyboard.js'
import type { Actum } from '../../../../src/types/actum.js'

function makeSink() {
  const markups: Array<{ messageId: number; kb: UiKeyboard }> = []
  const captions: Array<{ messageId: number; text: string }> = []
  const texts: Array<{ messageId: number; text: string }> = []
  const sink: DeliverySink = {
    async editMarkup(_c, messageId, kb) { markups.push({ messageId, kb }) },
    async editCaption(_c, messageId, text) { captions.push({ messageId, text }) },
    async editText(_c, messageId, text) { texts.push({ messageId, text }) },
  }
  return { sink, markups, captions, texts }
}
const data = (kb: UiKeyboard) => kb.flat().map(b => b.data)

test('menuKeyboard morphs default → rate → wrench', () => {
  assert.deepEqual(data(menuKeyboard('a1', 'default')), ['dm:info:a1', 'dm:rate:a1', 'dm:wrench:a1'])
  assert.deepEqual(data(menuKeyboard('a1', 'rate')), ['dm:rated:a1:beautiful', 'dm:rated:a1:funny', 'dm:rated:a1:negative'])
  assert.deepEqual(data(menuKeyboard('a1', 'wrench')), ['dm:back:a1', 'dm:tweak:a1', 'dm:rerun:a1', 'dm:save:a1'])
})

test('rate/wrench/back morph the row on the tracked message', async () => {
  const s = makeSink()
  const m = new DeliveryMenu({ sink: s.sink, rerun: async () => {} })
  m.track('a1', { chatId: 456, messageId: 77, caption: 'pic', isMedia: true })

  await m.handle('a1', 'rate')
  assert.deepEqual(data(s.markups.at(-1)!.kb), ['dm:rated:a1:beautiful', 'dm:rated:a1:funny', 'dm:rated:a1:negative'])
  assert.equal(s.markups.at(-1)!.messageId, 77)
  await m.handle('a1', 'wrench')
  assert.deepEqual(data(s.markups.at(-1)!.kb), ['dm:back:a1', 'dm:tweak:a1', 'dm:rerun:a1', 'dm:save:a1'])
})

test('rated reflects the glyph on the default row and persists it for back', async () => {
  const s = makeSink()
  const m = new DeliveryMenu({ sink: s.sink, rerun: async () => {} })
  m.track('a1', { chatId: 456, messageId: 77, caption: 'pic', isMedia: true })
  await m.handle('a1', 'rated', { ratedType: 'funny' })
  assert.ok(s.markups.at(-1)!.kb.flat().some(b => b.label === '😹'), 'chosen glyph shown on the rate button')
  await m.handle('a1', 'back')
  assert.ok(s.markups.at(-1)!.kb.flat().some(b => b.label === '😹'), 'back keeps the chosen glyph')
})

test('info toggles caption ↔ stats on a media result', async () => {
  const fakeActum = { modusId: 'runmake.flux', duratio: 12000, executio: { coldStart: false, gpuType: 'RTX 4090' } } as unknown as Actum
  const s = makeSink()
  const m = new DeliveryMenu({ sink: s.sink, acta: { async findById() { return fakeActum } }, rerun: async () => {} })
  m.track('a1', { chatId: 456, messageId: 77, caption: 'my pic', isMedia: true })

  await m.handle('a1', 'info')
  assert.match(s.captions.at(-1)!.text, /Modus: runmake\.flux/, 'shows stats first')
  await m.handle('a1', 'info')
  assert.equal(s.captions.at(-1)!.text, 'my pic', 'toggles back to the caption')
})

test('SECURITY: a dm action from a foreign chat is refused (no cross-chat replay)', async () => {
  const calls: Array<{ actumId: string }> = []
  const s = makeSink()
  const m = new DeliveryMenu({ sink: s.sink, rerun: async (actumId) => { calls.push({ actumId }) } })
  m.track('a1', { chatId: 456, messageId: 77, caption: 'pic', isMedia: true })

  // Attacker in chat 999 crafts dm:rerun:a1 / dm:rate:a1 for a result delivered to 456.
  await m.handle('a1', 'rerun', { presserUserId: '999', chatId: 999 })
  await m.handle('a1', 'rate', { chatId: 999 })
  assert.equal(calls.length, 0, 'foreign-chat rerun is refused')
  assert.equal(s.markups.length, 0, 'foreign-chat morph is refused')

  // Same actumId from its own chat works.
  await m.handle('a1', 'rerun', { presserUserId: '123', chatId: 456 })
  assert.equal(calls.length, 1, 'same-chat rerun is allowed')
})

test('SECURITY: an unknown actumId is a no-op (not in the delivered set)', async () => {
  const s = makeSink()
  const m = new DeliveryMenu({ sink: s.sink, rerun: async () => {} })
  await m.handle('ghost', 'info', { chatId: 456 })
  await m.handle('ghost', 'rate', { chatId: 456 })
  assert.equal(s.markups.length + s.captions.length + s.texts.length, 0)
})

test('rerun/tweak invoke the rerun callback with the presser', async () => {
  const calls: Array<{ actumId: string; presser: string }> = []
  const m = new DeliveryMenu({ sink: makeSink().sink, rerun: async (actumId, presser) => { calls.push({ actumId, presser }) } })
  m.track('a1', { chatId: 456, messageId: 77, caption: '', isMedia: false })
  await m.handle('a1', 'rerun', { presserUserId: '999' })
  await m.handle('a1', 'tweak', { presserUserId: '999' })
  assert.deepEqual(calls, [{ actumId: 'a1', presser: '999' }, { actumId: 'a1', presser: '999' }])
})

test('formatStats is pure and handles a missing actum', () => {
  assert.equal(formatStats(null), 'Stats unavailable.')
})
