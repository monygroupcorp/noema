// =============================================================================
// apiRouter — the /v1 error seam's log line (noema-163)
// =============================================================================
//
// Guards the shape AND the minimisation of the single structured line the router
// emits when a request fails. Each case is written so that deleting the guard it
// protects makes it fail:
//
//   - a 4xx carries the code and NOT the error message
//   - a 5xx carries the message
//   - the `route` field is the TEMPLATE, and a populated id appears nowhere
//   - `details` stays on the wire and never reaches the log
//   - a successful request emits nothing (there is no request log)
//   - `x-request-id` on the response matches the logged `requestId`
//   - the caller is a keyed digest, or absent — never a raw id
//
// The logger fans out to the in-process `bus` as well as stdout, so the assertions
// read the structured entry rather than scraping stdout.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { ApiError, Errors } from '../../../../src/allocutio/api/errors.js'
import type { Run } from '../../../../src/allocutio/api/types.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'
import { bus } from '../../../../src/lib/bus.js'
import type { LogEntry } from '../../../../src/lib/logger.js'

// A neutral, real-SHAPED id: 24 hex chars, the shape the populated path would carry.
const SAMPLE_RUN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const SAMPLE_ANIMA_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'

// ---------------------------------------------------------------------------
// Fakes — one route per failure shape, driven off the run id.
// ---------------------------------------------------------------------------

const fakeApi = {
  async getRun(_auctor: AuctorKey, id: string): Promise<Run> {
    if (id === 'ok') return { id: 'ok', status: 'complete', modusId: 'flux-schnell' }
    if (id === 'boom') throw Errors.internal('deliberate 5xx for the seam test')
    if (id === 'detailed') {
      throw new ApiError('input.invalid_aditus', 'Inputs do not match the flow schema', 422, {
        details: { field: 'sample' },
      })
    }
    if (id === 'unhandled') throw new TypeError('not an ApiError')
    throw Errors.notFoundRun(id)
  },
} as unknown as ApiFacade

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey) return { animaId: SAMPLE_ANIMA_ID }
    throw Errors.authMissing()
  },
  // `Identity` also carries `resolveCaller` (identity + the limits the CREDENTIAL imposes, e.g. a
  // partner API key's per-run spend ceiling). These fakes mint no ceiling, so it is `resolve` plus
  // an empty limit set — which is exactly the shape a key with no ceiling resolves to.
  async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
    return { auctor: await this.resolve(creds) }
  },
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let entries: LogEntry[] = []
const collect = (entry: LogEntry): void => {
  if (entry.component === 'api:router') entries.push(entry)
}

let savedSecret: string | undefined

beforeEach(() => {
  entries = []
  bus.on('log', collect)
  savedSecret = process.env.INTERNAL_SECRET
  delete process.env.INTERNAL_SECRET
})

afterEach(() => {
  bus.off('log', collect)
  if (savedSecret === undefined) delete process.env.INTERNAL_SECRET
  else process.env.INTERNAL_SECRET = savedSecret
})

function createServer(opts: { anonPurseEnabled?: boolean } = {}): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: fakeApi, identity: fakeIdentity, ...opts }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

