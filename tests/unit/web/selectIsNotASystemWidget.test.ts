import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Every field class in app.css (.inp, .cer-input, .byo-input) gives a select a background, a
// border and font:inherit, but none of them ever set `appearance:none` — so the browser kept
// drawing its own widget on top: system sans, a native chevron, a border that is not --hair.
// `appearance:none` alone is not the fix either: a de-natived select with nothing drawn in its
// place is indistinguishable from a text field, which is worse than the OS control it replaces.
// And the three field classes set `background` as a SHORTHAND, which resets every background-*
// longhand — so a chevron painted only on the bare `select` rule is wiped the moment a select
// also wears one of those classes, which is almost every select in the app. The assertions below
// catch each failure mode: no appearance:none at all, a de-natived select with no chevron, and a
// qualified field-class rule that forgets to reinstate the chevron the shorthand just wiped.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../src/platforms/web/app/src/styles/app.css'), 'utf8')

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  assert.ok(rule, `no rule found for selector: ${selector}`)
  return rule![1]
}

test('the bare select rule de-natives the control and draws a chevron in its place', () => {
  const body = ruleBody('select')
  assert.match(body, /appearance:\s*none/, 'select no longer sets appearance:none')
  assert.match(body, /background-image\s*:\s*var\(--select-chevron\)/, 'select draws no chevron')
})

test('every field class that wraps a select reinstates the chevron the background shorthand wipes', () => {
  // .inp, .cer-input (via .coll-create) and .byo-input each set `background` as a shorthand
  // somewhere in this file, which resets background-image — this is the cascade the qualified
  // rule below exists to repair.
  assert.match(css, /\.inp,\.ta2\{[^}]*background\s*:/, '.inp no longer sets background as a shorthand')
  assert.match(css, /\.coll-create \.cer-input\{[^}]*background\s*:/, '.coll-create .cer-input no longer sets background as a shorthand')
  assert.match(css, /\.byo-input\{[^}]*background\s*:/, '.byo-input no longer sets background as a shorthand')

  const start = css.indexOf('select.inp,')
  assert.ok(start >= 0, 'the qualified select rule (select.inp, select.cer-input, ...) is gone')
  const qualified = css.slice(start, css.indexOf('}', start) + 1)
  assert.match(qualified, /background-image\s*:\s*var\(--select-chevron\)/, 'the qualified select rule forgot to reinstate the chevron')
  assert.match(qualified, /padding-right\s*:\s*30px/, 'the qualified select rule forgot room for the chevron')
})

test('no select rule paints a literal colour instead of a token (D-6)', () => {
  const body = ruleBody('select')
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}(?!\))/, 'select rule has a literal hex colour')
})
