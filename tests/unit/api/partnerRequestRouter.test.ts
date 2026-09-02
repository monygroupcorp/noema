// partnerRequestRouter — POST /v1/partner-requests. Pure unit test (fake
// in-memory store, no live Mongo): opportunistic identity resolution
// (logged-out -> animaId undefined, logged-in -> animaId attached),
// validation, and the per-email counted-window rate limit (429).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createPartnerRequestRouter } from '../../../src/api/partner/partnerRequestRouter.js'
import { MemoryPartnerRequest } from '../../../src/crystal/MemoryPartnerRequest.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    if (creds.commitment) return { commitment: creds.commitment }
    throw new Error('auth.missing')
  },
}

function makeServer(partnerRequests: MemoryPartnerRequest) {
  const app = express()
  app.use(express.json())
  app.use('/v1/partner-requests', createPartnerRequestRouter({ partnerRequests, identity: fakeIdentity }))
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

function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request(
      { method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname, headers: { ...headers, 'content-type': 'application/json' } },
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
    req.write(payload)
    req.end()
  })
}

test('POST /v1/partner-requests: a logged-OUT submission succeeds with animaId undefined stored', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    const res = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'lead@example.com', useCase: 'embed the widget on our storefront' })
    assert.equal(res.status, 200)
    assert.ok(res.body.id)
    const stored = await store.find(res.body.id)
    assert.equal(stored?.animaId, undefined)
    assert.equal(stored?.contactEmail, 'lead@example.com')
    assert.equal(stored?.status, 'pending')
  } finally { await closeServer(server) }
})

test('POST /v1/partner-requests: a logged-IN submission attaches the caller animaId', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    const res = await post(`${url}/v1/partner-requests`, { authorization: 'Bearer anima-42' }, { contactEmail: 'founder@example.com', useCase: 'API access for our app' })
    assert.equal(res.status, 200)
    const stored = await store.find(res.body.id)
    assert.equal(stored?.animaId, 'anima-42')
  } finally { await closeServer(server) }
})

test('POST /v1/partner-requests: a resolved but non-animaId identity (anon commitment) also leaves animaId undefined', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    const res = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'anon@example.com', useCase: 'testing', commitment: 'commit-1' })
    assert.equal(res.status, 200)
    const stored = await store.find(res.body.id)
    assert.equal(stored?.animaId, undefined)
  } finally { await closeServer(server) }
})

test('POST /v1/partner-requests: rejects missing/malformed contactEmail', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    const missing = await post(`${url}/v1/partner-requests`, {}, { useCase: 'x' })
    assert.equal(missing.status, 400)
    const malformed = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'not-an-email', useCase: 'x' })
    assert.equal(malformed.status, 400)
  } finally { await closeServer(server) }
})

test('POST /v1/partner-requests: rejects missing useCase', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    const res = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'lead@example.com' })
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

test('POST /v1/partner-requests: captures optional nomen/org/notes', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    const res = await post(`${url}/v1/partner-requests`, {}, {
      contactEmail: 'lead@example.com', useCase: 'x', nomen: 'Jane', org: 'Acme', notes: 'urgent',
    })
    const stored = await store.find(res.body.id)
    assert.equal(stored?.nomen, 'Jane')
    assert.equal(stored?.org, 'Acme')
    assert.equal(stored?.notes, 'urgent')
  } finally { await closeServer(server) }
})

test('POST /v1/partner-requests: a 6th submission from the SAME email within the window is 429; a 6th from a DIFFERENT email is not', async () => {
  const store = new MemoryPartnerRequest()
  const { server, url } = await makeServer(store)
  try {
    for (let i = 0; i < 5; i++) {
      const res = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'repeat@example.com', useCase: `use case ${i}` })
      assert.equal(res.status, 200)
    }
    const sixth = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'repeat@example.com', useCase: 'one too many' })
    assert.equal(sixth.status, 429)

    // A different email is unaffected by the first email's rate limit.
    const other = await post(`${url}/v1/partner-requests`, {}, { contactEmail: 'someone-else@example.com', useCase: 'fresh bucket' })
    assert.equal(other.status, 200)

    // Case/whitespace variants of the SAME email still share the bucket (still 429).
    const variant = await post(`${url}/v1/partner-requests`, {}, { contactEmail: ' Repeat@Example.com ', useCase: 'case variant' })
    assert.equal(variant.status, 429)
  } finally { await closeServer(server) }
})
