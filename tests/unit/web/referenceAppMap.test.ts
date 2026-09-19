import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The reference-app map (`src/platforms/web/app/REFERENCES.md`) names, per screen, the app a
// critique compares that screen against — see its §0 for why a named app and not a checklist.
//
// The map is hand-written and the route census is not: routes are read out of `App.tsx` at run
// time by `walk/routes.ts`, so a new screen joins the census the moment it is routed and joins
// the map only if somebody remembers. That asymmetry is the whole reason this file exists. A
// critique run against a map with a hole in it does not report the hole — it simply never looks
// at that screen, which is the failure mode the map was written to close.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../../src/platforms/web/app')

const appTsx = readFileSync(resolve(appDir, 'src/App.tsx'), 'utf8')
const map = readFileSync(resolve(appDir, 'REFERENCES.md'), 'utf8')

/** The census, read the way walk/routes.ts reads it. `*` is the catch-all, not a screen. */
const census = [...appTsx.matchAll(/<Route\s+path="([^"]+)"/g)]
  .map(m => m[1])
  .filter(path => path !== '*')

/** Every route the map mentions in a table cell, in backticks. */
const routesInMap = new Set([...map.matchAll(/`(\/[^`\s]*)`/g)].map(m => m[1]))

/** The rows that deliberately name no reference, and the routes they cover. */
const unnamedRoutes = new Set(
  map
    .split('\n')
    .filter(line => line.includes('**unnamed**'))
    .flatMap(line => [...line.matchAll(/`(\/[^`\s]*)`/g)].map(m => m[1])),
)

/** The routes §1.8 declares are not screens at all. */
const notScreens = new Set(
  [...(map.split('### 1.8 Not screens')[1] ?? '').split('### 1.9')[0].matchAll(/`(\/[^`\s]*)`/g)].map(
    m => m[1],
  ),
)

test('every route in the census has a row in the reference-app map', () => {
  const missing = census.filter(path => !routesInMap.has(path))
  assert.deepEqual(
    missing,
    [],
    `these routes are in App.tsx and absent from REFERENCES.md, so a critique run would skip them ` +
      `silently: ${missing.join(', ')}. Add a row — a deliberately **unnamed** one is a real answer.`,
  )
})

test('the map claims no route the app does not route', () => {
  const routed = new Set(census)
  // Surfaces outside the census are declared in §1.9 and are not App.tsx routes; everything else
  // the map names in a table cell has to be a route that exists, or the map is describing a screen
  // that is gone and a critique would be comparing against nothing.
  const outsideCensus = new Set(
    [...(map.split('### 1.9 Outside the census')[1] ?? '').matchAll(/`(\/[^`\s]*)`/g)].map(m => m[1]),
  )
  const phantom = [...routesInMap].filter(p => !routed.has(p) && !outsideCensus.has(p))
  assert.deepEqual(phantom, [], `REFERENCES.md names routes App.tsx does not route: ${phantom.join(', ')}`)
})

test('no REF id is reused — a citation in a past critique still resolves', () => {
  const ids = [...map.matchAll(/^\| (REF-\d+)/gm)].map(m => m[1])
  const seen = new Set<string>()
  const duplicated = ids.filter(id => (seen.has(id) ? true : (seen.add(id), false)))
  assert.deepEqual(duplicated, [], `REF ids reused: ${duplicated.join(', ')}`)
  assert.ok(ids.length > 0, 'the map has no REF rows at all')
})

test('the coverage split is reported, so a critique quotes the run and not the prose', () => {
  const named = census.filter(p => !unnamedRoutes.has(p) && !notScreens.has(p))
  // Printed rather than asserted: the target is clause 1 of noema/ux-phase-2-critic — every screen
  // carrying a named reference — and this suite is not the place that decides the target is met.
  // It reports where the map stands so nobody has to count the table by hand.
  console.log(
    `reference-app map: ${census.length} census routes — ${named.length} named, ` +
      `${unnamedRoutes.size} deliberately unnamed, ${notScreens.size} not a screen`,
  )
  assert.equal(
    named.length + unnamedRoutes.size + notScreens.size,
    census.length,
    'every census route is named, deliberately unnamed, or declared not a screen — no fourth state',
  )
})
