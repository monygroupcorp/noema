// =============================================================================
// docgen — pure generators that turn the declarative API_CONTRACT into docs.
// =============================================================================
//
// Two pure functions, no I/O:
//   generateOpenApi(contract) → a valid OpenAPI 3.1 document (object).
//   generateReference(contract) → a readable markdown reference (string).
//
// These are the ONLY place the contract is rendered. `scripts/gen-api-docs.ts`
// writes their output to disk; the drift-check re-runs them and diffs against
// the committed artifacts. Determinism is load-bearing: same contract in → byte-
// identical output out (no Date.now(), no map-iteration surprises, stable order).
// =============================================================================

import type { ApiContract, RouteSpec, JsonSchema } from './apiContract.js'
import { SCHEMAS } from './apiContract.js'

// ---------------------------------------------------------------------------
// OpenAPI 3.1
// ---------------------------------------------------------------------------

/** Convert a contract path (`/runs/:id`) to an OpenAPI path (`/runs/{id}`). */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

/** Extract `{name}` path-parameter names from an OpenAPI-style path. */
function pathParamNames(openApiPath: string): string[] {
  return [...openApiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1])
}

/** Build the OpenAPI Operation object for one route. */
function operationFor(route: RouteSpec): Record<string, unknown> {
  const openApiPath = toOpenApiPath(route.path)
  const parameters = pathParamNames(openApiPath).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))

  const responses: Record<string, unknown> = {
    '200': {
      description: 'Success.',
      ...(route.response
        ? { content: { 'application/json': { schema: route.response } } }
        : {}),
    },
    default: {
      description: 'A request error (see the Error schema and the error-code table).',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    },
  }

  const op: Record<string, unknown> = {
    summary: route.summary,
    security: route.auth ? [{ ApiKeyAuth: [] }, { BearerAuth: [] }] : [],
    responses,
  }
  if (parameters.length > 0) op.parameters = parameters
  if (route.request) {
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: route.request } },
    }
  }
  return op
}

/**
 * Generate a valid OpenAPI 3.1 document from the contract.
 * Pure & deterministic.
 */
export function generateOpenApi(contract: ApiContract): object {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of contract.routes) {
    const openApiPath = toOpenApiPath(route.path)
    const entry = (paths[openApiPath] ??= {})
    entry[route.method.toLowerCase()] = operationFor(route)
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Noema Crystal API',
      version: contract.version,
      description:
        'The crystal `/v1` REST surface: run flows, discover flows, observe runs. ' +
        'This document is generated from the in-code API contract — do not edit by hand.',
    },
    servers: [{ url: `/${contract.version}` }],
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Run: SCHEMAS.Run as object,
        Error: SCHEMAS.Error as object,
      },
    },
    'x-error-codes': contract.errorCodes,
  }
}

// ---------------------------------------------------------------------------
// Markdown reference
// ---------------------------------------------------------------------------

/** Render one JSON-Schema object as a fenced JSON block (stable formatting). */
function schemaBlock(schema: JsonSchema): string {
  return '```json\n' + JSON.stringify(schema, null, 2) + '\n```'
}

/**
 * Generate a readable markdown reference from the contract.
 * Pure & deterministic. Ends with a trailing newline.
 */
export function generateReference(contract: ApiContract): string {
  const lines: string[] = []

  lines.push(`# Noema Crystal API — ${contract.version} reference`)
  lines.push('')
  lines.push(
    '> Generated from the in-code API contract (`src/allocutio/api/apiContract.ts`). ' +
      'Do not edit by hand — run `npm run gen:api-docs`.',
  )
  lines.push('')
  lines.push(
    'The live, self-describing source of truth is `GET /v1/openapi.json` plus the ' +
      'discovery endpoints (`GET /v1/flows`, `GET /v1/flows/:id`). ' +
      'The dynamic catalog (which flows exist) is discovered live, never baked here.',
  )
  lines.push('')

  lines.push('## Operations')
  lines.push('')
  for (const route of contract.routes) {
    lines.push(`### ${route.method} /${contract.version}${route.path}`)
    lines.push('')
    lines.push(route.summary)
    lines.push('')
    lines.push(`- **Auth:** ${route.auth ? 'required' : 'public'}`)
    lines.push('')
    if (route.request) {
      lines.push('**Request body:**')
      lines.push('')
      lines.push(schemaBlock(route.request))
      lines.push('')
    }
    if (route.response) {
      lines.push('**Response (200):**')
      lines.push('')
      lines.push(schemaBlock(route.response))
      lines.push('')
    }
  }

  lines.push('## Error codes')
  lines.push('')
  lines.push(
    'Every failed request returns the uniform envelope ' +
      '`{ error: { code, message, retryable?, retryAfter?, details? } }`. ' +
      'Branch on the stable `code`.',
  )
  lines.push('')
  lines.push('| Code | HTTP status | Retryable |')
  lines.push('| --- | --- | --- |')
  for (const e of contract.errorCodes) {
    lines.push(`| \`${e.code}\` | ${e.httpStatus} | ${e.retryable ? 'yes' : 'no'} |`)
  }
  lines.push('')

  return lines.join('\n')
}
