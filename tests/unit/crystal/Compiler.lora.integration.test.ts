// Compiler ↔ real MongoIntella ↔ real seeds — the LOCAL, GPU-less repro of the
// staging path: "/run sd1-5 <trigger>" must put the LoRA in the model set.
//
// This is the test that should have existed before we ever touched staging:
// the hermetic Compiler tests use a MOCK Intellarum, so they never exercise the
// real Mongo triggerMap (access filter, familia query). This wires the REAL
// Compiler + REAL MongoIntella + REAL canonical seeds against a local Mongo —
// no GPU, no money — and asserts the Armored Dress LoRA resolves into the
// compiled weight set from its trigger word. Runs under `npm run test:crystal`.
import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient, type Collection } from 'mongodb'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { MongoIntella } from '../../../src/crystal/MongoIntella.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import { ESSENTIA_RUNMAKE_SD15 } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'

// The substrate registry the flow's fundamentumId resolves against (image + base weights).
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'intellae_lora_integration'
const REAL_WORKFLOWS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../src/crystal/workflows')

let client: MongoClient
let col: Collection
let intellarum: MongoIntella

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  intellarum = new MongoIntella(col)
})
after(async () => { await client.close() })
afterEach(async () => { await col.deleteMany({}) })

/** Seed the canonical Intellae exactly as the bot does on boot (MongoIntella.upsert). */
async function seedCanonical(): Promise<void> {
  for (const intella of CANONICAL_INTELLAE) await intellarum.upsert(intella)
}

test('REPRO: /run sd1-5 with the Armored Dress trigger resolves the LoRA into spec.models', async () => {
  await seedCanonical()
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum, FUNDS)
  const { spec } = await compiler.compile(
    ESSENTIA_RUNMAKE_SD15,
    { prompt: 'a knight wearing armored_dress' },
    { animaId: 'anima-test' },
  )
  const ids = spec.models.map(m => m.id)
  assert.ok(ids.includes('intella.sd15-v1-5'), 'sd1-5 checkpoint present')
  assert.ok(
    ids.includes('intella.lora.armored-dress'),
    `Armored Dress LoRA must resolve from the trigger word — model set was: ${ids.join(', ')}`,
  )
})

test('REPRO: a prompt with NO trigger word resolves only the checkpoint (no false-positive LoRA)', async () => {
  await seedCanonical()
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum, FUNDS)
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a serene mountain lake' }, { animaId: 'anima-test' })
  const ids = spec.models.map(m => m.id)
  assert.ok(ids.includes('intella.sd15-v1-5'))
  assert.ok(!ids.includes('intella.lora.armored-dress'), 'no trigger → no LoRA')
})
