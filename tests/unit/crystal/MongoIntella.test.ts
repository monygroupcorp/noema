import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoIntella } from '../../../src/crystal/MongoIntella.js'
import type { Intella } from '../../../src/types/intelligendi.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'intellae_unit'

let client: MongoClient
let col: Collection
let intellae: MongoIntella

function makeIntella(overrides: Partial<Intella> = {}): Intella {
  return {
    id: `intella.test-${Math.random().toString(36).slice(2)}`,
    nomen: 'Test Model',
    genus: 'model',
    architectura: 'unet',
    parametri: 1_000_000,
    sources: [{ provenance: 'miladystation', uri: 'https://models.example.com/test.safetensors', format: 'safetensors' }],
    dest: 'models/test.safetensors',
    sizeGb: 1,
    versio: '1.0.0',
    canonica: true,
    natum: new Date('2025-01-01'),
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  intellae = new MongoIntella(col)
})

after(async () => {
  await client.close()
})

afterEach(async () => {
  await col.deleteMany({})
})

// ── find() ────────────────────────────────────────────────────────────────────

test('find() returns null for nonexistent id', async () => {
  const result = await intellae.find('intella.does-not-exist')
  assert.equal(result, null)
})

test('find() returns record by id', async () => {
  const intella = makeIntella({ id: 'intella.flux-schnell' })
  await col.insertOne({ ...intella })
  const result = await intellae.find('intella.flux-schnell')
  assert.ok(result)
  assert.equal(result.id, 'intella.flux-schnell')
  assert.equal(result.nomen, intella.nomen)
})

test('find() strips MongoDB _id from result', async () => {
  const intella = makeIntella({ id: 'intella.strip-test' })
  await col.insertOne({ ...intella })
  const result = await intellae.find('intella.strip-test')
  assert.ok(result)
  assert.equal('_id' in result, false)
})

test('find() returns first source uri correctly', async () => {
  const intella = makeIntella({
    id: 'intella.uri-test',
    sources: [
      { provenance: 'miladystation', uri: 'https://models.miladystation2.net/unet/flux1-schnell.safetensors' },
      { provenance: 'huggingface', uri: 'https://huggingface.co/flux.safetensors' },
    ],
  })
  await col.insertOne({ ...intella })
  const result = await intellae.find('intella.uri-test')
  assert.equal(result?.sources[0].uri, 'https://models.miladystation2.net/unet/flux1-schnell.safetensors')
})

// ── list() ────────────────────────────────────────────────────────────────────

test('list() returns all records when no filter', async () => {
  await col.insertMany([makeIntella(), makeIntella(), makeIntella()])
  const result = await intellae.list()
  assert.equal(result.length, 3)
})

test('list(genus) filters by genus', async () => {
  await col.insertMany([
    makeIntella({ genus: 'model' }),
    makeIntella({ genus: 'embedding' }),
    makeIntella({ genus: 'model' }),
  ])
  const models = await intellae.list('model')
  assert.equal(models.length, 2)
  assert.ok(models.every(m => m.genus === 'model'))
})

// ── canonical() ───────────────────────────────────────────────────────────────

test('canonical() returns only canonica: true records', async () => {
  await col.insertMany([
    makeIntella({ canonica: true }),
    makeIntella({ canonica: false }),
    makeIntella({ canonica: true }),
  ])
  const result = await intellae.canonical()
  assert.equal(result.length, 2)
  assert.ok(result.every(m => m.canonica === true))
})

// ── upsert() ──────────────────────────────────────────────────────────────────

test('upsert() inserts a new Intella when id does not exist', async () => {
  const intella = makeIntella({ id: 'intella.upsert-new' })
  await intellae.upsert(intella)
  const result = await intellae.find('intella.upsert-new')
  assert.ok(result)
  assert.equal(result.nomen, intella.nomen)
})

test('upsert() updates an existing Intella when id already exists', async () => {
  const intella = makeIntella({ id: 'intella.upsert-existing', nomen: 'Original' })
  await col.insertOne({ ...intella })
  await intellae.upsert({ ...intella, nomen: 'Updated' })
  const result = await intellae.find('intella.upsert-existing')
  assert.equal(result?.nomen, 'Updated')
})

test('upsert() self-heals familia from tags when a record arrives without one', async () => {
  // A record with a family tag but no first-class familia → upsert infers + persists it, so
  // triggerMap (which keys on familia) finds it. This keeps the write seam whole going forward.
  const lora = makeIntella({
    id: 'intella.heal-tagged', genus: 'lora', canonica: false,
    tags: [{ tag: 'flux' }],
    trigger: 'healme',
  })
  delete (lora as { familia?: string }).familia
  await intellae.upsert(lora)
  const stored = await col.findOne({ id: 'intella.heal-tagged' })
  assert.equal(stored?.familia, 'flux', 'familia inferred from the flux tag and persisted')
})

test('upsert() leaves an explicit familia untouched and adds none when nothing is inferable', async () => {
  await intellae.upsert(makeIntella({ id: 'intella.heal-explicit', familia: 'sdxl', tags: [{ tag: 'flux' }] }))
  assert.equal((await col.findOne({ id: 'intella.heal-explicit' }))?.familia, 'sdxl', 'explicit familia wins over tags')

  const bare = makeIntella({ id: 'intella.heal-none', nomen: 'Generic Thing', dest: 'models/x.safetensors' })
  delete (bare as { familia?: string }).familia
  await intellae.upsert(bare)
  assert.equal('familia' in (await col.findOne({ id: 'intella.heal-none' }))!, false, 'no familia field when nothing inferable')
})

