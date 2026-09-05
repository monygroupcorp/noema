import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoMateria } from '../../../src/crystal/MongoMateria.js'
import type { Materia } from '../../../src/types/materia.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'materiae_unit'

let client: MongoClient
let col: Collection
let store: MongoMateria

function makeInput(overrides: Partial<Omit<Materia, 'id'>> = {}): Omit<Materia, 'id'> {
  return {
    genus: 'runpod',
    externusId: `ext-${Math.random().toString(36).slice(2)}`,
    gpu: 'RTX4090',
    vramGb: 24,
    ramGb: 64,
    impetusPerSecond: 1n,
    status: 'idle',
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoMateria(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns materia with the given fields intact', async () => {
  const input = makeInput({ gpu: 'A100-80GB', vramGb: 80, ramGb: 128 })
  const m = await store.create(input)
  assert.ok(m.id)
  assert.equal(m.genus, 'runpod')
  assert.equal(m.gpu, 'A100-80GB')
  assert.equal(m.vramGb, 80)
  assert.equal(m.ramGb, 128)
  assert.equal(m.status, 'idle')
})

test('create round-trips impetusPerSecond as bigint', async () => {
  const input = makeInput({ impetusPerSecond: 337n })
  const m = await store.create(input)
  const found = await store.findById(m.id)
  assert.ok(found)
  assert.equal(typeof found.impetusPerSecond, 'bigint')
  assert.equal(found.impetusPerSecond, 337n)
})

test('create round-trips zero impetusPerSecond', async () => {
  const input = makeInput({ impetusPerSecond: 0n })
  const m = await store.create(input)
  const found = await store.findById(m.id)
  assert.ok(found)
  assert.equal(found.impetusPerSecond, 0n)
  assert.equal(typeof found.impetusPerSecond, 'bigint')
})

// ── findById ──────────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const result = await store.findById('no-such-id')
  assert.equal(result, null)
})

test('findById returns stored materia', async () => {
  const input = makeInput({ externusId: 'pod-abc123' })
  const created = await store.create(input)
  const found = await store.findById(created.id)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.externusId, 'pod-abc123')
})

// ── update ────────────────────────────────────────────────────────────────────

test('update patches status', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { status: 'active' })
  assert.equal(updated.status, 'active')
})

test('update patches sshHost and sshPort', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { sshHost: '192.168.1.100', sshPort: 22222 })
  assert.equal(updated.sshHost, '192.168.1.100')
  assert.equal(updated.sshPort, 22222)
})

test('update patches imageRef', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { imageRef: 'stationthis/flux-comfyui:v2' })
  assert.equal(updated.imageRef, 'stationthis/flux-comfyui:v2')
})

test('update throws for unknown id', async () => {
  await assert.rejects(
    () => store.update('ghost-id', { status: 'terminated' }),
    /not found/i
  )
})

test('update patches podPolicy', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { podPolicy: 'economy' })
  assert.equal(updated.podPolicy, 'economy')
})

test('update patches shareToken', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { podPolicy: 'link', shareToken: 'tok-abc123' })
  assert.equal(updated.podPolicy, 'link')
  assert.equal(updated.shareToken, 'tok-abc123')
})

// ── findWarm ──────────────────────────────────────────────────────────────────

test('findWarm atomically claims the idle materia (idle → active) and returns it', async () => {
  const input = makeInput({ status: 'idle', imageRef: 'stationthis/flux-comfyui:v1' })
  const created = await store.create(input)
  const found = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v1' })
  assert.ok(found)
  assert.equal(found.id, created.id)
  // findWarm performs the claim as part of the find — the returned doc reflects
  // the post-transition state. This prevents two concurrent requests from both
  // winning the same warm pod.
  assert.equal(found.status, 'active')
})

test('findWarm returns null when no idle materia exists', async () => {
  const result = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v1' })
  assert.equal(result, null)
})

test('findWarm returns null when materia is active (not idle)', async () => {
  const input = makeInput({ status: 'active', imageRef: 'stationthis/flux-comfyui:v1' })
  await store.create(input)
  const result = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v1' })
  assert.equal(result, null)
})

test('findWarm returns null when imageRef does not match', async () => {
  const input = makeInput({ status: 'idle', imageRef: 'stationthis/flux-comfyui:v1' })
  await store.create(input)
  const result = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v2' })
  assert.equal(result, null)
})

test('findWarm with podPolicy filter returns only matching policy pods', async () => {
  await store.create(makeInput({ status: 'idle', imageRef: 'img:v1', podPolicy: 'private' }))
  const eco = await store.create(makeInput({ status: 'idle', imageRef: 'img:v1', podPolicy: 'economy' }))
  const found = await store.findWarm({ imageRef: 'img:v1', podPolicy: 'economy' })
  assert.ok(found)
  assert.equal(found.id, eco.id)
})

