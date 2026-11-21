import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// TraitsGarden's value/weight fields put their label above the input, two lines each — four
// lines per value — so a weight couldn't be compared against a sibling's without scrolling to
// it (REF-28). Label-beside-input halves the height, so twice as many values' weights stay on
// screen together.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../src/platforms/web/app/src/styles/app.css'), 'utf8')

test('.gt-grid .tc-feeds lays its label and field out in a row, not stacked', () => {
  const rule = css.match(/\.gt-grid \.tc-feeds\{([^}]*)\}/)
  assert.ok(rule, '.gt-grid .tc-feeds rule not found — app.css changed shape')
  assert.doesNotMatch(rule![1], /flex-direction:\s*column/, '.gt-grid .tc-feeds still stacks its label above the field')
})

test('the field inside .gt-grid .tc-feeds is not forced to 100% width (it shares the row with its label)', () => {
  assert.match(css, /\.gt-grid \.tc-feeds \.cer-input\{[^}]*width:\s*auto/, 'the field no longer reinstates auto width inside the row layout — it would overflow the label')
})
