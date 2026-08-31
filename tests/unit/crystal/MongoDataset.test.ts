import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoDataset } from '../../../src/crystal/MongoDataset.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'datasets_unit'

let client: MongoClient, col: Collection, store: MongoDataset

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoDataset(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  owner: 'anima-abc',
  name: 'frost-knight set',
  modality: 'image' as const,
  custody: 'sealed' as const,
  media: [{ id: 'm1', url: 'https://r2.example/m1.png', source: 'upload' as const, addedAt: new Date() }],
  captionsets: [{ id: 'c1', name: 'natural language', method: 'Florence-2', coverage: '1/1' }],
  versions: [{ v: '1.0.0', count: 1, when: new Date() }],
}

test('create returns a dataset with id, natum, mutatum', async () => {
  const d = await store.create(base)
  assert.ok(d.id)
  assert.ok(d.natum instanceof Date)
  assert.ok(d.mutatum instanceof Date)
  assert.equal(d.name, base.name)
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('findOwned returns the dataset to its owner', async () => {
  const d = await store.create(base)
  assert.equal((await store.findOwned(d.id, base.owner))?.id, d.id)
})

test('findOwned returns null to anyone else — the predicate is in the query', async () => {
  const d = await store.create(base)
  assert.equal(await store.findOwned(d.id, 'anima-other'), null)
  assert.equal(await store.findOwned('nope', base.owner), null, 'and null for an id that names nothing')
})

test('findOwned admits a dataset shared with one of the caller\'s teams (noema-384)', async () => {
  const d = await store.create({ ...base, sodalitasId: 'team-1' })
  assert.equal((await store.findOwned(d.id, 'anima-other', ['team-1']))?.id, d.id)
  assert.equal((await store.findOwned(d.id, 'anima-other', ['team-9', 'team-1']))?.id, d.id)
})

test('findOwned: the team arm is the CALLER\'s teams, and absent it the read is owner-only', async () => {
  const shared = await store.create({ ...base, sodalitasId: 'team-1' })
  const unshared = await store.create({ ...base, name: 'unshared' })
  assert.equal(await store.findOwned(shared.id, 'anima-other', ['team-9']), null, 'a team the caller is not in')
  assert.equal(await store.findOwned(shared.id, 'anima-other', []), null, 'no teams at all')
  assert.equal(await store.findOwned(shared.id, 'anima-other'), null, 'the argument omitted entirely')
  assert.equal(await store.findOwned(unshared.id, 'anima-other', ['team-1']), null, 'a dataset shared with nobody')
  assert.equal((await store.findOwned(unshared.id, base.owner, ['team-1']))?.id, unshared.id, 'the owner still reads their own')
})

test('findOwned admits a dataset whose access kind is public, in either shape', async () => {
  const flat = await store.create(base)
  const union = await store.create({ ...base, name: 'union' })
  await col.updateOne({ id: flat.id }, { $set: { access: 'public' } })
  await col.updateOne({ id: union.id }, { $set: { access: { kind: 'public' } } })
  assert.equal((await store.findOwned(flat.id, 'anima-other'))?.id, flat.id)
  assert.equal((await store.findOwned(union.id, 'anima-other'))?.id, union.id)
})

test('find returns the dataset', async () => {
  const d = await store.create(base)
  const found = await store.find(d.id)
  assert.equal(found?.id, d.id)
  assert.equal(found?.media.length, 1)
  assert.equal(found?.captionsets.length, 1)
})

test('list is owner-scoped — a caller never sees another owner\'s datasets', async () => {
  await store.create(base)
  await store.create({ ...base, owner: 'anima-stranger', name: 'not mine' })
  const page = await store.list({ owner: base.owner })
  assert.equal(page.entries.length, 1)
  assert.equal(page.entries[0].owner, base.owner)
})

test('listSummaries projects the same owner-scoped rows down to the thin shape', async () => {
  const d = await store.create(base)
  await store.create({ ...base, owner: 'anima-stranger', name: 'not mine' })
  const page = await store.listSummaries({ owner: base.owner })
  assert.equal(page.entries.length, 1)
  assert.deepEqual(Object.keys(page.entries[0]).sort(), ['id', 'images', 'name', 'updatedAt'].sort())
  assert.equal(page.entries[0].id, d.id)
  assert.equal(page.entries[0].images, 1)
})

test('list paginates with cursor, newest first', async () => {
  const a = await store.create(base)
  await new Promise((r) => setTimeout(r, 5))
  const b = await store.create({ ...base, name: 'second' })
  const page1 = await store.list({ owner: base.owner, limit: 1 })
  assert.equal(page1.entries.length, 1)
  assert.equal(page1.entries[0].id, b.id)
  assert.ok(page1.nextCursor)
  const page2 = await store.list({ owner: base.owner, limit: 1, cursor: page1.nextCursor })
  assert.equal(page2.entries.length, 1)
  assert.equal(page2.entries[0].id, a.id)
})

// ── Captionset write + edit seam ─────────────────────────────────────────────
//
// NOT hermetic: this file opens a MongoClient in `before`, so it is not in the
// `test:hermetic` glob and must not be added to it. The hermetic proof of this
// behaviour lives in tests/unit/allocutio/api/datasetsRoutes.test.ts.

const twoMedia = {
  ...base,
  media: [
    { id: 'm1', url: 'https://r2.example/m1.png', source: 'upload' as const, addedAt: new Date() },
    { id: 'm2', url: 'https://r2.example/m2.png', source: 'upload' as const, addedAt: new Date() },
  ],
  captionsets: [],
  // Overridden alongside `media`: `base` carries a single 1.0.0 entry counting ONE item, and a
  // fixture whose version history disagrees with its own media set makes every count assertion
  // below read against a lie.
  versions: [{ v: '1.0.0', count: 2, when: new Date() }],
}

test('addCaptionset attaches a captionset, derives coverage, and bumps mutatum', async () => {
  const d = await store.create(twoMedia)
  await new Promise((r) => setTimeout(r, 5))
  const updated = await store.addCaptionset(d.id, {
    id: 'c1', name: 'natural language', method: 'manual', coverage: '2/2', captions: { m1: 'one' },
  })
  assert.equal(updated?.captionsets.length, 1)
  assert.equal(updated?.captionsets[0].captions?.m1, 'one')
  // Coverage is derived from the captions present, not echoed from the argument.
  assert.equal(updated?.captionsets[0].coverage, '1/2')
  assert.ok(new Date(updated!.mutatum).getTime() > new Date(d.mutatum).getTime())

  const reread = await store.find(d.id)
  assert.equal(reread?.captionsets[0].captions?.m1, 'one')
})

test('addCaptionset replaces a captionset carrying the same id rather than duplicating it', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '', captions: { m1: 'one' } })
  const updated = await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '', captions: { m1: 'one', m2: 'two' } })
  assert.equal(updated?.captionsets.length, 1)
  assert.equal(updated?.captionsets[0].coverage, '2/2')
})

