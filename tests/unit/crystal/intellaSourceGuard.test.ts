// =============================================================================
// intellaSourceGuard.test.ts
//
// A canonica/public LoRA with an empty `sources[]` resolves by anyone's trigger
// word and then fails every run. These tests pin that the registry's write
// seams refuse to produce that state — driven through MongoIntella itself over
// an in-memory collection, so a seam that skips the guard fails here.
//
// Hermetic: no Mongo, no network.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import type { Collection } from 'mongodb'
import { MongoIntella } from '../../../src/crystal/MongoIntella.js'
import {
  EmptyLoraSourcesError,
  assertLoraSources,
  hasDownloadSource,
  isDownloadUri,
  requiresSources,
} from '../../../src/crystal/intellaSourceGuard.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import type { Intella } from '../../../src/types/intelligendi.js'

/** Just enough of a Collection for the seams under test, keyed on `id`. */
function memoryCollection(): { col: Collection; docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>()
  const col = {
    async findOne(q: { id: string }) { return docs.get(q.id) ?? null },
    async replaceOne(q: { id: string }, doc: Record<string, unknown>) { docs.set(q.id, { ...doc }); return {} },
    async findOneAndUpdate(q: { id: string }, u: { $set: Record<string, unknown> }) {
      const cur = docs.get(q.id)
      if (!cur) return null
      const next = { ...cur, ...u.$set }
      docs.set(q.id, next)
      return next
    },
  }
  return { col: col as unknown as Collection, docs }
}

function lora(overrides: Partial<Intella> = {}): Intella {
  return {
    id: 'lora.sample',
    nomen: 'sample',
    genus: 'lora',
    architectura: 'lora',
    parametri: 0,
    sources: [{ provenance: 'miladystation', uri: 'https://models.example.com/loras/sample.safetensors', format: 'safetensors' }],
    dest: 'models/loras/sample.safetensors',
    sizeGb: 0.3,
    versio: '1.0.0',
    canonica: true,
    familia: 'flux',
    natum: new Date('2025-01-01'),
    ...overrides,
  }
}

describe('requiresSources', () => {
  test('a canonica LoRA requires a source', () => {
    assert.equal(requiresSources({ genus: 'lora', canonica: true }), true)
  })
  test('a public LoRA requires a source, in the v1 and the v2 access shapes', () => {
    assert.equal(requiresSources({ genus: 'lora', canonica: false, access: 'public' }), true)
    assert.equal(requiresSources({ genus: 'lora', canonica: false, access: { kind: 'public' } }), true)
  })
  test('a private LoRA is the owner\'s own record and is not required to', () => {
    assert.equal(requiresSources({ genus: 'lora', canonica: false, access: 'private' }), false)
    assert.equal(requiresSources({ genus: 'lora', canonica: false, access: { kind: 'private' } }), false)
  })
  test('other genera are out of scope', () => {
    assert.equal(requiresSources({ genus: 'model', canonica: true }), false)
  })
})

describe('hasDownloadSource', () => {
  test('an empty, missing or blank-uri list is not a source', () => {
    assert.equal(hasDownloadSource([]), false)
    assert.equal(hasDownloadSource(undefined), false)
    assert.equal(hasDownloadSource(null), false)
    assert.equal(hasDownloadSource([{ provenance: 'civitai', uri: '  ' }]), false)
  })
  test('one entry with a uri is', () => {
    assert.equal(hasDownloadSource([{ provenance: 'civitai', uri: 'https://civitai.com/api/download/models/1' }]), true)
  })
})

