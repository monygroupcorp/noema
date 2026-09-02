import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { Run } from '../../../../src/allocutio/api/types.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { ModelCard, SaveFlowOpts, StatusView, ProvisionStudioOpts, StudioView, MyDeposit, MeView } from '../../../../src/allocutio/api/CrystalApi.js'
import type { Bursa, Bursarum } from '../../../../src/types/bursa.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const fakeApi = {
  async invokeFlow(): Promise<Run> {
    return { id: 'r1', status: 'complete', modusId: 'flux-schnell' }
  },
  async getRun(_auctor: AuctorKey, id: string): Promise<Run> {
    if (id === 'r1') return { id: 'r1', status: 'complete', modusId: 'flux-schnell' }
    throw Errors.notFoundRun(id)
  },
  async cancelRun(auctor: AuctorKey, id: string): Promise<Run> {
    if (id !== 'r1') throw Errors.notFoundRun(id)
    lastCancelAuctor = auctor
    return { id: 'r1', status: 'failed', modusId: 'flux-schnell', failure: { code: 'run.execution_error', message: 'stopped' } }
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
  async releaseStudio(_auctor: AuctorKey, studioId: string): Promise<StudioView> {
    if (studioId === 'ghost') throw Errors.notFoundStudio(studioId)
    return { studioId, status: 'terminated', budgetImpetus: '100' }
  },
  async myDeposits(auctor: AuctorKey): Promise<MyDeposit[]> {
    // Mirrors the real owner-scoping: only 'a1' (the fake identity's resolved animaId) has rows.
    if (!('animaId' in auctor) || auctor.animaId !== 'a1') return []
    return [{ id: 'dep-1', chainId: 1, txHash: '0xhash1', valor: '1000000000000000', status: 'confirmatum', natum: '2026-07-01T00:00:00.000Z' }]
  },
  async getMe(auctor: AuctorKey): Promise<MeView> {
    // Balance mirrors fakeApi.status() for the same auctor (they must never disagree).
    const balanceImpetus = '100'
    const balanceUsd = 0.01
    const base = { bindings: [], secrets: { civitai: 'absent', huggingface: 'absent' } as const, secretsAvailable: true, admin: false, balanceImpetus, balanceUsd }
    if (!('animaId' in auctor)) return base
    // 'a1' has a password persona (username present); 'a2' has an anima but no password persona.
    if (auctor.animaId === 'a1') return { ...base, animaId: 'a1', username: 'alice' }
    return { ...base, animaId: auctor.animaId }
  },
  // Only the methods these routes reach are provided; every one is signature-checked
  // against the real facade, and an unreached route would fail loudly at call time.
} satisfies Partial<ApiFacade>

// Records the opts the router forwarded to provisionStudio.
let lastProvisionOpts: ProvisionStudioOpts | undefined

// Records the auctor the router forwarded to cancelRun — it must be the RESOLVED caller.
let lastCancelAuctor: AuctorKey | undefined

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'k2') return { animaId: 'a2' }
    if (creds.apiKey) return { animaId: 'a1' }
    if (creds.commitment) return { commitment: creds.commitment }
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
// Server helpers
// ---------------------------------------------------------------------------

function createServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: fakeApi as unknown as ApiFacade, identity: fakeIdentity }))
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

