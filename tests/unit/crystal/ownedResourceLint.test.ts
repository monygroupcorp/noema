// =============================================================================
// noema-304 — the seed lint that keeps the declaration honest
// =============================================================================
//
// The run entry point can only scope the references a modus DECLARES, so a modus that names
// a resource-shaped port and says nothing about it would hand a cursor an unscoped id. The
// lint runs where the canon modi are defined, i.e. at import, so that answer arrives when the
// seed is written rather than on the first run that names a record.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  RESOURCE_PORT_NAMES,
  lintOwnedDeclarations,
  undeclaredResourcePorts,
} from '../../../src/execution/ownedResources.js'
import { CANONICAL_MODI } from '../../../src/crystal/seeds/modi.js'
import type { Modus } from '../../../src/types/modus.js'

const bare = (aditus: Modus['aditus']): Modus => ({
  id: 'modus.under-test', nomen: 'under test', genus: 'atomicus', versio: '1.0.0',
  contentHash: '', canonica: false, aditus, exitus: {},
  natum: new Date(0), mutatum: new Date(0),
})

test('the canonical seeds declare every resource-shaped port they carry', () => {
  lintOwnedDeclarations(CANONICAL_MODI)
  for (const m of CANONICAL_MODI) {
    assert.deepEqual(undeclaredResourcePorts(m.aditus), [], `${m.id} declares its references`)
  }
})

test('a resource-shaped port with no declaration fails the seed set', () => {
  assert.throws(
    () => lintOwnedDeclarations([bare({ dataset: { type: 'text', required: true } })]),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, /modus\.under-test\.aditus\.dataset/)
      return true
    },
  )
})

test('every reserved name is caught, in any casing', () => {
  for (const name of RESOURCE_PORT_NAMES) {
    const cased = name.toUpperCase()
    assert.deepEqual(
      undeclaredResourcePorts({ [cased]: { type: 'text' } }), [cased],
      `${cased} is a reference whether or not the seed says so`,
    )
  }
})

test('a declared port passes, and a port that names no resource is not the lint\'s business', () => {
  lintOwnedDeclarations([
    bare({
      dataset: { type: 'text', owned: { genus: 'dataset' } },
      captionset: { type: 'text', owned: { genus: 'captionset', parens: 'dataset' } },
      prompt: { type: 'text' },
    }),
  ])
})
