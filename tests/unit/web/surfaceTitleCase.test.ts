import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, basename } from 'node:path'

// DESIGN.md D-26 (ratified 2026-08-26): sentence case for everything the user reads.
//
// AppShell resolves `heading = title ?? crumb` and renders it straight into one `.surface-title`
// slot, so both props land in the same place on screen. Twelve of them were lowercase —
// "chat", "activity", "projects" — while the rail the user clicked to get there already said
// Chat, Activity, Projects. The bar naming the screen differently from the link that reached it
// is the cheapest kind of disorientation to remove and the easiest to reintroduce, because each
// screen writes its own crumb and nothing compares them.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../../src/platforms/web/app')

function headings(): { file: string; prop: string; value: string }[] {
  const out: { file: string; prop: string; value: string }[] = []
  for (const dir of ['src/screens', 'src/shell']) {
    const full = resolve(appDir, dir)
    for (const file of readdirSync(full)) {
      if (!file.endsWith('.tsx')) continue
      const source = readFileSync(join(full, file), 'utf8')
      for (const use of source.matchAll(/<AppShell\b([\s\S]{0,400}?)>/g)) {
        const attrs = use[1]
        // Only literal headings can be judged here; an expression is decided at run time and is
        // out of this test's reach, which is worth knowing rather than papering over.
        const title = attrs.match(/\btitle=\{?"([^"]+)"/)
        const crumb = attrs.match(/\bcrumb=\{?"([^"]+)"/)
        if (title) out.push({ file: basename(file), prop: 'title', value: title[1] })
        else if (crumb) out.push({ file: basename(file), prop: 'crumb', value: crumb[1] })
      }
    }
  }
  return out
}

test('every literal surface title is sentence case (D-26)', () => {
  const lower = headings().filter(h => /^[a-z]/.test(h.value))
  assert.deepEqual(
    lower.map(h => `${h.file} ${h.prop}="${h.value}"`),
    [],
    'these headings reach the top bar in lower case while the rail names them capitalised',
  )
})

test('the top bar has something to be consistent about', () => {
  // A guard on the guard: if the AppShell prop names or call shape change, the matcher above
  // silently finds nothing and the first test passes on an empty set.
  assert.ok(headings().length > 20, 'found almost no AppShell headings — the matcher has gone stale')
})

test('nothing re-cases the surface title in CSS', () => {
  // The fix is a string literal, so a `text-transform` on the slot would make it invisible on
  // screen while every assertion above still passed.
  const css = readFileSync(resolve(appDir, 'src/styles/app.css'), 'utf8')
  for (const rule of css.matchAll(/([^{}]*\.surface-title[^{}]*)\{([^}]*)\}/g)) {
    const transform = rule[2].match(/text-transform\s*:\s*([^;]+)/)
    if (transform) {
      assert.match(
        transform[1].trim(),
        /^none$/,
        `${rule[1].trim()} re-cases the surface title, so the crumb on screen is not the crumb in source`,
      )
    }
  }
})
