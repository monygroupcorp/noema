import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderPrimitive, decodeCallbackData } from '../../../../src/allocutio/telegram/telegramRender.js'
import type { Primitive } from '../../../../src/flow/types.js'

// ---------------------------------------------------------------------------
// Form card (TASK-004)
// ---------------------------------------------------------------------------

function cardForm(values: Record<string, unknown>): Primitive {
  return {
    kind: 'Form',
    label: 'Configure Test Tool',
    fields: [
      { key: 'prompt', label: 'The prompt', type: 'text', required: true },
      { key: 'steps', label: 'Steps', type: 'int', required: false, default: 20 },
    ],
    values,
  }
}

test('Form card lists every field with current/default value + required marker', () => {
  const r = renderPrimitive(cardForm({}))
  assert.match(r.text, /The prompt/)
  assert.match(r.text, /\[required\]/)
  assert.match(r.text, /Steps/)
  // steps has a default of 20 → shown
  assert.match(r.text, /20/)
})

test('Form card has an edit button per field', () => {
  const r = renderPrimitive(cardForm({}))
  const datas = r.extra!.reply_markup!.inline_keyboard.flat().map(b => b.callback_data)
  assert.ok(datas.includes('a:edit_prompt'), 'edit button for prompt')
  assert.ok(datas.includes('a:edit_steps'), 'edit button for steps')
})

test('Form card hides Execute while a required field is unfilled', () => {
  const r = renderPrimitive(cardForm({}))
  const datas = r.extra!.reply_markup!.inline_keyboard.flat().map(b => b.callback_data)
  assert.ok(!datas.includes('a:execute'), 'no Execute while required prompt is empty')
})

test('Form card shows Execute once every required field has a value', () => {
  const r = renderPrimitive(cardForm({ prompt: 'a cat' }))
  const datas = r.extra!.reply_markup!.inline_keyboard.flat().map(b => b.callback_data)
  assert.ok(datas.includes('a:execute'), 'Execute appears when required filled')
  assert.match(r.text, /a cat/, 'current value shown')
})

test('single-field Form with no values keeps the legacy single prompt (no card)', () => {
  const single: Primitive = {
    kind: 'Form',
    label: 'Configure',
    fields: [{ key: 'prompt', label: 'The prompt', type: 'text', required: true }],
    // no `values` → gap-fill path
  }
  const r = renderPrimitive(single)
  assert.match(r.text, /Please enter The prompt/)
  assert.equal(r.extra, undefined, 'no keyboard on the legacy single prompt')
})

test('decodeCallbackData maps a:edit_<key> → action and a:execute → action', () => {
  assert.deepEqual(decodeCallbackData('a:edit_steps'), { kind: 'action', actionId: 'edit_steps' })
  assert.deepEqual(decodeCallbackData('a:execute'), { kind: 'action', actionId: 'execute' })
})

test('a Form card shows a filled image Porta as (image), never as a URL', () => {
  const out = renderPrimitive({
    kind: 'Form',
    label: 'Interrogate',
    fields: [
      { key: 'image', label: 'Image', required: true },
      { key: 'prompt', label: 'Prompt', required: false },
    ],
    values: {
      image: 'https://api.telegram.org/file/bot1234567890:AAFakeTokenForTestsOnly_ffffffffffff/photos/f.jpg',
      prompt: 'describe this',
    },
  } as never)
  assert.ok(!out.text.includes('api.telegram.org'), 'no Telegram file URL on the card')
  assert.match(out.text, /Image: \(image\)/)
  assert.match(out.text, /Prompt: describe this/, 'non-URL values still render')
})

test('a Form card shows a chained PRIVATE input as (image), never as its key', () => {
  const out = renderPrimitive({
    kind: 'Form',
    label: 'Interrogate',
    fields: [
      { key: 'image', label: 'Image', required: true },
      { key: 'prompt', label: 'Prompt', required: false },
    ],
    values: {
      image: 'noema-private://private-outputs/abcdef0123456789/cccc.png',
      prompt: 'again, colder',
    },
  } as never)
  assert.ok(!out.text.includes('noema-private://'), 'no private-output key on the card')
  assert.match(out.text, /Image: \(image\)/)
})
