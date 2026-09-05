import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { createCeremoniaRouter } from '../../../src/api/arcanum/ceremoniaRouter.js'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import type { ZkeyCustody } from '../../../src/arcanum/CeremoniaCustody.js'
import { mintSession } from '../../../src/crystal/sessionToken.js'
import { fakeZkey, type FakeLink } from '../../unit/arcanum/fakeZkey.js'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

class MemoryCustody implements ZkeyCustody {
  private m = new Map<string, Buffer>()
  async get(h: string) { return this.m.get(h) ?? null }
  async put(h: string, b: Buffer) { this.m.set(h, b) }
}

// No ptau → verifyContinuation skips the snarkjs deep check, so these run without a
// 1.2GB artifact. The chain check still runs: it needs only the two keys' own bytes,
// which is what lets the fork tests below be hermetic.
function makeApp(store = new MemoryCeremoniaStore(), custody = new MemoryCustody()) {
  const app = express()
  app.use('/v1/ceremony', express.json(), createCeremoniaRouter(store, {
    custody,
    verifier: { r1csPath: '/nonexistent.r1cs', ptauPath: undefined },
  }))
  return { app, store, custody }
}

// The router now checks that an upload's contribution chain continues the head's, so
// test payloads have to be real zkey bytes. `ROOT` is the ceremony's initial key (no
// contributions yet) and `after(...)` is what an honest contributor would send back.
const ROOT: FakeLink[] = []
const after = (chain: FakeLink[], seed: string) => [...chain, { seed, name: seed }]

/** Open a ceremony with a seeded root zkey in custody; returns the root hash. */
async function open(store: MemoryCeremoniaStore, custody: MemoryCustody) {
  const root = fakeZkey(ROOT)
  const rootHash = sha(root)
  await custody.put(rootHash, root)
  await store.open(rootHash, 5)
  return rootHash
}

test('GET /v1/ceremony exposes the announced fallback + computed headHash', async () => {
  const { app } = makeApp()
  const res = await request(app).get('/v1/ceremony')
  assert.equal(res.status, 200)
  assert.equal(res.body.phase, 'announced')
  assert.equal(res.body.headHash, null)
})

test('GET /current.zkey is 409 until open, then streams the head with x-zkey-hash', async () => {
  const { app, store, custody } = makeApp()
  assert.equal((await request(app).get('/v1/ceremony/current.zkey')).status, 409)
  const rootHash = await open(store, custody)
  const res = await request(app).get('/v1/ceremony/current.zkey').buffer()
  assert.equal(res.status, 200)
  assert.equal(res.headers['x-zkey-hash'], rootHash)
})

test('a valid contribution appends to the live chain and advances the head', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)

  const contrib = fakeZkey(after(ROOT, 'contrib-1'))
  const res = await request(app)
    .post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash)
    .set('x-contributor-name', 'alice')
    .set('Content-Type', 'application/octet-stream')
    .send(contrib)

  assert.equal(res.status, 201)
  assert.equal(res.body.chain.length, 1)
  assert.equal(res.body.chain[0].name, 'alice')
  assert.equal(res.body.headHash, sha(contrib))
  // the new head is downloadable
  assert.deepEqual(await custody.get(sha(contrib)), contrib)
})

// The rollback attack: contribute against the ROOT, then claim to have built on the
// head. The header says the right thing, so only the bytes can give it away — and if the
// sequencer took it, every contribution collected so far would be dropped from the chain
// and the forker would own the only randomness in the key. No ptau is mounted here, so
// this is the chain check alone doing the work.
test('a key forked off an earlier point is refused even when x-based-on names the head', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const first = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream')
    .send(fakeZkey(after(ROOT, 'honest')))
  assert.equal(first.status, 201)

  const rollback = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', first.body.headHash).set('Content-Type', 'application/octet-stream')
    .send(fakeZkey(after(ROOT, 'forker')))
  assert.equal(rollback.status, 400)
  assert.match(rollback.body.error, /expected 2 contributions/)

  const status = await store.status()
  assert.equal(status.chain.length, 1)
  assert.equal(status.chain[0].name, 'anonymous')
})

test('a key of the right length but a different history is refused', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const first = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream')
    .send(fakeZkey(after(ROOT, 'honest')))

  const forked = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', first.body.headHash).set('Content-Type', 'application/octet-stream')
    .send(fakeZkey(after(after(ROOT, 'evil'), 'evil-2')))
  assert.equal(forked.status, 400)
  assert.match(forked.body.error, /different history/)
  assert.equal((await store.status()).chain.length, 1)
})

test('bytes that are not a zkey at all are refused 400, not appended', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream')
    .send(Buffer.from('CONTRIB-1'))
  assert.equal(res.status, 400)
  assert.match(res.body.error, /not a zkey file/)
  assert.equal((await store.status()).chain.length, 0)
})

test('a stale x-based-on is rejected 409 (must build on the current head)', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  // first contribution moves the head
  await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'c1')))
  // second still references the root → stale
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(after(ROOT, 'c1'), 'c2')))
  assert.equal(res.status, 409)
})

test('an identical (no-op) upload is rejected 400', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const root = await custody.get(rootHash)
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(root!)
  assert.equal(res.status, 400)
})

