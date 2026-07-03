// weightProxyRouter (C1) — GET /internal/weights/:intellaId. Authn/authz + streaming.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createWeightProxyRouter } from '../../../src/api/internal/weightProxyRouter.js'
import { mintJobToken, verifyJobToken } from '../../../src/crystal/jobToken.js'
import type { Intella } from '../../../src/types/intelligendi.js'

const SECRET = 'job-token-secret'
const OWNER = 'anima:owner-1'
const ORIGIN = 'https://civitai.com/api/download/models/123'

const PRIVATE_LORA = {
  id: 'intella.private-lora', nomen: 'secret', genus: 'lora', architectura: 'lora', familia: 'sd15',
  parametri: 0, sources: [{ provenance: 'civitai', uri: ORIGIN }],
  dest: 'models/loras/secret.safetensors', sizeGb: 0.1, versio: '1.0.0', canonica: false,
  access: 'private', ownerKey: OWNER, natum: new Date(),
} as Intella

/** Build a server with the proxy mounted. `over` swaps in fake deps for a given test. */
function makeServer(over: Partial<Parameters<typeof createWeightProxyRouter>[0]> = {}, capture?: { headers?: Record<string, string>; url?: string }) {
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    if (capture) { capture.url = String(url); capture.headers = (init?.headers ?? {}) as Record<string, string> }
    return new Response('WEIGHTBYTES', { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '11' } })
  }) as unknown as typeof fetch

  const deps = {
    verifyToken: (t: string) => verifyJobToken(SECRET, t),
    intellae: { async find(id: string) { return id === PRIVATE_LORA.id ? PRIVATE_LORA : null } },
    secrets: { async resolve(_o: string, _p: 'civitai' | 'huggingface') { return 'BYO-CIVITAI-TOKEN' } },
    fetchFn,
    ...over,
  }
  const app = express()
  app.use('/internal', createWeightProxyRouter(deps as Parameters<typeof createWeightProxyRouter>[0]))
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

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

const validToken = () => mintJobToken(SECRET, { actumId: 'a1', ownerKey: OWNER, exp: Date.now() + 60_000 })

test('owner with a valid token streams the weights, and the BYO token rides the OUTBOUND request only', async () => {
  const capture: { headers?: Record<string, string>; url?: string } = {}
  const { server, url } = await makeServer({}, capture)
  try {
    const res = await get(`${url}/internal/weights/intella.private-lora`, { authorization: `Bearer ${validToken()}` })
    assert.equal(res.status, 200)
    assert.equal(res.body, 'WEIGHTBYTES')
    assert.equal(res.headers['content-length'], '11')
    // The origin was fetched with the BYO token — and it never appears in the RESPONSE to the pod.
    assert.equal(capture.url, ORIGIN)
    assert.equal((capture.headers as Record<string, string>).Authorization, 'Bearer BYO-CIVITAI-TOKEN')
    assert.ok(!JSON.stringify(res.headers).includes('BYO-CIVITAI-TOKEN'))
  } finally {
    await closeServer(server)
  }
})

test('no token → 404', async () => {
  const { server, url } = await makeServer()
  try {
    assert.equal((await get(`${url}/internal/weights/intella.private-lora`)).status, 404)
  } finally { await closeServer(server) }
})

test('bad token → 404', async () => {
  const { server, url } = await makeServer()
  try {
    assert.equal((await get(`${url}/internal/weights/intella.private-lora`, { authorization: 'Bearer garbage' })).status, 404)
  } finally { await closeServer(server) }
})

test('valid token but WRONG owner → 404 (not 403, no probing)', async () => {
  const { server, url } = await makeServer()
  try {
    const tok = mintJobToken(SECRET, { actumId: 'a1', ownerKey: 'anima:someone-else', exp: Date.now() + 60_000 })
    assert.equal((await get(`${url}/internal/weights/intella.private-lora`, { authorization: `Bearer ${tok}` })).status, 404)
  } finally { await closeServer(server) }
})

test('unknown intella → 404', async () => {
  const { server, url } = await makeServer()
  try {
    assert.equal((await get(`${url}/internal/weights/nope`, { authorization: `Bearer ${validToken()}` })).status, 404)
  } finally { await closeServer(server) }
})

test('a PUBLIC intella is not served through the proxy → 404', async () => {
  const pub = { ...PRIVATE_LORA, access: 'public' } as Intella
  const { server, url } = await makeServer({ intellae: { async find(id: string) { return id === pub.id ? pub : null } } })
  try {
    assert.equal((await get(`${url}/internal/weights/intella.private-lora`, { authorization: `Bearer ${validToken()}` })).status, 404)
  } finally { await closeServer(server) }
})

test('owner owns it but has NO stored secret → 404', async () => {
  const { server, url } = await makeServer({ secrets: { async resolve() { return null } } })
  try {
    assert.equal((await get(`${url}/internal/weights/intella.private-lora`, { authorization: `Bearer ${validToken()}` })).status, 404)
  } finally { await closeServer(server) }
})

test('legacy ownerAnimaId (no ownerKey) authorizes the matching anima owner', async () => {
  const legacy = { ...PRIVATE_LORA, ownerKey: undefined, ownerAnimaId: 'owner-1' } as unknown as Intella
  const { server, url } = await makeServer({ intellae: { async find(id: string) { return id === legacy.id ? legacy : null } } })
  try {
    const res = await get(`${url}/internal/weights/intella.private-lora`, { authorization: `Bearer ${validToken()}` })
    assert.equal(res.status, 200)
  } finally { await closeServer(server) }
})

test('origin non-ok → 502', async () => {
  const fetchFn = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
  const { server, url } = await makeServer({ fetchFn })
  try {
    assert.equal((await get(`${url}/internal/weights/intella.private-lora`, { authorization: `Bearer ${validToken()}` })).status, 502)
  } finally { await closeServer(server) }
})
