// vestigiaRouter — auth scoping (GET / + GET /projection resolve the CALLER; a
// stranger sees nothing of another account's vestigia) + the projection endpoint's
// shape/caching, plus DELETE /:id (remove-from-space) and POST /:id/impressio
// (feedback) — both owner-scoped, 404 for foreign/absent (noema-046, product ruling
// 2026-07-13). GET /search is unchanged and not re-tested here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createVestigiaRouter } from '../../../src/api/vestigia/vestigiaRouter.js'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'

// Deterministic fake embed: maps text -> a small fixed-dim vector so create() + a
// real indexPromptum() call populates embeddingPromptum without a live CLIP service.
async function fakeEmbed(text: string): Promise<number[]> {
  const dim = 8
  let seed = 0
  for (const ch of text) seed += ch.charCodeAt(0)
  return new Array(dim).fill(0).map((_, i) => Math.sin(seed + i))
}

// Fake identity resolver: `Authorization: Bearer <animaId>` resolves directly to
// that anima; anything else (including no header) fails auth — mirrors the real
// IdentityResolver's auth.missing/auth.invalid behavior closely enough for this test.
const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) {
      return { animaId: creds.authorization.slice('Bearer '.length) }
    }
    if (creds.commitment) return { commitment: creds.commitment }
    throw new Error('auth.missing')
  },
}

async function seed(vestigiorum: MemoryVestigiorum, animaId: string, promptum: string) {
  const v = await vestigiorum.create({
    modusId: 'modus.test',
    auctorKey: { animaId },
    promptum,
    summarium: promptum,
    genus: 'image',
    visibilitas: 'privata',
  })
  await vestigiorum.indexPromptum(v.id)
  return v
}

function makeServer(vestigiorum: MemoryVestigiorum) {
  const app = express()
  app.use(express.json())
  app.use('/api/vestigia', createVestigiaRouter({ vestigiorum, identity: fakeIdentity }))
  return new Promise<{ server: http.Server; url: string }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
}

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

function request(method: string, url: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const u = new URL(url)
    const req = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { ...headers, ...(payload ? { 'content-type': 'application/json' } : {}) } },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}
const del = (url: string, headers: Record<string, string> = {}) => request('DELETE', url, headers)
const post = (url: string, headers: Record<string, string> = {}, body?: unknown) => request('POST', url, headers, body)

test('GET /api/vestigia without credentials -> 401 (auth.missing)', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia`)
    assert.equal(res.status, 401)
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia resolves the CALLER — a stranger never sees another account\'s vestigia', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  await seed(vestigiorum, 'anima-b', 'a blue whale swimming')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const asA = await get(`${url}/api/vestigia`, { authorization: 'Bearer anima-a' })
    assert.equal(asA.status, 200)
    assert.equal(asA.body.count, 1)
    assert.equal(asA.body.vestigia[0].promptum, 'a red dragon breathing fire')

    const asB = await get(`${url}/api/vestigia`, { authorization: 'Bearer anima-b' })
    assert.equal(asB.status, 200)
    assert.equal(asB.body.count, 1)
    assert.equal(asB.body.vestigia[0].promptum, 'a blue whale swimming')

    // anima-a's response never contains anima-b's data or vice versa
    assert.ok(!asA.body.vestigia.some((v: any) => v.auctorKey?.animaId === 'anima-b'))
    assert.ok(!asB.body.vestigia.some((v: any) => v.auctorKey?.animaId === 'anima-a'))
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/projection without credentials -> 401', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/projection`)
    assert.equal(res.status, 401)
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/projection scopes to the caller and matches the projection contract', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  await seed(vestigiorum, 'anima-a', 'a red dragon in flight')
  await seed(vestigiorum, 'anima-b', 'a blue whale swimming')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/projection`, { authorization: 'Bearer anima-a' })
    assert.equal(res.status, 200)
    assert.equal(res.body.n, 2, 'only anima-a\'s two vestigia are projected')
    assert.equal(res.body.points.length, 2)
    for (const pt of res.body.points) {
      assert.equal(typeof pt.id, 'string')
      assert.equal(pt.p.length, 3)
      assert.equal(typeof pt.cluster, 'number')
    }
    assert.ok(Array.isArray(res.body.clusters))
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/projection: anon commitment caller with no vestigia -> n=0, no crash', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/projection`, { 'x-commitment': 'anon-commitment-xyz' })
    assert.equal(res.status, 200)
    assert.equal(res.body.n, 0)
    assert.deepEqual(res.body.points, [])
    assert.deepEqual(res.body.clusters, [])
  } finally {
    await closeServer(server)
  }
})

// ── DELETE /:id — remove-from-space (noema-046) ────────────────────────────────

test('DELETE /api/vestigia/:id without credentials -> 401', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await del(`${url}/api/vestigia/${v.id}`)
    assert.equal(res.status, 401)
  } finally {
    await closeServer(server)
  }
})

test('DELETE /api/vestigia/:id: owner can remove their own vestigium — gone after', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await del(`${url}/api/vestigia/${v.id}`, { authorization: 'Bearer anima-a' })
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.equal(await vestigiorum.findById(v.id), null)
  } finally {
    await closeServer(server)
  }
})