test('POST /v1/runs/:id/cancel with auth returns 200 { run } in its terminal view', async () => {
  const { server, url } = await createServer()
  try {
    lastCancelAuctor = undefined
    const res = await request(`${url}/v1/runs/r1/cancel`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
      // A body is neither read nor needed — the owner comes from the credential.
      body: { animaId: 'someone-else' },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.run.id, 'r1')
    assert.equal(res.body.run.status, 'failed')
    assert.deepEqual(lastCancelAuctor, { animaId: 'a1' }, 'the owner is the resolved caller, never the body')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/runs/:id/cancel for a run that is not the caller\'s returns 404 not_found.run', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs/ghost/cancel`, {
      method: 'POST',
      headers: { 'x-api-key': 'k' },
    })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.run')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/runs/:id/cancel with no auth returns 401 auth.missing', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/runs/r1/cancel`, { method: 'POST' })
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'auth.missing')
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

test('GET /v1/me for a password-identified caller returns animaId, username, and balance', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/me`, {
      headers: { 'x-api-key': 'k' },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.animaId, 'a1')
    assert.equal(res.body.username, 'alice')
    assert.equal(res.body.balanceImpetus, '100')
    assert.equal(res.body.balanceUsd, 0.01)
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/me for a purse/anonymous caller returns 200 with animaId and username absent', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/me`, {
      headers: { 'x-commitment': 'c1' },
    })
    assert.equal(res.status, 200)
    assert.equal('animaId' in res.body, false)
    assert.equal('username' in res.body, false)
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/me for an anima with no password persona returns animaId with username absent', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/me`, {
      headers: { 'x-api-key': 'k2' },
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.animaId, 'a2')
    assert.equal('username' in res.body, false)
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/me and GET /v1/me/status report the same balance for the same caller', async () => {
  const { server, url } = await createServer()
  try {
    const me = await request(`${url}/v1/me`, { headers: { 'x-api-key': 'k' } })
    const status = await request(`${url}/v1/me/status`, { headers: { 'x-api-key': 'k' } })
    assert.equal(me.body.balanceImpetus, status.body.balanceImpetus)
    assert.equal(me.body.balanceUsd, status.body.balanceUsd)
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

test('DELETE /v1/studios/:id returns the terminal view; 404 not_found.studio for an unknown id', async () => {
  const { server, url } = await createServer()
  try {
    const ok = await request(`${url}/v1/studios/modo-7`, { method: 'DELETE', headers: { 'x-api-key': 'k' } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.studio.studioId, 'modo-7')
    assert.equal(ok.body.studio.status, 'terminated')

    const missing = await request(`${url}/v1/studios/ghost`, { method: 'DELETE', headers: { 'x-api-key': 'k' } })
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

test('GET /v1/deposit/mine requires auth — 401 for an anon caller (no api key)', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/deposit/mine`)
    assert.equal(res.status, 401)
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/deposit/mine returns the authenticated caller\'s own deposits, envelope-wrapped', async () => {
  const { server, url } = await createServer()
  try {
    const res = await request(`${url}/v1/deposit/mine`, { headers: { 'x-api-key': 'k' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.deposits.length, 1)
    assert.equal(res.body.deposits[0].id, 'dep-1')
    assert.equal(res.body.deposits[0].status, 'confirmatum')
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// ANON_PURSE gate (noema-131) — the anonymous ZK purse is OFF for v1 (the arcanum
// proving key is a forgeable dev key until the trusted-setup ceremony). A bare
// x-bursa-token spend is the money chokepoint: when the flag is off we resolve the
// bursa and refuse the OWNERLESS/arcanum (or unknown) one, while a SOUND owned purse
// (owner set, identified funder) spends unchanged. Flag on = pre-131 behavior.
// ---------------------------------------------------------------------------

const OWNED_BURSA: Bursa = { id: 'owned-tok', credits: 500n, createdAt: new Date(), owner: { animaId: 'a1' } }
const ANON_BURSA: Bursa = { id: 'anon-tok', credits: 500n, createdAt: new Date() }

function gateBursarium(...rows: Bursa[]): Bursarum {
  const byId = new Map(rows.map((b) => [b.id, b]))
  return { async findByToken(token: string) { return byId.get(token) ?? null } } as unknown as Bursarum
}

function createGatedServer(opts: { anonPurseEnabled: boolean; bursarium: Bursarum }): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: fakeApi as unknown as ApiFacade, identity: fakeIdentity, anonPurseEnabled: opts.anonPurseEnabled, bursarium: opts.bursarium }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

test('ANON_PURSE off: POST /v1/runs with an ownerless x-bursa-token is refused 503 (purse.disabled)', async () => {
  const { server, url } = await createGatedServer({ anonPurseEnabled: false, bursarium: gateBursarium(ANON_BURSA, OWNED_BURSA) })
  try {
    const res = await request(`${url}/v1/runs`, { method: 'POST', headers: { 'x-bursa-token': 'anon-tok' }, body: { modusId: 'flux-schnell', verb: 'run' } })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'purse.disabled')
  } finally {
    await closeServer(server)
  }
})

test('ANON_PURSE off: an unknown x-bursa-token (no such purse) is refused 503 (fail-closed)', async () => {
  const { server, url } = await createGatedServer({ anonPurseEnabled: false, bursarium: gateBursarium(OWNED_BURSA) })
  try {
    const res = await request(`${url}/v1/runs`, { method: 'POST', headers: { 'x-bursa-token': 'ghost-tok' }, body: { modusId: 'flux-schnell', verb: 'run' } })
    assert.equal(res.status, 503)
  } finally {
    await closeServer(server)
  }
})

test('ANON_PURSE off: a SOUND owned purse (owner set) spends unchanged → 200', async () => {
  const { server, url } = await createGatedServer({ anonPurseEnabled: false, bursarium: gateBursarium(ANON_BURSA, OWNED_BURSA) })
  try {
    const res = await request(`${url}/v1/runs`, { method: 'POST', headers: { 'x-bursa-token': 'owned-tok' }, body: { modusId: 'flux-schnell', verb: 'run' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.run.id, 'r1')
  } finally {
    await closeServer(server)
  }
})

test('ANON_PURSE on: an ownerless x-bursa-token spends unchanged → 200 (post-ceremony restore)', async () => {
  const { server, url } = await createGatedServer({ anonPurseEnabled: true, bursarium: gateBursarium(ANON_BURSA, OWNED_BURSA) })
  try {
    const res = await request(`${url}/v1/runs`, { method: 'POST', headers: { 'x-bursa-token': 'anon-tok' }, body: { modusId: 'flux-schnell', verb: 'run' } })
    assert.equal(res.status, 200)
    assert.equal(res.body.run.id, 'r1')
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// POST /v1/runs — the per-key spend ceiling reaches invokeFlow, and only from
// the credential
// ---------------------------------------------------------------------------

/** A server whose identity mints a ceiling for one specific key, and whose api records the
 *  `InvokeOpts` the route built. */
function createCeilingServer(): Promise<{ server: http.Server; url: string; seen: () => any }> {
  let lastOpts: any
  const api = {
    async invokeFlow(_auctor: AuctorKey, _t: unknown, _a: unknown, opts: unknown): Promise<Run> {
      lastOpts = opts
      return { id: 'r1', status: 'complete', modusId: 'flux-schnell' }
    },
  } as unknown as ApiFacade
  // `capped-key` is a partner key minted with a per-run ceiling; `plain-key` is an ordinary one.
  const identity: Identity = {
    async resolve(creds: Credentials): Promise<AuctorKey> {
      return (await this.resolveCaller(creds)).auctor
    },
    async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
      if (creds.apiKey === 'capped-key') return { auctor: { animaId: 'partner' }, maxImpetusPerRun: 250000n }
      if (creds.apiKey) return { auctor: { animaId: 'a1' } }
      throw Errors.authMissing()
    },
  }
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api, identity }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, seen: () => lastOpts })
    })
    server.on('error', reject)
  })
}

test("POST /v1/runs threads the KEY's ceiling into invokeFlow as keyMaxImpetusPerRun", async () => {
  const { server, url, seen } = await createCeilingServer()
  try {
    const res = await request(`${url}/v1/runs`, {
      method: 'POST',
      headers: { 'x-api-key': 'capped-key' },
      body: { modusId: 'flux-schnell', aditus: { prompt: 'hi' } },
    })
    assert.equal(res.status, 200)
    assert.equal(seen().keyMaxImpetusPerRun, 250000n, "the credential's ceiling reaches admission")
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/runs: a key with no ceiling sends no ceiling — the pre-existing shape', async () => {
  const { server, url, seen } = await createCeilingServer()
  try {
    const res = await request(`${url}/v1/runs`, {
      method: 'POST',
      headers: { 'x-api-key': 'plain-key' },
      body: { modusId: 'flux-schnell', aditus: { prompt: 'hi' }, maxImpetus: '9' },
    })
    assert.equal(res.status, 200)
    assert.equal('keyMaxImpetusPerRun' in seen(), false, 'no ceiling field is invented for an ordinary key')
    assert.equal(seen().maxImpetus, '9', "the caller's own cap is threaded exactly as before")
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/runs: the request BODY cannot set or raise the key ceiling', async () => {
  // The bearer of a capped key must not be able to write their own limit. `keyMaxImpetusPerRun`
  // is not a body field the route reads — the ceiling comes from the resolved credential and
  // nowhere else — and a body `maxImpetus` above it is just a looser number that `invokeFlow`'s
  // `min` discards.
  const { server, url, seen } = await createCeilingServer()
  try {
    const res = await request(`${url}/v1/runs`, {
      method: 'POST',
      headers: { 'x-api-key': 'capped-key' },
      body: {
        modusId: 'flux-schnell',
        aditus: { prompt: 'hi' },
        maxImpetus: '999999999',
        keyMaxImpetusPerRun: '999999999',
      },
    })
    assert.equal(res.status, 200)
    assert.equal(seen().keyMaxImpetusPerRun, 250000n, 'still the ceiling the CREDENTIAL carries')
    assert.equal(seen().maxImpetus, '999999999', 'the body cap is passed through, to be MIN-ed below it')
  } finally {
    await closeServer(server)
  }
})
