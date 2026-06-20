import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FfmpegCursor } from '../../../src/crystal/FfmpegCursor.js'
import type { FfmpegEngine, FfmpegOp } from '../../../src/crystal/FfmpegEngine.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { Uploader } from '../../../src/crystal/R2Uploader.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'

function makeCursor() {
  const fetched: string[] = []
  const fetcher: MediaFetcher = {
    async fetch(url) { fetched.push(url); return Buffer.from(`bytes:${url}`) },
  }
  const ops: FfmpegOp[] = []
  const engine: FfmpegEngine = {
    async run(op) { ops.push(op); return { bytes: Buffer.from('VIDEO'), contentType: 'video/mp4', ext: 'mp4' } },
  }
  const uploads: { key: string; contentType: string }[] = []
  const uploader: Uploader = {
    async put(key, _bytes, contentType) { uploads.push({ key, contentType }); return `https://cdn/${key}` },
  }
  const cursor = new FfmpegCursor({ engine, fetcher, uploader })
  return { cursor, fetched, ops, uploads }
}

function actumWith(aditus: Record<string, unknown>): Actum {
  return { id: 'act-9', aditus } as unknown as Actum
}

test('reserve returns the modus fixed cost (0n by default)', async () => {
  const { cursor } = makeCursor()
  assert.equal(await cursor.reserve({} as Modus, {}), 0n)
})

test('assembles frames in order, defaults fps 12 / mp4, uploads, returns video URL', async () => {
  const { cursor, fetched, ops, uploads } = makeCursor()
  const res = await cursor.run(actumWith({ frames: ['f/0.png', 'f/1.png', 'f/2.png'] }))

  assert.deepEqual(fetched, ['f/0.png', 'f/1.png', 'f/2.png'], 'frames fetched in playback order')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].op, 'frames-to-video')
  assert.equal((ops[0] as { fps: number }).fps, 12)
  assert.equal((ops[0] as { format: string }).format, 'mp4')
  assert.equal((ops[0] as { frames: Buffer[] }).frames.length, 3)
  assert.deepEqual(uploads, [{ key: 'videos/act-9.mp4', contentType: 'video/mp4' }])
  assert.deepEqual(res, { kind: 'sync', exitus: { exitus: { video: 'https://cdn/videos/act-9.mp4' }, impetus: 0n } })
})

test('honours explicit fps and webm format', async () => {
  const { cursor, ops } = makeCursor()
  await cursor.run(actumWith({ frames: ['a'], fps: 24, format: 'webm' }))
  assert.equal((ops[0] as { fps: number }).fps, 24)
  assert.equal((ops[0] as { format: string }).format, 'webm')
})

test('a single frame string is accepted', async () => {
  const { cursor, fetched } = makeCursor()
  await cursor.run(actumWith({ frames: 'only.png' }))
  assert.deepEqual(fetched, ['only.png'])
})

test('rejects missing frames and unsupported formats', async () => {
  const { cursor } = makeCursor()
  await assert.rejects(() => cursor.run(actumWith({})), /`frames` is required/)
  await assert.rejects(() => cursor.run(actumWith({ frames: ['a'], format: 'avi' })), /unsupported format/)
})