describe('isDownloadUri', () => {
  test('accepts the shapes the platform downloads from', () => {
    assert.ok(isDownloadUri('https://models.miladystation2.net/loras/x.safetensors'))
    assert.ok(isDownloadUri('https://civitai.com/api/download/models/1001'))
    assert.ok(isDownloadUri('https://huggingface.co/noema-art/x/resolve/main/x.safetensors'))
  })
  test('rejects a bare host, a host root and a non-http scheme', () => {
    assert.equal(isDownloadUri('miladystation2.net'), false)
    assert.equal(isDownloadUri('https://miladystation2.net'), false)
    assert.equal(isDownloadUri('ftp://models.example.com/x.safetensors'), false)
  })
  test('rejects a Civitai model page and a HuggingFace repo page', () => {
    assert.equal(isDownloadUri('https://civitai.com/models/2002?modelVersionId=3003'), false)
    assert.equal(isDownloadUri('https://huggingface.co/noema-art/x'), false)
  })
})

describe('assertLoraSources', () => {
  test('throws EmptyLoraSourcesError naming the record', () => {
    assert.throws(
      () => assertLoraSources({ id: 'lora.x', genus: 'lora', canonica: true, sources: [] }),
      (err: unknown) => err instanceof EmptyLoraSourcesError && err.intellaId === 'lora.x',
    )
  })
})

describe('MongoIntella write seams', () => {
  test('upsert refuses a canonica LoRA with empty sources, and writes nothing', async () => {
    const { col, docs } = memoryCollection()
    await assert.rejects(new MongoIntella(col).upsert(lora({ sources: [] })), EmptyLoraSourcesError)
    assert.equal(docs.size, 0)
  })

  test('upsert refuses a canonica LoRA whose only source is a model page, not a download', async () => {
    const { col } = memoryCollection()
    await assert.rejects(
      new MongoIntella(col).upsert(lora({ sources: [{ provenance: 'civitai', uri: 'https://civitai.com/models/4004/sample-style' }] })),
      EmptyLoraSourcesError,
    )
  })

  test('upsert refuses a public non-canonica LoRA with empty sources', async () => {
    const { col } = memoryCollection()
    await assert.rejects(
      new MongoIntella(col).upsert(lora({ canonica: false, access: 'public', sources: [] })),
      EmptyLoraSourcesError,
    )
  })

  test('upsert still writes a private LoRA with empty sources, and a canonica LoRA with one', async () => {
    const { col, docs } = memoryCollection()
    const store = new MongoIntella(col)
    await store.upsert(lora({ id: 'lora.private', canonica: false, access: 'private', sources: [] }))
    await store.upsert(lora({ id: 'lora.ok' }))
    assert.deepEqual([...docs.keys()].sort(), ['lora.ok', 'lora.private'])
  })

  test('setAccess refuses to publish a sourceless LoRA, but may make it private', async () => {
    const { col, docs } = memoryCollection()
    docs.set('lora.bare', { ...lora({ id: 'lora.bare', canonica: false, access: 'private', sources: [] }) })
    const store = new MongoIntella(col)
    await assert.rejects(store.setAccess('lora.bare', 'public'), EmptyLoraSourcesError)
    assert.equal(docs.get('lora.bare')?.access, 'private')
    assert.ok(await store.setAccess('lora.bare', 'private'))
  })

  test('removeSource refuses to take the last source off a canonica LoRA', async () => {
    const { col, docs } = memoryCollection()
    const record = lora()
    docs.set(record.id, { ...record })
    await assert.rejects(new MongoIntella(col).removeSource(record.id, record.sources[0].uri), EmptyLoraSourcesError)
    assert.equal((docs.get(record.id)?.sources as unknown[]).length, 1)
  })

  test('removeSource still retracts a bucket copy from a private LoRA', async () => {
    const { col, docs } = memoryCollection()
    const record = lora({ canonica: false, access: 'private' })
    docs.set(record.id, { ...record })
    const after = await new MongoIntella(col).removeSource(record.id, record.sources[0].uri)
    assert.deepEqual(after?.sources, [])
  })
})

describe('canonical seeds', () => {
  // The server upserts every seed at boot, so a seed the guard refuses would stop startup.
  // Fail here instead.
  test('every seeded Intella passes the guard', () => {
    for (const i of CANONICAL_INTELLAE) assert.doesNotThrow(() => assertLoraSources(i), i.id)
  })
})
