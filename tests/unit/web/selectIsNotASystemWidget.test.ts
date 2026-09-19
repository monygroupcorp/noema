import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// A <select> in this app used to render as the operating system's widget: every field class
// (.inp, .cer-input, .byo-input) gave it a background, a border and `font:inherit`, and none of
// them ever set `appearance:none`, so the browser drew its own control on top — system sans, a
// native chevron, a border that is not --hair.
//
// The failure is invisible to a typecheck and to a build: the CSS compiles, the page renders,
// and the control simply does not obey the theme. It is also easy to reintroduce, because the
// natural way to style a new select is to add another field class rather than to notice that
// the de-nativing lives in one place. These assertions are what notices.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../../src/platforms/web/app')
const css = readFileSync(resolve(appDir, 'src/styles/app.css'), 'utf8')

/** The one rule that de-natives every select, with the declarations it must carry. */
const baseRule = css.match(/(?:^|\n)select\{([^}]*)\}/)

test('a select is de-natived in the app stylesheet', () => {
  assert.ok(baseRule, 'app.css has no bare `select{...}` rule to carry appearance:none')
  assert.match(baseRule![1], /appearance:\s*none/, 'the select rule does not set appearance:none')
  assert.match(
    baseRule![1],
    /-webkit-appearance:\s*none/,
    'Safari and older Chrome need the prefixed form too, or the widget survives there',
  )
})

test('de-nativing a select leaves an affordance behind', () => {
  // `appearance:none` on its own is the other half of the same bug: .coll-create did exactly
  // that and left a select indistinguishable from a text field, which is worse than an OS
  // chevron — the user cannot tell it opens. The replacement chevron has to be drawn.
  assert.match(
    baseRule![1],
    /background-image:\s*var\(--select-chevron\)/,
    'the select rule removes the native chevron and draws none in its place',
  )
  assert.match(
    baseRule![1],
    /--select-chevron:[^;]*linear-gradient/,
    'the --select-chevron property does not actually carry a drawn chevron',
  )
  assert.match(
    baseRule![1],
    /padding:[^;]*\b30px\b|padding-right:\s*30px/,
    'no room is reserved for the chevron, so the label runs underneath it',
  )
})

test('the chevron follows the theme rather than being a fixed colour', () => {
  // The reason it is two gradients and not an inline SVG: a gradient can take var(--faint) and
  // a data: URI cannot, so one rule serves both themes instead of a light/dark pair that have
  // to be kept in step by hand.
  const chevron = css.match(/--select-chevron:([^;]*(?:;[^;]*?)??)(?=;\s*background-image)/)
  assert.ok(chevron, 'the chevron gradients are not held in the --select-chevron custom property')
  assert.match(chevron![1], /var\(--[a-z-]+\)/, 'the chevron is painted in a literal colour, not a token')
})

test('a select wearing a field class still gets the chevron', () => {
  // This is the assertion the first version of this suite was missing, and the bug it missed was
  // shipped: .inp, .cer-input and .byo-input each set `background` as a SHORTHAND, which resets
  // every background-* longhand. The bare `select` rule is outranked by all three, so the chevron
  // it paints was wiped for nearly every select in the app — de-natived with no affordance at
  // all, which is worse than the OS widget it replaced. Measured in a browser: background-image
  // `none` on all three, while an unclassed select drew it correctly.
  //
  // Asserting on the bare rule alone cannot see that, because the bare rule was never wrong.
  const qualified = css.match(/select\.inp,[^{]*\{([^}]*)\}/)
  assert.ok(qualified, 'no rule restates the chevron for selects wearing a field class')
  assert.match(
    qualified![1],
    /background-image:\s*var\(--select-chevron\)/,
    'the qualified rule does not restore background-image, so the field classes wipe the chevron',
  )
  for (const longhand of ['background-position', 'background-size', 'background-repeat']) {
    assert.match(
      qualified![1],
      new RegExp(`${longhand}\\s*:`),
      `the background shorthand also resets ${longhand}; it has to be restated here too`,
    )
  }
})

test('no screen stylesheet re-natives a select behind the shared rule', () => {
  const stylesDir = resolve(appDir, 'src/styles')
  const screensDir = resolve(appDir, 'src/screens')
  const sheets = [
    ...readdirSync(stylesDir).filter(f => f.endsWith('.css')).map(f => resolve(stylesDir, f)),
    ...readdirSync(screensDir).filter(f => f.endsWith('.css')).map(f => resolve(screensDir, f)),
  ]
  const offenders: string[] = []
  for (const file of sheets) {
    for (const rule of readFileSync(file, 'utf8').matchAll(/([^{}]*select[^{}]*)\{([^}]*)\}/g)) {
      if (/appearance:\s*(auto|menulist|menulist-button)/.test(rule[2])) {
        offenders.push(`${file.split('/app/')[1]}: ${rule[1].trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `these rules put the OS widget back: ${offenders.join(', ')}`)
})
