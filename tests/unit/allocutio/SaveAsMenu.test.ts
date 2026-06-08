import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SaveAsMenu, slugify, type SaveAsSink } from '../../../src/allocutio/telegram/SaveAsMenu.js'
import type { Modorum, Modus } from '../../../src/types/modus.js'

const BASE: Modus = {
  id: 'sd1-5',
  nomen: 'SD1.5',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: 'h',
  ministerium: 'runpod',
  canonica: true,
  intellae: [{ id: 'intella.sd15-v1-5', role: 'checkpoint' }],
  aditus: {
    prompt: { type: 'text', required: true },
    steps:  { type: 'int', required: false, default: 20 },
  },
  exitus: { image: { type: 'image' } },
  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

function makeSink() {
  const sent: Array<{ chatId: number; text: string; extra?: unknown }> = []
  const edited: Array<{ chatId: number; messageId: number; text: string }> = []
  let nextId = 100
  const sink: SaveAsSink = {
    async sendMessage(chatId, text, extra) { sent.push({ chatId, text, extra }); return { message_id: nextId++ } },
    async editMessageText(chatId, messageId, text) { edited.push({ chatId, messageId, text }) },
    async deleteMessage() {},
  }
  return { sink, sent, edited }
}

function makeModorum(opts: { existing?: Set<string> } = {}) {
  const existing = opts.existing ?? new Set<string>()
  const registered: Modus[] = []
  const modorum: Modorum = {
    async find(id) { return id === BASE.id ? BASE : (existing.has(id) ? { ...BASE, id } : null) },
    async register(m) { registered.push(m) },
    async list() { return [] },
    async update() { throw new Error('not used') },
  }
  return { modorum, registered }
}

const SEED = { baseModusId: 'sd1-5', aditus: { prompt: 'a red fox', steps: 8 } }

test('slugify lowercases, dashes, and rejects empty', () => {
  assert.equal(slugify('My DooDoo'), 'my-doodoo')
  assert.equal(slugify('  Flux  Schnell '), 'flux-schnell')
  assert.equal(slugify('!!!'), null)
  assert.equal(slugify(''), null)
})

test('open posts the force-reply name prompt; returns false when base missing', async () => {
  const s = makeSink()
  const { modorum } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })

  assert.equal(await menu.open(10, 'u1', SEED), true)
  assert.equal(s.sent.length, 1)
  assert.deepEqual((s.sent[0].extra as { reply_markup?: unknown }).reply_markup, { force_reply: true })

  assert.equal(await menu.open(10, 'u1', { ...SEED, baseModusId: 'nope' }), false)
})

test('a fresh slug → derive + register called with the built Modus', async () => {
  const s = makeSink()
  const { modorum, registered } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'anima-7' }) })

  await menu.open(10, 'u1', SEED)
  const promptId = s.sent[0].extra ? 100 : 100  // first message_id
  // Reply with the chosen name → renders the review (a new message with sa: keyboard).
  const took = await menu.takeReply(promptId, 10, 'u1', 'My DooDoo')
  assert.equal(took, true)
  const reviewMsg = s.sent.at(-1)!
  const reviewId = 101

  // Tap Save → collision check (none) → register the derived modus.
  await menu.handle(reviewId, 'save', 10, 'u1')
  assert.equal(registered.length, 1)
  const m = registered[0]
  assert.equal(m.id, 'my-doodoo')
  assert.equal(m.canonica, false)
  assert.deepEqual(m.auctor, { animaId: 'anima-7' })
  assert.equal(m.fonte, 'sd1-5')
  assert.match(reviewMsg.text, /my-doodoo/)
})

test('duplicate slug → "name taken", NO register', async () => {
  const s = makeSink()
  const { modorum, registered } = makeModorum({ existing: new Set(['my-doodoo']) })
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })

  await menu.open(10, 'u1', SEED)
  await menu.takeReply(100, 10, 'u1', 'My DooDoo')
  await menu.handle(101, 'save', 10, 'u1')

  assert.equal(registered.length, 0)
  assert.match(s.edited.at(-1)!.text, /taken/i)
})

test('prompt-mode toggle flips open ↔ pinned (re-renders the review)', async () => {
  const s = makeSink()
  const { modorum, registered } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })

  await menu.open(10, 'u1', SEED)
  await menu.takeReply(100, 10, 'u1', 'pinme')
  await menu.handle(101, 'toggle', 10, 'u1')  // open → pinned
  await menu.handle(101, 'save', 10, 'u1')

  // pinned → the prompt Porta carries the captured prompt as its default.
  assert.equal(registered[0].aditus.prompt.default, 'a red fox')
})

test('setting a suffix → derived prompt Porta carries the suffixum; placeholder copy gone', async () => {
  const s = makeSink()
  const { modorum, registered } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })

  await menu.open(10, 'u1', SEED)
  await menu.takeReply(100, 10, 'u1', 'styled')   // review at message_id 101
  // Tap "Set suffix" → posts a force-reply prompt (next message_id 102).
  await menu.handle(101, 'suffix', 10, 'u1')
  const affixPrompt = s.sent.at(-1)!
  assert.deepEqual((affixPrompt.extra as { reply_markup?: unknown }).reply_markup, { force_reply: true })
  // Reply to that prompt with the suffix text → re-renders the review.
  const took = await menu.takeAffixReply(102, 10, 'u1', 'watercolor, masterpiece')
  assert.equal(took, true)

  await menu.handle(101, 'save', 10, 'u1')
  assert.equal(registered.length, 1)
  assert.equal(registered[0].aditus.prompt.suffixum, 'watercolor, masterpiece')

  // The "coming soon" placeholder copy is gone everywhere.
  const allText = [...s.sent.map(m => m.text), ...s.edited.map(m => m.text)].join('\n')
  assert.doesNotMatch(allText, /coming soon/i)
})

test('affix reply "-" clears the affix', async () => {
  const s = makeSink()
  const { modorum, registered } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })

  await menu.open(10, 'u1', SEED)
  await menu.takeReply(100, 10, 'u1', 'styled')
  await menu.handle(101, 'prefix', 10, 'u1')
  await menu.takeAffixReply(102, 10, 'u1', 'masterpiece')
  await menu.handle(101, 'prefix', 10, 'u1')          // prompt id 103
  await menu.takeAffixReply(103, 10, 'u1', '-')        // clear

  await menu.handle(101, 'save', 10, 'u1')
  assert.equal(registered[0].aditus.prompt.praefixum, undefined)
})

test('invalid name → badName reply, no review, no register', async () => {
  const s = makeSink()
  const { modorum, registered } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })

  await menu.open(10, 'u1', SEED)
  const took = await menu.takeReply(100, 10, 'u1', '!!!')
  assert.equal(took, true)
  assert.match(s.sent.at(-1)!.text, /can't use|cannot use|characters/i)
  assert.equal(registered.length, 0)
})

test('takeReply ignores replies to a foreign message / wrong user', async () => {
  const s = makeSink()
  const { modorum } = makeModorum()
  const menu = new SaveAsMenu({ sink: s.sink, modorum, resolveOwner: async () => ({ animaId: 'a' }) })
  await menu.open(10, 'u1', SEED)
  assert.equal(await menu.takeReply(999, 10, 'u1', 'x'), false)     // not our prompt
  assert.equal(await menu.takeReply(100, 10, 'other', 'x'), false)  // wrong user
})