test('addCaptionset returns null for an unknown dataset', async () => {
  assert.equal(await store.addCaptionset('nope', { id: 'c1', name: 'nl', method: 'manual', coverage: '' }), null)
})

test('setCaption sets one key, recounts coverage, and bumps mutatum', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '' })
  await new Promise((r) => setTimeout(r, 5))

  const one = await store.setCaption(d.id, 'c1', 'm1', 'first')
  assert.equal(one?.captionsets[0].captions?.m1, 'first')
  assert.equal(one?.captionsets[0].coverage, '1/2')

  const two = await store.setCaption(d.id, 'c1', 'm2', 'second')
  assert.equal(two?.captionsets[0].coverage, '2/2')
  assert.ok(new Date(two!.mutatum).getTime() > new Date(d.mutatum).getTime())

  // Re-editing an existing key moves the text, not the count.
  const again = await store.setCaption(d.id, 'c1', 'm2', 'second, revised')
  assert.equal(again?.captionsets[0].coverage, '2/2')
  const reread = await store.find(d.id)
  assert.equal(reread?.captionsets[0].captions?.m2, 'second, revised')
})

test('setCaption leaves sibling captionsets untouched', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '' })
  await store.addCaptionset(d.id, { id: 'c2', name: 'tags', method: 'manual', coverage: '' })
  const updated = await store.setCaption(d.id, 'c1', 'm1', 'first')
  const c2 = updated?.captionsets.find((c) => c.id === 'c2')
  assert.equal(c2?.captions, undefined)
  assert.equal(c2?.coverage, '0/2')
})

