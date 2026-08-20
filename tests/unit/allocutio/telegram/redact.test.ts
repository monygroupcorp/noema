import { test } from 'node:test'
import assert from 'node:assert/strict'
import { redactSecrets, redactExtra } from '../../../../src/allocutio/telegram/redact.js'

// A structurally real token shape (id:secret) that has never been a live token.
const FAKE_TOKEN = '1234567890:AAFakeTokenForTestsOnly_ffffffffffff'

test('a resolved file link is rendered as a label, not as its raw contents', () => {
  const leaked = `Here is your image: https://api.telegram.org/file/bot${FAKE_TOKEN}/photos/file_42.jpg`
  const out = redactSecrets(leaked)
  assert.ok(!out.includes(FAKE_TOKEN), 'credential material must not survive')
  assert.ok(!out.includes('api.telegram.org'), 'the whole link goes, not part of it')
  assert.match(out, /\(image\)/)
})

test('bare credential material anywhere in the text is normalised away', () => {
  const out = redactSecrets(`something blew up: ${FAKE_TOKEN} is invalid`)
  assert.ok(!out.includes(FAKE_TOKEN))
  assert.match(out, /\*\*\*/)
})

test('the configured secret is normalised even in an unexpected shape', () => {
  const prev = process.env.BOT_TOKEN
  process.env.BOT_TOKEN = 'shaped-unlike-a-token-but-still-secret'
  try {
    const out = redactSecrets('trace: shaped-unlike-a-token-but-still-secret/oops')
    assert.ok(!out.includes('shaped-unlike-a-token-but-still-secret'))
  } finally {
    if (prev === undefined) delete process.env.BOT_TOKEN
    else process.env.BOT_TOKEN = prev
  }
})

test('ordinary copy passes through untouched', () => {
  const text = 'Unknown command. Type /help to see what’s available.'
  assert.equal(redactSecrets(text), text)
})

test('a caption is scrubbed; the rest of the extra object is left alone', () => {
  const keyboard = { inline_keyboard: [[{ text: 'x', callback_data: 'y' }]] }
  const out = redactExtra({
    caption: `https://api.telegram.org/file/bot${FAKE_TOKEN}/photos/f.jpg`,
    reply_markup: keyboard,
  })
  assert.equal(out.caption, '(image)')
  assert.equal(out.reply_markup, keyboard)
})

test('an extra without a caption is returned as-is', () => {
  const extra = { reply_markup: { inline_keyboard: [] } }
  assert.equal(redactExtra(extra), extra)
})
