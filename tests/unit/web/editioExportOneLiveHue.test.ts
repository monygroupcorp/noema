import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// DESIGN.md D-9: --accent is the one live/actionable hue, small enough to scan. EditioExport's
// selected destination option (.ex-opt.on) rings itself in --accent, and the 'download to you'
// footer action used a SEPARATE green (--good) fill beside it — two competing live hues on one
// screen. The hosting destination's own footer action already uses accent; the download action
// now matches it instead of introducing a second hue.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/EditioExport.tsx'), 'utf8')

test('the download-to-you footer action is accent-filled, not a competing green', () => {
  assert.doesNotMatch(src, /"btn good lg"/, 'EditioExport still has a green CTA competing with --accent on the same screen (D-9)')
})
