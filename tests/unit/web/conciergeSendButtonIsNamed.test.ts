import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// The concierge mounts on almost every screen, so an unnamed icon-only send button is not one
// defect but the same one everywhere it appears: axe's button-name rule flags it on every route
// that renders the concierge. Both submits — the idle dock's and the one attached to a focused
// field — render only an <Ic> icon, which carries no text an accessible name could be computed
// from, so a screen reader announced either as just "button".

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/shell/Concierge.tsx'), 'utf8')

test('the field-attached send button is icon-only, and carries an accessible name', () => {
  const m = src.match(/<button onClick=\{gen\}([^>]*)><Ic name="arrow-up" \/><\/button>/)
  assert.ok(m, 'the field-attached send button changed shape — re-check it by hand')
  assert.match(m![1], /aria-label=/, 'the field-attached send button has no accessible name')
})

test('the idle-dock send button is icon-only, and carries an accessible name', () => {
  const m = src.match(/<button disabled=\{idleSending\} onClick=\{\(\) => void idleSend\(\)\}([^>]*)><Ic name="arrow-up" \/><\/button>/)
  assert.ok(m, 'the idle-dock send button changed shape — re-check it by hand')
  assert.match(m![1], /aria-label=/, 'the idle-dock send button has no accessible name')
})
