import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// EditioExport's "Publish to hosting" consent already named who can see the result (public)
// but said nothing about whether the choice is reversible before the publish action fires —
// "Retract hosting" exists, but only ever appears AFTER publishing, never mentioned upfront.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/EditioExport.tsx'), 'utf8')

test('the hosting consent label states the choice is retractable before the publish action', () => {
  const label = src.match(/<label className="ex-consent">([\s\S]*?)<\/label>/)
  assert.ok(label, '.ex-consent label not found — EditioExport.tsx changed shape')
  assert.match(label![1], /retract/i, 'the consent copy says nothing about reversibility before the user publishes')
})
