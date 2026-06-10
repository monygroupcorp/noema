import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { Run } from '../../../../src/allocutio/api/types.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const fakeApi: ApiFacade = {
  async invokeFlow(): Promise<Run> {
    return { id: 'r1', status: 'complete', modusId: 'flux-schnell' }
  },
  async getRun(_auctor: AuctorKey, id: string): Promise<Run> {
    if (id === 'r1') return { id: 'r1', status: 'complete', modusId: 'flux-schnell' }
    throw Errors.notFoundRun(id)
  },
  async listFlows(): Promise<unknown[]> {
    return [{ id: 'flux-schnell', nomen: 'FLUX' }]
  },
  async describeFlow(id: string): Promise<unknown> {
    if (id === 'flux-schnell') return { id, input: { type: 'object' } }
    throw Errors.notFoundFlow(id)
  },
}

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey) return { animaId: 'a1' }
    throw Errors.authMissing()
  },
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function createServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: fakeApi, identity: fakeIdentity }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
}

interface HttpResult {
  status: number
  body: any
}

function request(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(payload))
    }
    const req = http.request(url, { method: opts.method ?? 'GET', headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c as Buffer))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('POST /v1/runs with auth + body returns 200 and the run', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: { modusId: 'flux-schnell', aditus: { prompt: 'hi' } },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.run.id, 'r1')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/runs with no auth returns 401 auth.missing', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs`, {
      method: 'POST',
      body: { modusId: 'flux-schnell' },
    })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'auth.missing')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/flows requires no auth and returns the catalog', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/flows`)
    assert.equal(res.status, 200)
    assert.equal(res.body.flows.length, 1)
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/runs/:id for an unknown run returns 404 not_found.run', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs/ghost`, { headers: { 'x-api-key': 'k' } })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.run')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/flows/:id returns 200 with the schema', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/flows/flux-schnell`)
    assert.equal(res.status, 200)
    assert.ok(res.body.input)
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/openapi.json returns the live self-describing spec (no auth)', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/openapi.json`)
    assert.equal(res.status, 200)
    assert.equal(String(res.body.openapi).startsWith('3.'), true, 'an OpenAPI 3.x document')
    assert.ok(res.body.paths, 'has paths')
  } finally {
    await closeServer(server)
  }
})
