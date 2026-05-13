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
