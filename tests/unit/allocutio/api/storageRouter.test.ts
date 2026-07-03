import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createStorageRouter } from '../../../../src/allocutio/api/storageRouter.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { ObjectStore } from '../../../../src/crystal/R2Uploader.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'

// Identity stub: `x-api-key: me` → {animaId:'me'}; `x-commitment` → anon; else
// throws ApiError like the real IdentityResolver (no creds → 401).
const identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'me') return { animaId: 'me' }
    if (creds.commitment) return { commitment: creds.commitment }
    throw Errors.authMissing()
  },
}

// Mock store: records the presign calls, returns a deterministic signed/public URL.
function mockStore(): ObjectStore & { signed: Array<{ key: string; contentType: string }> } {
  const signed: Array<{ key: string; contentType: string }> = []
  return {
    signed,
    async put(key) { return `https://cdn.example/${key}` },
    async del() {},
    async getSignedUploadUrl(key, contentType) {
      signed.push({ key, contentType })
      return { signedUrl: `https://r2.example/${key}?sig=abc`, publicUrl: `https://cdn.example/${key}` }
    },
  }
}

function app(store: ObjectStore) {
  const server = express()
  server.use('/api/v1/storage', createStorageRouter({ store, identity }))
  return server
}

test('presign → 200 with { signedUrl, permanentUrl, key }; key is owner-scoped + image ext', async () => {
  const store = mockStore()
  const res = await request(app(store)).post('/api/v1/storage/uploads/sign')
    .set('x-api-key', 'me').send({ filename: 'my avatar.png', contentType: 'image/png' })
  assert.equal(res.status, 200)
  assert.match(res.body.signedUrl, /^https:\/\/r2\.example\//)
  assert.match(res.body.permanentUrl, /^https:\/\/cdn\.example\//)
  assert.match(res.body.key, /^uploads\/[0-9a-f]{16}\/[0-9a-f-]{36}\.png$/)
  // Untrusted client filename is NOT used in the path (no spaces/original name leak).
  assert.doesNotMatch(res.body.key, /avatar/)
  assert.equal(store.signed[0]?.contentType, 'image/png')
})

test('anon (x-commitment) callers get their own namespace too', async () => {
  const store = mockStore()
  const res = await request(app(store)).post('/api/v1/storage/uploads/sign')
    .set('x-commitment', 'cmt-1').send({ filename: 'x.webp', contentType: 'image/webp' })
  assert.equal(res.status, 200)
  assert.match(res.body.key, /\.webp$/)
})

test('two different owners get different key namespaces', async () => {
  const store = mockStore()
  await request(app(store)).post('/api/v1/storage/uploads/sign')
    .set('x-api-key', 'me').send({ filename: 'a.png', contentType: 'image/png' })
  await request(app(store)).post('/api/v1/storage/uploads/sign')
    .set('x-commitment', 'cmt-1').send({ filename: 'b.png', contentType: 'image/png' })
  const scope = (k: string) => k.split('/')[1]
  assert.notEqual(scope(store.signed[0]!.key), scope(store.signed[1]!.key))
})

test('missing creds → 401 (never presigns)', async () => {
  const store = mockStore()
  const res = await request(app(store)).post('/api/v1/storage/uploads/sign')
    .send({ filename: 'x.png', contentType: 'image/png' })
  assert.equal(res.status, 401)
  assert.equal(store.signed.length, 0)
})

test('non-image content-type is rejected (400), never presigns', async () => {
  const store = mockStore()
  const res = await request(app(store)).post('/api/v1/storage/uploads/sign')
    .set('x-api-key', 'me').send({ filename: 'x.pdf', contentType: 'application/pdf' })
  assert.equal(res.status, 400)
  assert.equal(store.signed.length, 0)
})

test('missing filename/contentType → 400', async () => {
  const store = mockStore()
  const res = await request(app(store)).post('/api/v1/storage/uploads/sign')
    .set('x-api-key', 'me').send({ contentType: 'image/png' })
  assert.equal(res.status, 400)
})

test('store without presign capability → 503, never throws', async () => {
  const noPresign: ObjectStore = { async put(k) { return k }, async del() {} }
  const res = await request(app(noPresign)).post('/api/v1/storage/uploads/sign')
    .set('x-api-key', 'me').send({ filename: 'x.png', contentType: 'image/png' })
  assert.equal(res.status, 503)
})
