import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Card.tsx's Run button carries a "⌘⏎" chip, but nothing in the app listened for the
// keystroke it advertises — no keydown handler existed anywhere. This repo has no
// component-rendering test harness (no @testing-library/react in package.json), so this
// asserts the handler's shape in source rather than its runtime effect: that a keydown
// listener exists, gates on Cmd/Ctrl+Enter specifically (not bare Enter, which the quote's
// own ⌘⏎ chip wording promises), prevents the default, and is cleaned up on unmount —
// catching the handler being deleted, miswired to a different key, or leaking a listener.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/Card.tsx'), 'utf8')

test('a keydown listener is bound for Cmd/Ctrl+Enter, matching the Run button\'s own ⌘⏎ chip', () => {
  assert.match(src, /e\.key\s*!==\s*'Enter'\s*\|\|\s*!\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)/, 'the hotkey no longer gates on Cmd/Ctrl+Enter specifically')
})

test('the hotkey handler prevents the default (so Enter alone in a field is untouched)', () => {
  const block = src.match(/const onKey = \(e: KeyboardEvent\) => \{([\s\S]*?)\};/)
  assert.ok(block, 'the onKey handler changed shape')
  assert.match(block![1], /e\.preventDefault\(\)/, 'the hotkey no longer calls preventDefault')
})

test('the keydown listener is added and removed in the same effect (no leaked listener)', () => {
  assert.match(src, /window\.addEventListener\('keydown', onKey\)/, 'the hotkey listener is no longer attached')
  assert.match(src, /window\.removeEventListener\('keydown', onKey\)/, 'the hotkey listener is no longer cleaned up on unmount')
})
