// vestigiaRouter — auth scoping (GET / + GET /projection resolve the CALLER; a
// stranger sees nothing of another account's vestigia) + the projection endpoint's
// shape/caching. GET /search is unchanged and not re-tested here.
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
