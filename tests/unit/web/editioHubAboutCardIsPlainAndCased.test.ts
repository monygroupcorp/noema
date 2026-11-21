import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Two defects on the same card. D-26 sentence case: 'about this collection' and 'activity'
// were literal lowercase labels. D-68 plain/specific system copy: the about paragraph ended on
// a flourish ("That asymmetry is the spine") instead of stating what actually happens.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/EditioHub.tsx'), 'utf8')

test('the about-collection and activity labels are sentence case', () => {
  assert.match(src, /className="ph-l">About this collection</, 'the about-collection label is still lowercase')
  assert.match(src, /className="ph-l">Activity</, 'the activity label is still lowercase')
})

test('the about-collection paragraph states the fact instead of a metaphor', () => {
  const p = src.match(/About this collection<\/div>\s*<p>([\s\S]*?)<\/p>/)
  assert.ok(p, 'the about-collection paragraph not found')
  assert.doesNotMatch(p![1], /spine/i, 'the paragraph still carries the "that asymmetry is the spine" flourish')
})
