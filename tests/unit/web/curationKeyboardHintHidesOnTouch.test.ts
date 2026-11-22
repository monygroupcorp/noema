import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Curation's Keep/Reject buttons carry a K/R keyboard-shortcut chip, which is noise on a
// touch-only viewport where no keyboard is present (P-1a) — the same failure mode the chat
// composer's own keyboard hints already guard against (app.css's `.hint .keys` rule).

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../src/platforms/web/app/src/styles/app.css'), 'utf8')

test('the Keep/Reject keyboard-shortcut chip hides on a touch-only pointer', () => {
  assert.match(
    css,
    /\(hover:none\) and \(pointer:coarse\)\{\.cu-keep \.kbd,\.cu-reject \.kbd\{display:none\}\}/,
    'Curation no longer hides its K/R hint on a touch-only viewport',
  )
})