test('setCaption returns null for an unknown dataset or an unknown captionset', async () => {
  const d = await store.create(twoMedia)
  assert.equal(await store.setCaption('nope', 'c1', 'm1', 'x'), null)
  assert.equal(await store.setCaption(d.id, 'no-such-set', 'm1', 'x'), null)
})

// ── Media append seam ────────────────────────────────────────────────────────
//
// The store-level half of `POST /v1/data/datasets/:id/media`. Also NOT hermetic (see the
// note above); the hermetic proof of the same behaviour lives in
// tests/unit/allocutio/api/datasetsRoutes.test.ts.

const appended = [
  { id: 'm3', url: 'https://r2.example/m3.png', source: 'upload' as const, addedAt: new Date() },
  { id: 'm4', url: 'https://r2.example/m4.png', source: 'upload' as const, addedAt: new Date() },
]

test('addMedia appends rather than replacing, and persists', async () => {
  const d = await store.create(twoMedia)
  const updated = await store.addMedia(d.id, appended)
  assert.deepEqual(updated?.media.map((m) => m.id), ['m1', 'm2', 'm3', 'm4'])

  const reread = await store.find(d.id)
  assert.deepEqual(reread?.media.map((m) => m.id), ['m1', 'm2', 'm3', 'm4'])
  assert.equal(reread?.media[0].url, 'https://r2.example/m1.png')
})

test('addMedia records a version at the media count after the append, and bumps mutatum', async () => {
  const d = await store.create(twoMedia)
  await new Promise((r) => setTimeout(r, 5))

  const first = await store.addMedia(d.id, appended)
  assert.deepEqual(first?.versions.map((v) => [v.v, v.count]), [['1.0.0', 2], ['1.1.0', 4]])
  assert.ok(new Date(first!.mutatum).getTime() > new Date(d.mutatum).getTime())

  const second = await store.addMedia(d.id, [
    { id: 'm5', url: 'https://r2.example/m5.png', source: 'upload' as const, addedAt: new Date() },
  ])
  assert.deepEqual(second?.versions.map((v) => [v.v, v.count]), [['1.0.0', 2], ['1.1.0', 4], ['1.2.0', 5]])

  const reread = await store.find(d.id)
  assert.equal(reread?.versions.length, 3)
})

test('addMedia recomputes every existing captionset\'s coverage against the new media count', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '', captions: { m1: 'one', m2: 'two' } })
  await store.addCaptionset(d.id, { id: 'c2', name: 'tags', method: 'manual', coverage: '', captions: { m1: 'tag' } })

  const updated = await store.addMedia(d.id, appended)
  const byId = Object.fromEntries((updated?.captionsets ?? []).map((c) => [c.id, c]))
  assert.equal(byId.c1.coverage, '2/4', 'a pass that read 2/2 no longer claims completeness')
  assert.equal(byId.c2.coverage, '1/4')
  // The captions themselves are untouched — only the denominator moved.
  assert.deepEqual(byId.c1.captions, { m1: 'one', m2: 'two' })

  const reread = await store.find(d.id)
  assert.equal(reread?.captionsets.find((c) => c.id === 'c1')?.coverage, '2/4')
})

test('addMedia leaves an already-decomposed media item\'s fragments on that item', async () => {
  const d = await store.create(twoMedia)
  await store.setFragments(d.id, 'm2', [{ category: 'subject', text: 'a lantern-keeper' }] as never)
  const updated = await store.addMedia(d.id, appended)
  const m2 = updated?.media.find((m) => m.id === 'm2')
  assert.equal(m2?.fragments?.length, 1)
  assert.equal(updated?.media.find((m) => m.id === 'm3')?.fragments, undefined)
})

test('addMedia returns null for an unknown dataset', async () => {
  assert.equal(await store.addMedia('nope', appended), null)
})

// ── Archive + restore (noema-266) ────────────────────────────────────────────
//
// The store half of the archive: the list filter, the find passthrough that keeps every
// reference resolving, the coverage recomputation that must ride along with a media archive,
// and the restore that makes the whole thing an archive rather than a delete. The hermetic
// proofs of the same behaviour, through the HTTP surface, live in
// tests/unit/allocutio/api/datasetsRoutes.test.ts.

const twoImages = {
  ...base,
  media: [
    { id: 'm1', url: 'https://r2.example/m1.png', source: 'upload' as const, addedAt: new Date() },
    { id: 'm2', url: 'https://r2.example/m2.png', source: 'upload' as const, addedAt: new Date() },
  ],
  captionsets: [{ id: 'c1', name: 'natural language', method: 'manual', coverage: '1/2', captions: { m1: 'a caption' } }],
}

