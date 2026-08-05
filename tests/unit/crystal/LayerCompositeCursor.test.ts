import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LayerCompositeCursor } from '../../../src/crystal/LayerCompositeCursor.js'
import type { LayerCompositeEngine } from '../../../src/crystal/LayerCompositeEngine.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { Uploader } from '../../../src/crystal/R2Uploader.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeCursor() {
  const fetched: string[] = []
  const fetcher: MediaFetcher = {
    async fetch(url) { fetched.push(url); return Buffer.from(`bytes:${url}`) },
  }
  const engineCalls: { layers: Buffer[]; opts?: { width?: number; height?: number } }[] = []
  const engine: LayerCompositeEngine = {
    async composite(layers, opts) { engineCalls.push({ layers, opts }); return Buffer.from('PNG') },
  }
  const uploads: { key: string; bytes: Buffer; contentType: string }[] = []
  const uploader: Uploader = {
    async put(key, bytes, contentType) { uploads.push({ key, bytes, contentType }); return `https://cdn/${key}` },
  }
  const cursor = new LayerCompositeCursor({ engine, fetcher, uploader })
  return { cursor, fetched, engineCalls, uploads }
}

function actumWith(aditus: Record<string, unknown>): Actum {
  return { id: 'act-1', aditus } as unknown as Actum
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('reserve returns the modus fixed cost (0n by default)', async () => {
  const { cursor } = makeCursor()
  assert.equal(await cursor.reserve({} as Modus, {}), 0n)
  assert.equal(await cursor.reserve({ impetusFixum: 7n } as Modus, {}), 7n)
})

test('fetches layers in order, composites, uploads, returns the hosted image URL', async () => {
  const { cursor, fetched, engineCalls, uploads } = makeCursor()
  const res = await cursor.run(actumWith({ layers: ['u/bg.png', 'u/body.png', 'u/hat.png'] }))

  assert.deepEqual(fetched, ['u/bg.png', 'u/body.png', 'u/hat.png'], 'fetched bottom→top, in order')
  assert.equal(engineCalls.length, 1)
  assert.equal(engineCalls[0].layers.length, 3)
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].key, 'composites/act-1.png')
  assert.equal(uploads[0].contentType, 'image/png')
  assert.deepEqual(res, { kind: 'sync', exitus: { exitus: { image: 'https://cdn/composites/act-1.png' }, impetus: 0n } })
})

test('a single layer string is accepted', async () => {
  const { cursor, fetched } = makeCursor()
  await cursor.run(actumWith({ layers: 'u/only.png' }))
  assert.deepEqual(fetched, ['u/only.png'])
})

test('width/height pass through to the engine; junk is ignored', async () => {
  const { cursor, engineCalls } = makeCursor()
  await cursor.run(actumWith({ layers: ['a'], width: '512', height: 384 }))
  assert.deepEqual(engineCalls[0].opts, { width: 512, height: 384 })

  const second = makeCursor()
  await second.cursor.run(actumWith({ layers: ['a'], width: 'nope', height: -5 }))
  assert.deepEqual(second.engineCalls[0].opts, {}, 'non-positive / non-numeric dims dropped')
})

test('missing layers is an error', async () => {
  const { cursor } = makeCursor()
  await assert.rejects(() => cursor.run(actumWith({})), /`layers` is required/)
  await assert.rejects(() => cursor.run(actumWith({ layers: [] })), /`layers` is required/)
})