interface HttpResult {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function request(url: string, headers: Record<string, string> = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Run one request against a fresh server and hand back the response + the seam's entries. */
async function call(
  path: string,
  headers: Record<string, string> = {},
  opts: { anonPurseEnabled?: boolean } = {},
): Promise<HttpResult> {
  const { server, url } = await createServer(opts)
  try {
    return await request(url + path, headers)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
  }
}

const AUTHED = { 'x-api-key': 'k-test' }

const only = (): LogEntry => {
  assert.equal(entries.length, 1, `expected exactly one seam log entry, got ${entries.length}`)
  return entries[0]!
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

test('a 4xx ApiError logs one warn entry with the code, and no message', async () => {
  const res = await call(`/v1/runs/${SAMPLE_RUN_ID}`, AUTHED)
  assert.equal(res.status, 404)

  const entry = only()
  assert.equal(entry.level, 'warn')
  assert.equal(entry.msg, 'api error')
  assert.equal(entry.code, 'not_found.run')
  assert.equal(entry.status, 404)
  assert.equal(entry.route, '/v1/runs/:id')
  assert.equal(entry.method, 'GET')
  assert.equal(typeof entry.requestId, 'string')
  assert.equal(typeof entry.durationMs, 'number')
  // The 4xx message can quote caller input, so it must never reach the line.
  assert.ok(!('message' in entry), 'a 4xx entry must not carry the ApiError message')
})

test('a 5xx ApiError logs an error entry that DOES carry the message', async () => {
  const res = await call('/v1/runs/boom', AUTHED)
  assert.equal(res.status, 500)

  const entry = only()
  assert.equal(entry.level, 'error')
  assert.equal(entry.msg, 'api error')
  assert.equal(entry.code, 'internal.error')
  assert.equal(entry.status, 500)
  assert.equal(entry.message, 'deliberate 5xx for the seam test')
})

test('the logged route is the template — a populated id appears nowhere in the entry', async () => {
  const res = await call(`/v1/runs/${SAMPLE_RUN_ID}`, AUTHED)
  assert.equal(res.status, 404)

  const entry = only()
  assert.equal(entry.route, '/v1/runs/:id')
  assert.ok(
    !JSON.stringify(entry).includes(SAMPLE_RUN_ID),
    'the populated path id must not appear anywhere in the serialised log entry',
  )
})

test('ApiError details stay on the wire and never reach the log entry', async () => {
  const res = await call('/v1/runs/detailed', AUTHED)
  assert.equal(res.status, 422)

  // Wire contract unchanged.
  const body = JSON.parse(res.body) as { error: { code: string; details?: Record<string, unknown> } }
  assert.equal(body.error.code, 'input.invalid_aditus')
  assert.deepEqual(body.error.details, { field: 'sample' })

  const entry = only()
  assert.ok(!('details' in entry), 'details is caller-shaped and must not be logged')
  assert.ok(!JSON.stringify(entry).includes('sample'), 'no details value may appear in the entry')
})

test('a successful request emits no log entry from this seam', async () => {
  const res = await call('/v1/runs/ok', AUTHED)
  assert.equal(res.status, 200)
  assert.equal(entries.length, 0, 'there is no request log — successes are silent')
})

test('the response carries x-request-id matching the logged requestId', async () => {
  const res = await call(`/v1/runs/${SAMPLE_RUN_ID}`, AUTHED)
  const header = res.headers['x-request-id']
  assert.equal(typeof header, 'string')
  assert.equal(only().requestId, header)
})

test('INTERNAL_SECRET unset — no callerHash field, and no raw id anywhere', async () => {
  const res = await call(`/v1/runs/${SAMPLE_RUN_ID}`, AUTHED)
  assert.equal(res.status, 404)

  const entry = only()
  assert.ok(!('callerHash' in entry), 'without a key there is no digest, and no fallback')
  assert.ok(
    !JSON.stringify(entry).includes(SAMPLE_ANIMA_ID),
    'the raw caller id must never appear in the entry',
  )
})

test('INTERNAL_SECRET set — callerHash is a 12-char keyed digest, never the raw id', async () => {
  process.env.INTERNAL_SECRET = 'test-key-not-a-real-secret'
  const res = await call(`/v1/runs/${SAMPLE_RUN_ID}`, AUTHED)
  assert.equal(res.status, 404)

  const entry = only()
  assert.match(String(entry.callerHash), /^[0-9a-f]{12}$/)
  assert.ok(
    !JSON.stringify(entry).includes(SAMPLE_ANIMA_ID),
    'the raw caller id must never appear in the entry',
  )
})

test('a bursaToken caller is never used to derive a log field', async () => {
  process.env.INTERNAL_SECRET = 'test-key-not-a-real-secret'
  const token = 'bursa-token-value-for-the-test'
  // anonPurseEnabled defaults false and no bursarium is wired, so the fail-closed 503 fires.
  const res = await call('/v1/runs/ok', { 'x-bursa-token': token })
  assert.equal(res.status, 503)

  const entry = only()
  assert.equal(entry.level, 'error')
  assert.equal(entry.code, 'purse.disabled')
  assert.ok(!('callerHash' in entry), 'a bearer credential yields no caller field at all')
  assert.ok(
    !JSON.stringify(entry).includes(token),
    'a bearer credential must not appear, hashed or otherwise, in the entry',
  )
})

test('an unhandled (non-ApiError) throw logs the template, not the populated path', async () => {
  const res = await call('/v1/runs/unhandled', AUTHED)
  assert.equal(res.status, 500)

  const entry = only()
  assert.equal(entry.msg, 'unhandled API error')
  assert.equal(entry.route, '/v1/runs/:id')
  assert.equal(typeof entry.requestId, 'string')
  assert.equal(typeof entry.durationMs, 'number')
  assert.ok(!JSON.stringify(entry).includes('/v1/runs/unhandled'), 'the populated path must not be logged')
})
