import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// .warn.gate stacks a sentence and its one action into a column flex (one action on its own
// row, not a word inside the sentence). With align-items:flex-start, the sentence has no
// definite width and sizes to its own shrink-to-fit content box — at phone width that produced
// a narrow, ragged multi-line block instead of ordinary wrapped prose. align-items:stretch gives
// it the full row width, which is what lets it wrap edge-to-edge like any other paragraph.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../src/platforms/web/app/src/styles/app.css'), 'utf8')

test('.warn.gate stretches its children to the full row width', () => {
  const rule = css.match(/\.warn\.gate\{([^}]*)\}/)
  assert.ok(rule, '.warn.gate rule not found — app.css changed shape')
  assert.match(rule![1], /align-items\s*:\s*stretch/, '.warn.gate no longer stretches its children — its text can shrink into ragged columns again')
})
