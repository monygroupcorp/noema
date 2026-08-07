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

import type { RouteSpec } from '../../../../src/allocutio/api/apiContract.js'
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

test('generateOpenApi: query params are appended after path params, and a route with neither emits no parameters key', () => {
  const routes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/widgets/:id',
      summary: 'A route with a path param and query params.',
      auth: false,
      query: [{ name: 'sort', description: 'Sort order.', schema: { type: 'string' } }],
    },
    {
      method: 'GET',
      path: '/widgets',
      summary: 'A route with neither path nor query params.',
      auth: false,
    },
  ]
  const doc = generateOpenApi({ version: 'v1', routes, errorCodes: [] }) as {
    paths: Record<string, Record<string, { parameters?: unknown[] }>>
  }

  const withBoth = doc.paths['/widgets/{id}'].get.parameters!
  assert.equal(withBoth.length, 2, 'path param then query param')
  assert.deepEqual(withBoth[0], { name: 'id', in: 'path', required: true, schema: { type: 'string' } })
  assert.deepEqual(withBoth[1], {
    name: 'sort',
    in: 'query',
    description: 'Sort order.',
    required: false,
    schema: { type: 'string' },
  })

  assert.equal('parameters' in doc.paths['/widgets'].get, false, 'no parameters key when there are none')
})
