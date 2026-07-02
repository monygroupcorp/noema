import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoEditionum } from '../../../src/crystal/MongoEditionum.js'
import type { Editio } from '../../../src/types/editio.js'

// Real-Mongo coverage for the public feed's author scoping (ADR-0011 §7). The load-
// bearing property: `?author=` narrows the feed to one creator/agent but keeps the
// public clamp (status:'published' + public visibility) — it can NEVER surface that
// author's pending/private/unlisted editions. Only real Mongo proves the query.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'editiones_feedauthor_unit'

let client: MongoClient
let col: Collection
let store: MongoEditionum

function ed(over: Partial<Editio>): Editio {
  const now = new Date()
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    artifactRef: { kind: 'actum', id: 'a1' },
    destination: 'feed',
    visibility: 'feed',
    custody: 'ours',
    by: { animaId: 'anima-1' },
    status: 'published',
    natum: now,
    mutatum: now,
    ...over,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  store = new MongoEditionum(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('author scope returns only that author\'s published+public editions', async () => {
  await col.insertMany([
    ed({ id: 'A', by: { animaId: 'anima-1' }, status: 'published', visibility: 'feed' }),      // ✓
    ed({ id: 'B', by: { animaId: 'anima-1' }, status: 'pending', visibility: 'feed' }),         // clamp: not published
    ed({ id: 'C', by: { animaId: 'anima-1' }, status: 'published', visibility: 'private' }),    // clamp: not public
    ed({ id: 'D', by: { animaId: 'anima-2' }, status: 'published', visibility: 'feed' }),       // other author
  ])
  const mine = await store.listFeed({ author: { animaId: 'anima-1' }, visibility: 'feed' })
  assert.deepEqual(mine.map((e) => e.id), ['A'])
})

test('no author → the whole public feed (both authors, published+feed only)', async () => {
  await col.insertMany([
    ed({ id: 'A', by: { animaId: 'anima-1' }, status: 'published', visibility: 'feed' }),
    ed({ id: 'B', by: { animaId: 'anima-1' }, status: 'pending', visibility: 'feed' }),
    ed({ id: 'D', by: { animaId: 'anima-2' }, status: 'published', visibility: 'feed' }),
  ])
  const all = await store.listFeed({ visibility: 'feed' })
  assert.deepEqual(new Set(all.map((e) => e.id)), new Set(['A', 'D']))
})

test('authorAnimaIds ($in) is the collection-gallery scope, same public clamp', async () => {
  await col.insertMany([
    ed({ id: 'A', by: { animaId: 'agent-1' }, status: 'published', visibility: 'feed' }),   // ✓ in set
    ed({ id: 'B', by: { animaId: 'agent-2' }, status: 'published', visibility: 'feed' }),   // ✓ in set
    ed({ id: 'C', by: { animaId: 'agent-2' }, status: 'published', visibility: 'private' }),// clamp: not public
    ed({ id: 'D', by: { animaId: 'agent-3' }, status: 'published', visibility: 'feed' }),   // not in set
  ])
  const gallery = await store.listFeed({ authorAnimaIds: ['agent-1', 'agent-2'], visibility: 'feed' })
  assert.deepEqual(new Set(gallery.map((e) => e.id)), new Set(['A', 'B']))
})

test('a commitment (anon) author scopes the same way', async () => {
  await col.insertMany([
    ed({ id: 'X', by: { commitment: 'cmt-1' }, status: 'published', visibility: 'feed' }),
    ed({ id: 'Y', by: { animaId: 'anima-1' }, status: 'published', visibility: 'feed' }),
  ])
  const anon = await store.listFeed({ author: { commitment: 'cmt-1' }, visibility: 'feed' })
  assert.deepEqual(anon.map((e) => e.id), ['X'])
})