test('an archived dataset is gone from list and listSummaries', async () => {
  const kept = await store.create(base)
  const gone = await store.create({ ...base, name: 'archived one' })

  const archived = await store.archiveDataset(gone.id)
  assert.ok(archived?.archivum instanceof Date, 'archive stamps a timestamp, not a boolean')

  assert.deepEqual((await store.list({ owner: base.owner })).entries.map((d) => d.id), [kept.id])
  assert.deepEqual((await store.listSummaries({ owner: base.owner })).entries.map((d) => d.id), [kept.id])
})

test('an archived dataset is still returned by find, so nothing that referenced it breaks', async () => {
  const d = await store.create(base)
  await store.archiveDataset(d.id)

  const found = await store.find(d.id)
  assert.equal(found?.id, d.id, 'archive is not erasure — find is what a reference resolves through')
  assert.equal(found?.media.length, 1)
  assert.ok(found?.archivum)
})

test('archiving media recomputes every captionset\'s coverage against the media that is left', async () => {
  const d = await store.create(twoImages)

  // Coverage is stored, not derived at read time, so the archive has to move it.
  const afterUncaptioned = await store.archiveMedia(d.id, 'm2')
  assert.equal(afterUncaptioned?.captionsets[0].coverage, '1/1')
  assert.equal((await store.find(d.id))?.captionsets[0].coverage, '1/1', 'and the recomputation is persisted')

  // Archiving the captioned item moves the numerator too — its caption stays on the record,
  // keyed by media id, but it is not coverage of the working set.
  const afterCaptioned = await store.archiveMedia(d.id, 'm1')
  assert.equal(afterCaptioned?.captionsets[0].coverage, '0/0')
  assert.equal(afterCaptioned?.captionsets[0].captions?.m1, 'a caption')

  // The thin projection counts the live media, not the rows.
  assert.equal((await store.listSummaries({ owner: base.owner })).entries[0].images, 0)
})

test('an archived media item stays on the record, stamped rather than removed', async () => {
  const d = await store.create(twoImages)
  await store.archiveMedia(d.id, 'm1')

  const found = await store.find(d.id)
  assert.equal(found?.media.length, 2, 'caption maps and fragments are keyed on the media id')
  assert.ok(found?.media.find((m) => m.id === 'm1')?.archivum)
  assert.equal(found?.media.find((m) => m.id === 'm2')?.archivum, undefined)
})

test('an archived dataset and an archived media item can both be restored', async () => {
  const d = await store.create(twoImages)
  await store.archiveMedia(d.id, 'm2')
  await store.archiveDataset(d.id)
  assert.equal((await store.list({ owner: base.owner })).entries.length, 0)

  const restored = await store.restoreDataset(d.id)
  assert.equal(restored?.archivum, undefined, 'restore removes the field rather than flipping a second flag')
  assert.deepEqual((await store.list({ owner: base.owner })).entries.map((x) => x.id), [d.id])
  assert.equal((await store.find(d.id))?.archivum, undefined, 'and the field is gone from the document')

  const back = await store.restoreMedia(d.id, 'm2')
  assert.equal(back?.media.find((m) => m.id === 'm2')?.archivum, undefined)
  assert.equal(back?.captionsets[0].coverage, '1/2', 'a restore recomputes coverage the same way an archive does')
  assert.equal((await store.listSummaries({ owner: base.owner })).entries[0].images, 2)
})

test('archive and restore are idempotent, and an unknown id or media id returns null', async () => {
  const d = await store.create(twoImages)
  const first = await store.archiveDataset(d.id)
  const second = await store.archiveDataset(d.id)
  assert.deepEqual(second?.archivum, first?.archivum, 'a repeated archive does not re-date the archive')

  await store.restoreDataset(d.id)
  assert.equal((await store.restoreDataset(d.id))?.archivum, undefined)

  assert.equal(await store.archiveDataset('nope'), null)
  assert.equal(await store.restoreDataset('nope'), null)
  assert.equal(await store.archiveMedia('nope', 'm1'), null)
  assert.equal(await store.archiveMedia(d.id, 'not-a-media-id'), null)
  assert.equal(await store.restoreMedia(d.id, 'not-a-media-id'), null)
})
