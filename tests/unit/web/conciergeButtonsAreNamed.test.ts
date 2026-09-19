import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The concierge is mounted on almost every screen, so one unnamed control there is not one
// defect — it is the same defect on 41 of 55 routes, and it was the whole of axe's button-name
// violation for the app. A screen reader reaching the send button was told "button".
//
// The buttons at issue are icon-only: their only child is <Ic name="..."/>, which renders a
// lucide SVG carrying no text. There is nothing for an accessible name to be computed from, so
// it has to be given one. Measured in a browser on /catalog: 57 buttons, exactly 1 with no
// accessible name before, 0 after.

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  resolve(here, '../../../src/platforms/web/app/src/shell/Concierge.tsx'),
  'utf8',
)

/** Every <button ...> opening tag together with what sits between it and its </button>.
 *  The tag cannot be matched with `[^>]*`: `onClick={() => ...}` puts a `>` inside an
 *  attribute, so a naive match ends the tag halfway through and hands the rest to the body —
 *  which then looks like visible text and makes an icon-only button look labelled. */
function buttons(): { tag: string; body: string }[] {
  const out: { tag: string; body: string }[] = []
  for (const open of source.matchAll(/<button\b/g)) {
    let depth = 0
    let quote: string | null = null
    let i = open.index! + open[0].length
    for (; i < source.length; i++) {
      const c = source[i]
      if (quote) {
        if (c === quote) quote = null
      } else if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    const tag = source.slice(open.index! + open[0].length, i)
    const end = source.indexOf('</button>', i)
    out.push({ tag, body: end === -1 ? '' : source.slice(i + 1, end) })
  }
  return out
}

/** Text a screen reader could use: anything that is not a tag and not an icon element. */
function visibleText(body: string): string {
  return body
    .replace(/<Ic\b[^>]*\/>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, m => (/['"`]/.test(m) ? m : ''))
    .trim()
}

test('every button in the concierge has an accessible name', () => {
  const nameless = buttons().filter(b => {
    const labelled = /\baria-label(?:ledby)?\s*=/.test(b.tag) || /\btitle\s*=/.test(b.tag)
    return !labelled && !visibleText(b.body)
  })
  assert.deepEqual(
    nameless.map(b => `<button${b.tag}>`),
    [],
    'these concierge buttons render an icon and nothing else, so they are announced only as "button"',
  )
})

test('the icon-only send buttons are the ones carrying the label', () => {
  // A guard on the guard: if <Ic> is renamed or the send buttons stop being icon-only, the test
  // above passes for a reason that has nothing to do with what it is checking.
  const iconOnly = buttons().filter(b => /<Ic\b/.test(b.body) && !visibleText(b.body))
  assert.ok(iconOnly.length >= 2, 'expected the concierge to still have icon-only buttons to name')
  for (const b of iconOnly) {
    assert.match(
      b.tag,
      /\baria-label(?:ledby)?\s*=|\btitle\s*=/,
      `an icon-only button lost its name: <button${b.tag}>`,
    )
  }
})
