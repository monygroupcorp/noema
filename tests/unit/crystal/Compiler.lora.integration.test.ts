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
import type { Intella } from '../../../src/types/intelligendi.js'

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

// REPRO of the prod failure: an intella whose `dest` basename differs from its `slug`. The
// weight downloads to `dest`; the prompt tag must name the SAME file or ComfyUI's loader can't
// find it. Built against the real shape of the mismatch (slug carries one name, `dest` a
// different one).
const MISMATCH_LORA: Intella = {
  id: 'intella.lora.mismatch-repro',
  nomen: 'Mismatch Repro',
  genus: 'lora',
  architectura: 'lora',
  parametri: 0,
  sources: [{ provenance: 'miladystation', uri: 'https://models.miladystation2.net/loras/mismatch-repro.safetensors', format: 'safetensors' }],
  dest: 'loras/impresstation-klein.safetensors',
  slug: 'lawb-flux2',
  sizeGb: 0.01,
  versio: '1.0.0',
  canonica: false,
  trigger: 'mismatchtrigger',
  familia: 'sd15',
  baseIntellaId: 'intella.sd15-v1-5',
  access: 'public',
  defaultWeight: 1.0,
  natum: new Date('2026-01-01T00:00:00Z'),
}

test('REPRO: LoRA whose dest basename differs from its slug — prompt tag and download dest agree (fails on main)', async () => {
  await seedCanonical()
  await intellarum.upsert(MISMATCH_LORA)
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum, FUNDS)
  const { spec, appliedLoras } = await compiler.compile(
    ESSENTIA_RUNMAKE_SD15,
    { prompt: 'a knight, mismatchtrigger style' },
    { animaId: 'anima-test' },
  )

  assert.equal(appliedLoras?.length, 1, 'the mismatched LoRA resolved from its trigger')
  const applied = appliedLoras![0]
  // The tag written into the prompt must be the dest basename, NOT the registry slug.
  assert.match(applied.replacedWord, /<lora:impresstation-klein:1>/)
  assert.ok(!applied.replacedWord.includes('lawb-flux2'))

  const model = spec.models.find(m => m.id === MISMATCH_LORA.id)
  assert.ok(model, 'the LoRA is present in the compiled model set')
  const tagBasename = applied.basename
  const destBasename = model!.dest.split('/').pop()!.replace(/\.safetensors$/, '')
  assert.equal(tagBasename, destBasename, 'the prompt tag and the download filename must be the same string')
})