test('findWarm with podPolicy filter returns null when no economy pod exists', async () => {
  await store.create(makeInput({ status: 'idle', imageRef: 'img:v1', podPolicy: 'private' }))
  const result = await store.findWarm({ imageRef: 'img:v1', podPolicy: 'economy' })
  assert.equal(result, null)
})

test('findWarm with shareToken returns pod matching token', async () => {
  const m = await store.create(makeInput({ status: 'idle', imageRef: 'img:v1', podPolicy: 'link', shareToken: 'tok-xyz' }))
  const found = await store.findWarm({ shareToken: 'tok-xyz' })
  assert.ok(found)
  assert.equal(found.id, m.id)
})

test('findWarm does NOT claim an idle materia whose warmUntil has already elapsed', async () => {
  const past = new Date(Date.now() - 60_000)
  await store.create(makeInput({ status: 'idle', imageRef: 'img:v1', warmUntil: past }))
  const result = await store.findWarm({ imageRef: 'img:v1' })
  assert.equal(result, null)
})

test('findWarm with shareToken returns null for wrong token', async () => {
  await store.create(makeInput({ status: 'idle', podPolicy: 'link', shareToken: 'tok-xyz' }))
  const result = await store.findWarm({ shareToken: 'tok-wrong' })
  assert.equal(result, null)
})

// ── reapIdle ────────────────────────────────────────────────────────────────
test('reapIdle terminates an idle pod past its warmUntil deadline', async () => {
  const past = new Date(Date.now() - 60_000)
  const m = await store.create(makeInput({ status: 'idle', warmUntil: past }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 1)
  assert.equal(reaped[0].id, m.id)
  assert.equal((await store.findById(m.id))?.status, 'terminated')
})

test('reapIdle terminates a drainOnly idle pod even with warmUntil in the FUTURE (maxImpetus hard cap)', async () => {
  const future = new Date(Date.now() + 60 * 60_000)
  const m = await store.create(makeInput({ status: 'idle', warmUntil: future, drainOnly: true }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 1, 'a drained studio is reaped immediately, not at warmUntil')
  assert.equal(reaped[0].id, m.id)
  assert.equal((await store.findById(m.id))?.status, 'terminated')
})

test('reapIdle leaves an idle pod that is neither past warmUntil nor draining', async () => {
  const future = new Date(Date.now() + 60 * 60_000)
  const m = await store.create(makeInput({ status: 'idle', warmUntil: future }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 0)
  assert.equal((await store.findById(m.id))?.status, 'idle')
})

test('reapIdle leaves an active draining pod inside its drain grace (the gen gets to finish)', async () => {
  const past = new Date(Date.now() - 60_000)
  const future = new Date(Date.now() + 15 * 60_000)
  const m = await store.create(makeInput({ status: 'active', warmUntil: past, drainOnly: true, drainUntil: future }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 0, 'an in-flight gen keeps the whole grace window')
  assert.equal((await store.findById(m.id))?.status, 'active')
})

test('reapIdle terminates a pod stranded in active past its drainUntil deadline', async () => {
  const past = new Date(Date.now() - 60_000)
  const m = await store.create(makeInput({ status: 'active', drainOnly: true, drainUntil: past }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 1, 'a drained pod that never made it back to idle still dies')
  assert.equal(reaped[0].id, m.id)
  assert.equal((await store.findById(m.id))?.status, 'terminated')
})

test('reapIdle leaves an active pod that is not draining, lapsed deadline or not', async () => {
  const past = new Date(Date.now() - 60_000)
  const m = await store.create(makeInput({ status: 'active', warmUntil: past, drainUntil: past }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 0, 'the deadline only bites on a pod that is actually draining')
  assert.equal((await store.findById(m.id))?.status, 'active')
})

test('reapIdle does not re-reap an already-terminated drained pod', async () => {
  const past = new Date(Date.now() - 60_000)
  await store.create(makeInput({ status: 'terminated', drainOnly: true, drainUntil: past }))
  const reaped = await store.reapIdle(new Date())
  assert.equal(reaped.length, 0, 'terminated is terminal — no second terminatum, no second pod destroy')
})

test('findWarm by materiaId atomically claims THAT specific idle pod (studio pinning)', async () => {
  const a = await store.create(makeInput({ status: 'idle', imageRef: 'img:v1' }))
  await store.create(makeInput({ status: 'idle', imageRef: 'img:v1' }))   // a second same-image pod
  const claimed = await store.findWarm({ materiaId: a.id })
  assert.ok(claimed)
  assert.equal(claimed.id, a.id, 'claimed the exact pod, not the other same-image one')
  assert.equal(claimed.status, 'active', 'idle → active atomic claim')
  // A second claim on the now-active pod finds nothing.
  assert.equal(await store.findWarm({ materiaId: a.id }), null)
})