test('missing x-based-on is rejected 400', async () => {
  const { app, store, custody } = makeApp()
  await open(store, custody)
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'x')))
  assert.equal(res.status, 400)
})

test('contributions are refused before the ceremony is open', async () => {
  const { app } = makeApp()
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', 'a'.repeat(64)).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'x')))
  assert.equal(res.status, 409)
})

test('appendContribution optimistic lock: second writer on the same head loses', async () => {
  const store = new MemoryCeremoniaStore()
  const custody = new MemoryCustody()
  const rootHash = await open(store, custody)
  const ok1 = await store.appendContribution({ index: 1, name: 'a', outputHash: 'h1' }, rootHash, 'id-a')
  const ok2 = await store.appendContribution({ index: 2, name: 'b', outputHash: 'h2' }, rootHash, 'id-b') // stale head
  assert.equal(ok1, true)
  assert.equal(ok2, false)
})

test('appendContribution refuses a second contribution from the SAME identity key', async () => {
  const store = new MemoryCeremoniaStore()
  const custody = new MemoryCustody()
  const rootHash = await open(store, custody)
  const ok1 = await store.appendContribution({ index: 1, name: 'a', outputHash: 'h1' }, rootHash, 'same-id')
  assert.equal(ok1, true)
  assert.equal(await store.hasContributed('same-id'), true)
  // even building on the NEW (correct) head, the same identity is refused
  const ok2 = await store.appendContribution({ index: 2, name: 'a-again', outputHash: 'h2' }, 'h1', 'same-id')
  assert.equal(ok2, false)
})

// ── one ceremony contribution per session identity (noema-133) ─────────────────────

test('one-per-session: a first contribution succeeds; a second from the SAME cookie session is refused 409', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const agent = request.agent(app) // persists Set-Cookie across requests, like a browser

  const first = await agent.post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'c1')))
  assert.equal(first.status, 201)
  // @types/superagent types every header as a single string; Node's http layer still delivers
  // Set-Cookie as an array before superagent sees it, which is what actually lands here.
  const setCookie = first.headers['set-cookie'] as unknown as string[] | undefined
  assert.ok(setCookie?.some((c) => c.startsWith('noema-cer-sid=')))

  const head = first.body.headHash
  const second = await agent.post('/v1/ceremony/contributions')
    .set('x-based-on', head).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(after(ROOT, 'c1'), 'c2')))
  assert.equal(second.status, 409)
  assert.match(second.body.error, /already contributed/i)
  assert.equal(store.slotCount(), 0) // sanity: didn't touch slots
  assert.equal((await store.status()).chain.length, 1) // refused contribution never landed
})

test('one-per-session: a DIFFERENT identity (no shared cookie) contributes fine', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)

  const alice = request.agent(app)
  const res1 = await alice.post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'c1')))
  assert.equal(res1.status, 201)

  const bob = request.agent(app) // fresh agent → no cookie jar overlap with alice
  const res2 = await bob.post('/v1/ceremony/contributions')
    .set('x-based-on', res1.body.headHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(after(ROOT, 'c1'), 'c2')))
  assert.equal(res2.status, 201)
  assert.equal((await store.status()).chain.length, 2)
})

test('one-per-session: a signed-in caller (session JWT) is keyed on animaId, dedup regardless of cookies', async () => {
  process.env.JWT_SECRET = 'test-secret-noema-133'
  try {
    const { app, store, custody } = makeApp()
    const rootHash = await open(store, custody)
    const { token } = mintSession('anima-1', process.env.JWT_SECRET)

    const res1 = await request(app).post('/v1/ceremony/contributions')
      .set('Authorization', `Bearer ${token}`)
      .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'c1')))
    assert.equal(res1.status, 201)

    // a brand-new agent (no cookies at all) but the SAME bearer token → still refused
    const res2 = await request(app).post('/v1/ceremony/contributions')
      .set('Authorization', `Bearer ${token}`)
      .set('x-based-on', res1.body.headHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(after(ROOT, 'c1'), 'c2')))
    assert.equal(res2.status, 409)
    assert.match(res2.body.error, /already contributed/i)
  } finally {
    delete process.env.JWT_SECRET
  }
})

test('one-per-session gate does not affect read endpoints', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const agent = request.agent(app)
  await agent.post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(fakeZkey(after(ROOT, 'c1')))

  const status = await agent.get('/v1/ceremony')
  assert.equal(status.status, 200)
  const zkey = await agent.get('/v1/ceremony/current.zkey').buffer()
  assert.equal(zkey.status, 200)
  // the public status never leaks the internal contributedKeys bookkeeping
  assert.equal('contributedKeys' in status.body, false)
})

test('POST /slots still records contributor interest, deduped by contact', async () => {
  const { app, store } = makeApp()
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: 'alice@x' })).status, 201)
  await request(app).post('/v1/ceremony/slots').send({ contact: 'alice@x' })
  await request(app).post('/v1/ceremony/slots').send({ contact: 'bob@y' })
  assert.equal(store.slotCount(), 2)
})

test('POST /slots rejects blank or over-long contact', async () => {
  const { app } = makeApp()
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: '  ' })).status, 400)
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: 'x'.repeat(300) })).status, 400)
})
