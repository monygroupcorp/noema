// =============================================================================
// Tabulae HTTP surface — hermetic route + facade test
// =============================================================================
//
// Real `CrystalApi` + real `createApiRouter`, backed by `MemoryTabula` (the
// hermetic twin) and a minimal in-memory Modorum fake seeded with sd1-5 +
// upscale. Drives actual HTTP requests — covers the CRUD round-trip, publish
// → runnable modusId, cycle/mismatch → 400 with the offending vinculum, and
// owner-scoped auth (a stranger gets 404, not 403).
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { createApiRouter, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import { MemoryTabula } from '../../../../src/crystal/MemoryTabula.js'
import { ESSENTIA_RUNMAKE_SD15, ESSENTIA_UPSCALE } from '../../../../src/crystal/seeds/essentiae.js'
import type { Modus, Modi, Modorum } from '../../../../src/types/modus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'

// ── A minimal in-memory Modorum fake (find/register/list only — enough for compile+publish) ──
function makeFakeModorum(seed: Modus[]): Modorum {
  const byId = new Map<string, Modus>(seed.map(m => [m.id, m]))
  return {
    async find(id: string) { return byId.get(id) ?? null },
    async register(m: Modus) { byId.set(m.id, m) },
    async list(filter?: Partial<Pick<Modus, 'genus' | 'canonica' | 'auctor'>>): Promise<Modi> {
      let all = Array.from(byId.values())
      if (filter?.canonica !== undefined) all = all.filter(m => m.canonica === filter.canonica)
      if (filter?.genus !== undefined) all = all.filter(m => m.genus === filter.genus)
      return all
    },
    async update() { throw new Error('unused') },
  }
}

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey) return { animaId: creds.apiKey }
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

