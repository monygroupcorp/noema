// =============================================================================
// apiDocsDrift — the drift guard: committed docs MUST match the generators.
// =============================================================================
//
// The load-bearing enforcement of "one source of truth". This test reads the
// committed `docs/api/openapi.json` + `docs/api/reference.md` and asserts they
// EXACTLY equal what `generateOpenApi` / `generateReference` produce from
// `API_CONTRACT`. A contract change without re-running `npm run gen:api-docs`
// fails here — so surface↔docs can never silently diverge.
//
// Hermetic: pure functions + reads two checked-in files. No network, no DB.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { API_CONTRACT } from '../../../../src/allocutio/api/apiContract.js'
import { generateOpenApi, generateReference } from '../../../../src/allocutio/api/docgen.js'

const here = dirname(fileURLToPath(import.meta.url))
// tests/unit/allocutio/api → repo root is four levels up.
const repoRoot = resolve(here, '../../../..')
const openApiPath = resolve(repoRoot, 'docs/api/openapi.json')
const referencePath = resolve(repoRoot, 'docs/api/reference.md')

test('committed openapi.json matches the generator (no drift)', () => {
  const committed = readFileSync(openApiPath, 'utf8')
  const expected = JSON.stringify(generateOpenApi(API_CONTRACT), null, 2) + '\n'
  assert.equal(
    committed,
    expected,
    'docs/api/openapi.json is stale — run `npm run gen:api-docs`.',
  )
})

test('committed reference.md matches the generator (no drift)', () => {
  const committed = readFileSync(referencePath, 'utf8')
  const expected = generateReference(API_CONTRACT)
  assert.equal(
    committed,
    expected,
    'docs/api/reference.md is stale — run `npm run gen:api-docs`.',
  )
})