test('DELETE /api/vestigia/:id: a stranger gets 404, and the vestigium is untouched', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await del(`${url}/api/vestigia/${v.id}`, { authorization: 'Bearer anima-b' })
    assert.equal(res.status, 404)
    assert.ok(await vestigiorum.findById(v.id), 'vestigium must still exist — a stranger cannot delete it')
  } finally {
    await closeServer(server)
  }
})

test('DELETE /api/vestigia/:id: absent id -> 404 (same shape as foreign, no existence leak)', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await del(`${url}/api/vestigia/does-not-exist`, { authorization: 'Bearer anima-a' })
    assert.equal(res.status, 404)
  } finally {
    await closeServer(server)
  }
})

// ── POST /:id/impressio — feedback (noema-046) ──────────────────────────────────

test('POST /api/vestigia/:id/impressio without credentials -> 401', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await post(`${url}/api/vestigia/${v.id}/impressio`, {}, { impressio: 'amor' })
    assert.equal(res.status, 401)
  } finally {
    await closeServer(server)
  }
})

test('POST /api/vestigia/:id/impressio: owner sets their own reaction', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await post(`${url}/api/vestigia/${v.id}/impressio`, { authorization: 'Bearer anima-a' }, { impressio: 'amor' })
    assert.equal(res.status, 200)
    assert.equal(res.body.vestigium.impressio.auctorImpressio, 'amor')
  } finally {
    await closeServer(server)
  }
})

test('POST /api/vestigia/:id/impressio: impressio: null clears the reaction', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  await vestigiorum.setAuctorImpressio(v.id, { animaId: 'anima-a' }, 'risus')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await post(`${url}/api/vestigia/${v.id}/impressio`, { authorization: 'Bearer anima-a' }, { impressio: null })
    assert.equal(res.status, 200)
    assert.equal(res.body.vestigium.impressio.auctorImpressio, undefined)
  } finally {
    await closeServer(server)
  }
})

test('POST /api/vestigia/:id/impressio: a stranger gets 404, and the reaction is untouched', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await post(`${url}/api/vestigia/${v.id}/impressio`, { authorization: 'Bearer anima-b' }, { impressio: 'amor' })
    assert.equal(res.status, 404)
    const after = await vestigiorum.findById(v.id)
    assert.equal(after?.impressio.auctorImpressio, undefined)
  } finally {
    await closeServer(server)
  }
})

test('POST /api/vestigia/:id/impressio: invalid impressio value -> 400', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await post(`${url}/api/vestigia/${v.id}/impressio`, { authorization: 'Bearer anima-a' }, { impressio: 'nonsense' })
    assert.equal(res.status, 400)
  } finally {
    await closeServer(server)
  }
})

// ── GET /:id — visibilitas + ownership gate (noema-084) ─────────────────────────
//
// privata is owner-only: a foreign or unauthenticated caller 404s (same shape as an
// absent id — no existence leak). communis/publica stay open-by-id by design.

test('GET /api/vestigia/:id: absent id -> 404', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/does-not-exist`)
    assert.equal(res.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/:id: a privata vestigium with no credentials -> 404 (not 401, no existence leak)', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/${v.id}`)
    assert.equal(res.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/:id: a stranger gets 404, and the full record does not leak', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/${v.id}`, { authorization: 'Bearer anima-b' })
    assert.equal(res.status, 404)
    assert.equal(res.body.vestigium, undefined, 'no vestigium record may leak in the 404 body')
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/:id: the owner reads their own privata vestigium -> 200 with the full record', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await seed(vestigiorum, 'anima-a', 'a red dragon breathing fire')
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/${v.id}`, { authorization: 'Bearer anima-a' })
    assert.equal(res.status, 200)
    assert.equal(res.body.vestigium.promptum, 'a red dragon breathing fire')
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/:id: a communis vestigium is readable by anyone with the link (no credentials) -> 200', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await vestigiorum.create({
    modusId: 'modus.test',
    auctorKey: { animaId: 'anima-a' },
    promptum: 'a shared communis trace',
    summarium: 'a shared communis trace',
    genus: 'image',
    visibilitas: 'communis',
  })
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/${v.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.vestigium.promptum, 'a shared communis trace')
  } finally {
    await closeServer(server)
  }
})

test('GET /api/vestigia/:id: a publica vestigium is readable by anyone (no credentials) -> 200', async () => {
  const vestigiorum = new MemoryVestigiorum(fakeEmbed)
  const v = await vestigiorum.create({
    modusId: 'modus.test',
    auctorKey: { animaId: 'anima-a' },
    promptum: 'a public gallery trace',
    summarium: 'a public gallery trace',
    genus: 'image',
    visibilitas: 'publica',
  })
  const { server, url } = await makeServer(vestigiorum)
  try {
    const res = await get(`${url}/api/vestigia/${v.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.vestigium.promptum, 'a public gallery trace')
  } finally {
    await closeServer(server)
  }
})
