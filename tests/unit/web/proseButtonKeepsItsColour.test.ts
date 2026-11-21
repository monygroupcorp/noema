import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// `.prose a` in doc.css is (0,1,1). `.btn`'s own `color` in app.css is (0,1,0). So an
// <a class="btn"> inside a .prose article loses its text colour to the prose link colour, and on
// /pricing that put #a3adc4 on the button's own #7d8aa6 fill — 1.54:1 against a required 4.5:1,
// measured in a browser on a clean build. The four Buy buttons, the only call to action on the
// page a stranger lands on, read as disabled.
//
// What makes this worth a test rather than a one-line fix left to stand: nothing in the build
// can see it. The CSS compiles, the page renders, axe runs only in the walk harness against a
// baseline that can be days old, and the defect looks exactly like a deliberate disabled style.
// The assertions below are cheap and they fail the moment the override is dropped or a new
// button variant arrives without one.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../../src/platforms/web/app')
const doc = readFileSync(resolve(appDir, 'src/screens/doc.css'), 'utf8')
const app = readFileSync(resolve(appDir, 'src/styles/app.css'), 'utf8')

/** The colour a selector sets, as written, or null when the rule is not there. */
function colourFor(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'm'))
  if (!rule) return null
  const colour = rule[1].match(/(?:^|;)\s*color\s*:\s*([^;]+)/)
  return colour ? colour[1].trim() : null
}

test('the prose link rule still outranks the button, so the override is still load-bearing', () => {
  // If this ever stops being true the override can go — but it has to be noticed, not assumed.
  assert.match(doc, /\.prose a\s*\{[^}]*color\s*:/, '.prose a no longer sets a colour')
  assert.match(app, /(?:^|\n)\.btn\{[^}]*color\s*:/, '.btn no longer sets its own colour')
})

test('a button in prose keeps its own text colour', () => {
  const override = colourFor(doc, '.prose a.btn')
  assert.ok(override, 'doc.css has no `.prose a.btn` rule — a button in prose takes the link colour')
  assert.equal(
    override,
    colourFor(app, '.btn'),
    'the override does not restore the colour app.css actually gives .btn',
  )
})

test('every button variant that sets its own colour is restored in prose too', () => {
  // A variant that recolours the button (.ghost, .accent) needs its own override, or it is
  // returned to the base button colour inside prose rather than to its own.
  const variants = [
    { app: '.btn.ghost', prose: '.prose a.btn.ghost' },
    { app: '.btn.accent', prose: '.prose a.btn.accent' },
  ]
  const missing = variants.filter(v => colourFor(app, v.app) && !colourFor(doc, v.prose))
  assert.deepEqual(
    missing.map(v => v.prose),
    [],
    `these variants recolour the button but are not restored inside .prose: ${missing
      .map(v => v.app)
      .join(', ')}`,
  )
})
