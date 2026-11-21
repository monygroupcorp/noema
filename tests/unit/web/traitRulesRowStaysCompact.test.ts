import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// TraitRules' exclude/tag rows stacked into three full lines per value under 760px (REF-28):
// an earlier value's fields scrolled out of view by the time a later one's were in reach. The
// mobile breakpoint now narrows the same desktop grid instead of collapsing it to one column.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../src/platforms/web/app/src/styles/app.css'), 'utf8')

test('.rr-row stays a multi-column grid under the mobile breakpoint, not a single stacked column', () => {
  const rule = css.match(/@media\(max-width:760px\)\{\.rr-row\{([^}]*)\}\}/)
  assert.ok(rule, 'the .rr-row mobile breakpoint rule not found — app.css changed shape')
  assert.doesNotMatch(rule![1], /grid-template-columns:\s*1fr\s*(?:;|$)/, '.rr-row collapsed back to one column on mobile')
})
