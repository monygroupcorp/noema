import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// A whole-card or whole-row link is an <a> wrapping content that reads as prose. An anchor
// underlines by default and that decoration propagates to every in-flow descendant, so the
// description, the badge and the counts row all carried the link underline and nothing on the
// card distinguished what you click from what you read.
//
// The card already says it is clickable by being a card — a border, a hover border, and
// cursor:pointer — which is why removing the underline costs no affordance.
//
// Measured in a browser on /projects: the anchor computed `underline` before and `none` after,
// on all four cards, with colour and cursor unchanged.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../../src/platforms/web/app')
const css = readFileSync(resolve(appDir, 'src/styles/app.css'), 'utf8')
const projects = readFileSync(resolve(appDir, 'src/screens/Projects.tsx'), 'utf8')

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = css.match(new RegExp(`(?:^|[\\n}])${escaped}\\{([^}]*)\\}`))
  assert.ok(rule, `${selector} has no rule in app.css`)
  return rule![1]
}

test('a whole-card link does not underline the prose inside it', () => {
  assert.match(
    declarations('.projcard'),
    /text-decoration\s*:\s*none/,
    '.projcard is an <a>, so without text-decoration:none its underline propagates through the ' +
      'description, the badge and the counts row',
  )
})

test('the card is still the anchor this rule is about', () => {
  // If the card stopped being a link the rule would be dead weight, and if it stopped carrying
  // the class the rule would be aimed at nothing — either way the assertion above would pass
  // while meaning nothing.
  assert.match(
    projects,
    /<Link\b[^>]*className=\{?[`'"][^`'"]*projcard/,
    'Projects.tsx no longer renders the card as a <Link> carrying .projcard',
  )
})

test('every whole-row link in the app agrees about this', () => {
  // .projcard was the odd one out: the other full-width anchors already suppressed it, which is
  // what made the cards look like a mistake rather than a style.
  for (const selector of ['.lrow', '.reg-row', '.btn']) {
    assert.match(
      declarations(selector),
      /text-decoration\s*:\s*none/,
      `${selector} wraps content as a link and no longer suppresses the underline`,
    )
  }
})