function createServer(tabulae: MemoryTabula, modorum: Modorum): Promise<{ server: http.Server; url: string }> {
  const deps = {
    tabulae,
    modorum,
  } as unknown as CrystalApiDeps
  const api = new CrystalApi(deps)
  return new Promise((resolveP, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: api as unknown as Parameters<typeof createApiRouter>[0]['api'], identity: fakeIdentity }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolveP({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolveP, reject) => server.close(err => (err ? reject(err) : resolveP())))
}

interface HttpResult { status: number; body: any }

function request(url: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<HttpResult> {
  return new Promise((resolveP, reject) => {
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
        resolveP({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

test('Tabula CRUD round-trips and publish yields a runnable modusId', async () => {
  const { server, url } = await createServer(new MemoryTabula(), makeFakeModorum([ESSENTIA_RUNMAKE_SD15, ESSENTIA_UPSCALE]))
  try {
    const headers = { 'x-api-key': 'owner-1' }

    const created = await request(`${url}/v1/tabulae`, { method: 'POST', headers, body: { nomen: 'My Spell' } })
    assert.equal(created.status, 201)
    const id = created.body.tabula.id
    assert.equal(created.body.tabula.status, 'draft')

    const listed = await request(`${url}/v1/tabulae`, { headers })
    assert.equal(listed.body.tabulae.length, 1)

    const patched = await request(`${url}/v1/tabulae/${id}`, {
      method: 'PUT',
      headers,
      body: {
        nodi: [
          { id: 'n0', modusId: 'sd1-5', x: 0, y: 0, aditus: {} },
          { id: 'n1', modusId: 'upscale', x: 0, y: 0, aditus: {} },
        ],
        vincula: [{ id: 'v1', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image', discordantia: false }],
      },
    })
    assert.equal(patched.status, 200)
    assert.equal(patched.body.tabula.nodi.length, 2)

    const published = await request(`${url}/v1/tabulae/${id}/publish`, { method: 'POST', headers })
    assert.equal(published.status, 200)
    assert.ok(published.body.modusId)

    const reGet = await request(`${url}/v1/tabulae/${id}`, { headers })
    assert.equal(reGet.body.tabula.status, 'published')
    assert.equal(reGet.body.tabula.modusId, published.body.modusId)

    const deleted = await request(`${url}/v1/tabulae/${id}`, { method: 'DELETE', headers })
    assert.equal(deleted.status, 200)
    const gone = await request(`${url}/v1/tabulae/${id}`, { headers })
    assert.equal(gone.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('a stranger gets 404, not 403, on someone else\'s Tabula', async () => {
  const { server, url } = await createServer(new MemoryTabula(), makeFakeModorum([]))
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const created = await request(`${url}/v1/tabulae`, { method: 'POST', headers: owner, body: { nomen: 'Mine' } })
    const id = created.body.tabula.id

    const got = await request(`${url}/v1/tabulae/${id}`, { headers: stranger })
    assert.equal(got.status, 404)

    const updated = await request(`${url}/v1/tabulae/${id}`, { method: 'PUT', headers: stranger, body: { nomen: 'Hijacked' } })
    assert.equal(updated.status, 404)

    const deleted = await request(`${url}/v1/tabulae/${id}`, { method: 'DELETE', headers: stranger })
    assert.equal(deleted.status, 404)

    const published = await request(`${url}/v1/tabulae/${id}/publish`, { method: 'POST', headers: stranger })
    assert.equal(published.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('anon commitment auctors can author + own their Tabula', async () => {
  const { server, url } = await createServer(new MemoryTabula(), makeFakeModorum([]))
  try {
    const anon = { 'x-commitment': 'commit-abc' }
    const created = await request(`${url}/v1/tabulae`, { method: 'POST', headers: anon, body: { nomen: 'Anon Draft' } })
    assert.equal(created.status, 201)
    const id = created.body.tabula.id

    const got = await request(`${url}/v1/tabulae/${id}`, { headers: anon })
    assert.equal(got.status, 200)

    const strangerAnon = { 'x-commitment': 'commit-other' }
    const gotByOther = await request(`${url}/v1/tabulae/${id}`, { headers: strangerAnon })
    assert.equal(gotByOther.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('publish 400s on a cycle, naming the offending vinculum', async () => {
  const { server, url } = await createServer(new MemoryTabula(), makeFakeModorum([ESSENTIA_RUNMAKE_SD15, ESSENTIA_UPSCALE]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/tabulae`, { method: 'POST', headers, body: { nomen: 'Loopy' } })
    const id = created.body.tabula.id
    await request(`${url}/v1/tabulae/${id}`, {
      method: 'PUT',
      headers,
      body: {
        nodi: [
          { id: 'n0', modusId: 'sd1-5', x: 0, y: 0, aditus: {} },
          { id: 'n1', modusId: 'upscale', x: 0, y: 0, aditus: {} },
        ],
        vincula: [
          { id: 'v1', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image', discordantia: false },
          { id: 'v2', fonteNodusId: 'n1', fontePorta: 'image', scopusNodusId: 'n0', scopusPorta: 'prompt', discordantia: false },
        ],
      },
    })
    const published = await request(`${url}/v1/tabulae/${id}/publish`, { method: 'POST', headers })
    assert.equal(published.status, 400)
    assert.equal(published.body.error.code, 'input.invalid_graph')
    assert.ok(['v1', 'v2'].includes(published.body.error.details.vinculumId))
  } finally {
    await closeServer(server)
  }
})

test('publish 400s on a port-type mismatch, naming the offending vinculum', async () => {
  const mismatched: Modus = { ...ESSENTIA_UPSCALE, id: 'weird-int-sink', aditus: { image: { type: 'int', required: true } } }
  const { server, url } = await createServer(new MemoryTabula(), makeFakeModorum([ESSENTIA_RUNMAKE_SD15, mismatched]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/tabulae`, { method: 'POST', headers, body: { nomen: 'Mismatch' } })
    const id = created.body.tabula.id
    await request(`${url}/v1/tabulae/${id}`, {
      method: 'PUT',
      headers,
      body: {
        nodi: [
          { id: 'n0', modusId: 'sd1-5', x: 0, y: 0, aditus: {} },
          { id: 'n1', modusId: 'weird-int-sink', x: 0, y: 0, aditus: {} },
        ],
        vincula: [
          { id: 'v-bad', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image', discordantia: true },
        ],
      },
    })
    const published = await request(`${url}/v1/tabulae/${id}/publish`, { method: 'POST', headers })
    assert.equal(published.status, 400)
    assert.equal(published.body.error.code, 'input.invalid_graph')
    assert.equal(published.body.error.details.vinculumId, 'v-bad')
  } finally {
    await closeServer(server)
  }
})
