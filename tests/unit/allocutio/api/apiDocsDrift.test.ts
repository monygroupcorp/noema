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
import { ApiError, Errors } from '../../../../src/allocutio/api/errors.js'
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

test('generateOpenApi: a multi-param route emits every declared query param, in handler order, after its path params', () => {
  const routes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/gadgets/:id/items',
      summary: 'A route with a path param and multiple query params.',
      auth: false,
      query: [
        { name: 'status', description: 'Filter by status.', schema: { type: 'string' } },
        { name: 'cursor', description: 'Opaque page cursor.', schema: { type: 'string' } },
        { name: 'limit', description: 'Page size.', schema: { type: 'integer' } },
      ],
    },
  ]
  const doc = generateOpenApi({ version: 'v1', routes, errorCodes: [] }) as {
    paths: Record<string, Record<string, { parameters?: unknown[] }>>
  }

  const params = doc.paths['/gadgets/{id}/items'].get.parameters!
  assert.equal(params.length, 4, 'path param + three query params')
  assert.deepEqual(params[0], { name: 'id', in: 'path', required: true, schema: { type: 'string' } })
  assert.deepEqual(
    params.slice(1).map((p) => (p as { name: string; in: string }).name),
    ['status', 'cursor', 'limit'],
    'query params stay in the order declared on the route (handler destructuring order)',
  )
  for (const p of params.slice(1) as { in: string; required: boolean }[]) {
    assert.equal(p.in, 'query')
    assert.equal(p.required, false)
  }
})

test('generateOpenApi: POST /mcp publishes as transport-public, with per-tool enforcement named in the summary', () => {
  const doc = generateOpenApi(API_CONTRACT) as {
    paths: Record<string, Record<string, { summary: string; security: unknown[] }>>
  }
  const op = doc.paths['/mcp'].post
  assert.deepEqual(op.security, [], 'the transport does not require a credential — security renders empty, like other public routes')
  assert.match(op.summary, /per-tool/i, 'the summary must say identity is enforced per-tool, not at the transport')

  const me = doc.paths['/me'].get
  assert.notDeepEqual(me.security, [], 'an unrelated authenticated route must keep rendering as authenticated')
})


test('every code the Errors taxonomy can construct is declared in the contract, at the same status', () => {
  // The contract's `errorCodes` is what the published reference tells an agent it may branch on,
  // so a code `errors.ts` can return and the contract does not carry is invisible to every reader
  // of the docs. This walks the taxonomy rather than pinning a list, so a code added to
  // `errors.ts` later fails here until it is declared and the docs are regenerated.
  const declared = new Map(API_CONTRACT.errorCodes.map((e) => [e.code, e]))
  const factories = Object.values(Errors) as unknown as Array<(...args: unknown[]) => ApiError>
  assert.ok(factories.length > 0, 'the taxonomy must not be empty')

  for (const make of factories) {
    // Every factory takes an optional message/id/details first argument; a placeholder is enough
    // to reach the code and status, which is all this asserts.
    const err = make('x')
    const spec = declared.get(err.code)
    assert.ok(spec, `error code '${err.code}' is returned by errors.ts but not declared in API_CONTRACT.errorCodes`)
    assert.equal(
      spec.httpStatus,
      err.httpStatus,
      `error code '${err.code}' is declared as HTTP ${spec.httpStatus} but returned as ${err.httpStatus}`,
    )
    if (err.opts.retryable !== undefined) {
      assert.equal(
        spec.retryable ?? false,
        err.opts.retryable,
        `error code '${err.code}' declares retryable ${String(spec.retryable)} but returns ${String(err.opts.retryable)}`,
      )
    }
  }
})
