import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { COLL_STATUS_LABEL } from '../../../src/platforms/web/app/src/lib/collections.js'

// DESIGN.md D-26: sentence case for everything the user reads. EditioHub's section labels and
// its collection-status chip ("collection · complete") rendered fully lowercase — not a CSS
// text-transform, literal lowercase strings.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/EditioHub.tsx'), 'utf8')

test('every COLL_STATUS_LABEL value is sentence case', () => {
  for (const [status, label] of Object.entries(COLL_STATUS_LABEL)) {
    assert.equal(label[0], label[0].toUpperCase(), `COLL_STATUS_LABEL.${status} ("${label}") is not sentence case`)
  }
})

test('the collection kicker and next-step label are sentence case', () => {
  assert.match(src, /className="ph-kick">Collection ·/, 'the ph-kick line is still lowercase')
  assert.match(src, /className="ph-l">Next step</, 'the next-step label is still lowercase')
})
