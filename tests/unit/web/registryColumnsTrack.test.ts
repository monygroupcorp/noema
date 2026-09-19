import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The catalogue's column header and its rows are two separate flex containers that have to wrap
// the same way, or the labels end up over the wrong columns. Below 760px the header puts the
// name on its own line and modality/version side by side beneath it; the row has to do the same.
//
// It did not. `.reg-mod` and `.reg-ver` carried `flex:1`, which is a flex-basis of ZERO, so they
// shrank onto line 1 beside the name rather than wrapping under it — the header on two lines,
// the row on one, "Modality" sitting over the model name and "Version" over nothing.
//
// Measured in a browser at 390x844 against the built CSS: with a 40% basis, .reg-mod lands
// x22 w162 under .c-mod x22 w162 and .reg-ver x191 w162 under .c-ver x191 w162.
//
// None of that is visible to a typecheck or a build, and the geometry itself needs a browser.
// What can be asserted here is the property the geometry depends on: a basis that is not zero,
// and the same one on both columns.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(
  resolve(here, '../../../src/platforms/web/app/src/styles/app.css'),
  'utf8',
)

/** Everything that applies at the 760px breakpoint.
 *  There are several `@media (max-width:760px)` blocks in this stylesheet and the first one is
 *  empty, so taking "the" block by its first occurrence measures nothing and passes anything. */
function mobileBlock(): string {
  const blocks: string[] = []
  const marker = '@media (max-width:760px){'
  for (let start = css.indexOf(marker); start !== -1; start = css.indexOf(marker, start + 1)) {
    let depth = 0
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) {
        blocks.push(css.slice(start, i))
        break
      }
    }
  }
  assert.notEqual(blocks.length, 0, 'the 760px breakpoint is gone; this suite is measuring nothing')
  return blocks.join('\n')
}

function flexOf(block: string, selector: string): string {
  const rule = block.match(new RegExp(`\\${selector}\\{([^}]*)\\}`))
  assert.ok(rule, `${selector} has no rule inside the 760px block`)
  const flex = rule![1].match(/(?:^|;)\s*flex\s*:\s*([^;]+)/)
  assert.ok(flex, `${selector} sets no flex inside the 760px block`)
  return flex![1].trim()
}

test('the registry columns wrap under the name rather than shrinking beside it', () => {
  const block = mobileBlock()
  for (const selector of ['.reg-mod', '.reg-ver']) {
    const flex = flexOf(block, selector)
    assert.doesNotMatch(
      flex,
      /^\d+$/,
      `${selector} uses \`flex:${flex}\`, a basis of zero — it will shrink onto the name's line ` +
        `and the header above it will be on two lines while the row is on one`,
    )
    assert.match(
      flex,
      /\d+%/,
      `${selector} needs a percentage basis wide enough that the pair cannot fit beside the name`,
    )
  }
})

test('both registry columns share one basis, so they form a single second line', () => {
  const block = mobileBlock()
  assert.equal(
    flexOf(block, '.reg-mod'),
    flexOf(block, '.reg-ver'),
    'modality and version wrap as a pair; different bases split them onto two separate lines',
  )
})

test('the header wraps at the same breakpoint the rows do', () => {
  // They are different elements with different class names, and nothing but this keeps them in
  // step: a breakpoint moved on one and not the other reintroduces the defect exactly.
  const block = mobileBlock()
  assert.match(block, /\.reg-bar\{[^}]*flex-wrap:\s*wrap/, 'the header does not wrap at 760px')
  assert.match(block, /\.reg-row\{[^}]*flex-wrap:\s*wrap/, 'the rows do not wrap at 760px')
})
