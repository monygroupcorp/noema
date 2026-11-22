import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// /lab/landing measured 500px wide on a 390px viewport — every other census route measures
// exactly 390. `.lab-bar` itself wraps (flex-wrap:wrap), but `.lab-bar .lab-ctl` did not, so each
// control group (the five display-face chips among them) stayed one unbreakable inline-flex row
// wider than the viewport, pushing the whole document past it and giving the page a horizontal
// scroll nothing else on the site has.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/plate-lab.css'), 'utf8')

test('.lab-ctl wraps its own contents instead of staying one unbreakable row', () => {
  const rule = css.match(/\.lab-bar \.lab-ctl\{([^}]*)\}/)
  assert.ok(rule, '.lab-bar .lab-ctl rule not found — plate-lab.css changed shape')
  assert.match(rule![1], /flex-wrap\s*:\s*wrap/, '.lab-ctl can still grow wider than its viewport')
})