// ── v2 → v1 shim ────────────────────────────────────────────────────────────
//
// The chunk migration writes v2-shape records (`params.triggerWords[]`, nested
// `access.kind`, `params.baseIntellaId`). MongoIntella must surface them in
// v1 shape so downstream consumers don't have to care.

function makeV2LoraDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: `intella.v2-${Math.random().toString(36).slice(2)}`,
    nomen: 'v2 Test LoRA',
    genus: 'lora',
    architectura: 'flux',  // inherited from base in real v2; included here for v1 type compat
    familia: 'flux',       // compat key — what triggerMap/findByTrigger now query on
    parametri: 0,
    sources: [{ provenance: 'huggingface', uri: 'https://hf.co/x.safetensors' }],
    dest: 'models/loras/v2.safetensors',
    sizeGb: 0.2,
    versio: '1.0.0',
    canonica: false,
    natum: new Date('2026-01-01'),
    params: {
      triggerWords: ['miladyy', 'mld'],
      slug: 'milady-v3',
      defaultWeight: 0.8,
      baseIntellaId: 'intella.flux-schnell',
    },
    access: { kind: 'public' },
    ...overrides,
  }
}

test('shim: find() projects v2 doc to v1 shape', async () => {
  const v2 = makeV2LoraDoc({ id: 'intella.v2-find' })
  await col.insertOne(v2)
  const result = await intellae.find('intella.v2-find')
  assert.ok(result)
  // v1 flat fields present
  assert.equal(result.trigger, 'miladyy,mld')
  assert.equal(result.slug, 'milady-v3')
  assert.equal(result.defaultWeight, 0.8)
  assert.equal(result.baseIntellaId, 'intella.flux-schnell')
  assert.equal(result.access, 'public')
  // v2 nested block dropped from projection
  assert.equal('params' in result, false)
})

test('shim: v1 records pass through unchanged', async () => {
  // A pure v1-shape doc (flat trigger / access / baseIntellaId).
  const v1 = {
    ...makeIntella({ id: 'intella.v1-pass', genus: 'lora' }),
    trigger: 'milady',
    slug: 'milady-v1',
    defaultWeight: 1.0,
    baseIntellaId: 'intella.flux-schnell',
    access: 'public',
  }
  await col.insertOne({ ...v1 })
  const result = await intellae.find('intella.v1-pass')
  assert.ok(result)
  assert.equal(result.trigger, 'milady')
  assert.equal(result.slug, 'milady-v1')
  assert.equal(result.access, 'public')
})

test('shim: triggerMap() finds v2 records and keys by each triggerWord', async () => {
  await col.insertOne(makeV2LoraDoc({ id: 'intella.v2-tmap' }))
  const map = await intellae.triggerMap('flux')
  // Both array entries become map keys
  assert.ok(map.has('miladyy'), 'expected map to contain "miladyy" key')
  assert.ok(map.has('mld'), 'expected map to contain "mld" key')
  // Each key resolves to an Intella with v1-shape fields
  const entry = map.get('miladyy')![0]
  assert.equal(entry.slug, 'milady-v3')
  assert.equal(entry.defaultWeight, 0.8)
})

test('triggerMap() returns a CANONICAL LoRA that sets no access field (seed parity)', async () => {
  // Seeded LoRAs (canonica:true) carry no `access` field. Without the canonica access-clause
  // they're filtered out of trigger resolution → /run sd1-5 <trigger> never downloads the LoRA
  // (the live 2026-06-09 bug). canonica = platform-public.
  await col.insertOne({
    ...makeIntella({ id: 'intella.lora.armored', genus: 'lora', canonica: true }),
    familia: 'sd15',
    trigger: 'armored_dress,gauntlets',
    // intentionally NO access field
  })
  const map = await intellae.triggerMap('sd15')
  assert.ok(map.has('armored_dress'), 'canonical LoRA (no access) must resolve by its trigger')
  assert.equal(map.get('armored_dress')![0].id, 'intella.lora.armored')
})

test('shim: triggerMap() finds v2 PRIVATE record only for owner animaId', async () => {
  const priv = makeV2LoraDoc({
    id: 'intella.v2-priv',
    access: { kind: 'private', ownerAnimaId: 'anima-alice' },
    params: {
      triggerWords: ['privateword'],
      slug: 'priv-v1',
      defaultWeight: 1.0,
      baseIntellaId: 'intella.flux-schnell',
    },
  })
  await col.insertOne(priv)
  // Without animaId — should NOT find
  const mapAnon = await intellae.triggerMap('flux')
  assert.equal(mapAnon.has('privateword'), false)
  // With owner animaId — should find
  const mapAlice = await intellae.triggerMap('flux', 'anima-alice')
  assert.ok(mapAlice.has('privateword'))
  const entry = mapAlice.get('privateword')![0]
  assert.equal(entry.access, 'private')
  assert.equal(entry.ownerAnimaId, 'anima-alice')
})

test('shim: findByTrigger() matches against v2 triggerWords array', async () => {
  await col.insertOne(makeV2LoraDoc({ id: 'intella.v2-find-trigger' }))
  const results = await intellae.findByTrigger('miladyy', 'flux')
  assert.equal(results.length, 1)
  assert.equal(results[0].slug, 'milady-v3')
})
