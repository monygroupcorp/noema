import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { Run } from '../../../../src/allocutio/api/types.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { ModelCard, SaveFlowOpts, StatusView, ProvisionStudioOpts, StudioView } from '../../../../src/allocutio/api/CrystalApi.js'

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
  async quote(): Promise<{ impetus: string }> {
    return { impetus: '42' }
  },
  async listFundamenta() {
    return [
      { id: 'flux-comfyui', nomen: 'FLUX · ComfyUI', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.1.0' },
    ]
  },
  async listModels(): Promise<ModelCard[]> {
    return [
      { intellaId: 'flux-dev', nomen: 'FLUX Dev', genus: 'checkpoint', basis: 'flux' },
      { intellaId: 'flux-lora-1', nomen: 'Flux LoRA 1', genus: 'lora', basis: 'flux' },
    ]
  },
  async saveFlow(_auctor: AuctorKey, _opts: SaveFlowOpts): Promise<{ id: string }> {
    return { id: 'my-flow' }
  },
  async bind(_auctor: AuctorKey, verb: string, modusId: string): Promise<{ verb: string; modusId: string }> {
    return { verb, modusId }
  },
  async status(_auctor: AuctorKey): Promise<StatusView> {
    return {
      balanceImpetus: '100',
      balanceUsd: 0.01,
      gens: [],
      studios: [],
      joinable: [],
      takenAt: new Date().toISOString(),
    }
  },
  async provisionStudio(_auctor: AuctorKey, opts: ProvisionStudioOpts): Promise<StudioView> {
    lastProvisionOpts = opts
    if (opts.runtime === 'no-pods') throw Errors.capacityNoPods()
    return { studioId: 'modo-1', status: 'provisioning', budgetImpetus: '100' }
  },
  async getStudio(_auctor: AuctorKey, studioId: string): Promise<StudioView> {
    if (studioId === 'ghost') throw Errors.notFoundStudio(studioId)
    return { studioId, status: 'idle', budgetImpetus: '100', podId: 'pod-1' }
  },
  async listStudios(_auctor: AuctorKey): Promise<StudioView[]> {
    return [{ studioId: 'modo-1', status: 'idle', budgetImpetus: '100' }]
  },
}

// Records the opts the router forwarded to provisionStudio.
let lastProvisionOpts: ProvisionStudioOpts | undefined

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

test('POST /v1/runs/quote with auth returns 200 { impetus }', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs/quote`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: { modusId: 'flux-schnell', aditus: { prompt: 'hi' } },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.impetus, '42')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/runs/quote without auth returns 401', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs/quote`, {
      method: 'POST',
      body: { modusId: 'flux-schnell' },
    })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'auth.missing')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/fundamenta returns 200 { fundamenta } with no auth', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/fundamenta`)
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.fundamenta))
    assert.equal(res.body.fundamenta.length, 1)
    assert.equal(res.body.fundamenta[0].id, 'flux-comfyui')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/models?genus=lora returns 200 { models } with no auth', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/models?genus=lora`)
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.models))
    // fakeApi.listModels ignores the filter and returns both; we just check envelope shape
    assert.ok(res.body.models.length >= 1)
    assert.ok(res.body.models[0].intellaId)
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/flows with auth returns 201 { id }', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/flows`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: { modusId: 'flux-schnell', name: 'My Flow' },
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.id, 'my-flow')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/flows without auth returns 401', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/flows`, {
      method: 'POST',
      body: { modusId: 'flux-schnell', name: 'My Flow' },
    })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'auth.missing')
  } finally {
    await closeServer(server)
  }
})

test('PUT /v1/me/bindings/make with auth returns 200 { verb, modusId }', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/me/bindings/make`, {
      method: 'PUT',
      headers: { 'x-api-key': 'k' },
      body: { modusId: 'flux-schnell' },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.verb, 'make')
    assert.equal(res.body.modusId, 'flux-schnell')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/me/status with auth returns 200 with balanceImpetus', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/me/status`, {
      headers: { 'x-api-key': 'k' },
    })
    assert.equal(res.status, 200)
    assert.equal(typeof res.body.balanceImpetus, 'string')
    assert.equal(res.body.balanceImpetus, '100')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/me/status without auth returns 401', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/me/status`)
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'auth.missing')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/studios with auth returns 201 { studio } and passes the body through', async () => {
  const { server, url } = await createServer()
  try {
    lastProvisionOpts = undefined
    const res = await request(`${url}/v1/studios`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: { fundamentumId: 'flux-comfyui', models: ['flux-dev'], warmMs: 60000, maxImpetus: '50' },
    })
    assert.equal(res.status, 201)
    assert.equal(res.body.studio.studioId, 'modo-1')
    assert.equal(res.body.studio.budgetImpetus, '100')
    assert.deepEqual(lastProvisionOpts, {
      fundamentumId: 'flux-comfyui',
      models: ['flux-dev'],
      warmMs: 60000,
      maxImpetus: '50',
    })
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/studios with auth returns 200 { studios }', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/studios`, { headers: { 'x-api-key': 'k' } })
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.studios))
    assert.equal(res.body.studios.length, 1)
    assert.equal(res.body.studios[0].studioId, 'modo-1')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/studios/:id returns the studio; 404 not_found.studio for an unknown id', async () => {
  const { server, url } = await createServer()
  try {
    const ok = await request(`${url}/v1/studios/modo-7`, { headers: { 'x-api-key': 'k' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.studio.studioId, 'modo-7')

    const missing = await request(`${url}/v1/studios/ghost`, { headers: { 'x-api-key': 'k' } })
    assert.equal(missing.status, 404)
    assert.equal(missing.body.error.code, 'not_found.studio')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/studios maps an ApiError to its httpStatus + { error }', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/studios`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      body: { runtime: 'no-pods' },
    })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'capacity.no_pods')
  } finally {
    await closeServer(server)
  }
})
