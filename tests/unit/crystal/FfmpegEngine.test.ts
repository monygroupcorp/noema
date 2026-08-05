import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Jimp } from 'jimp'
import { SpawnFfmpegEngine } from '../../../src/crystal/FfmpegEngine.js'

// Real ffmpeg integration — skipped where the binary is absent (e.g. CI without
// ffmpeg). The cursor's logic is covered hermetically in FfmpegCursor.test.ts.
const hasFfmpeg = (() => {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 }
  catch { return false }
})()

async function frame(color: number): Promise<Buffer> {
  return new Jimp({ width: 16, height: 16, color }).getBuffer('image/png')
}

test('frames-to-video (mp4) produces a non-empty mp4', { skip: !hasFfmpeg }, async () => {
  const engine = new SpawnFfmpegEngine()
  const frames = [await frame(0xff0000ff), await frame(0x00ff00ff), await frame(0x0000ffff)]
  const out = await engine.run({ op: 'frames-to-video', frames, fps: 4, format: 'mp4' })

  assert.equal(out.ext, 'mp4')
  assert.equal(out.contentType, 'video/mp4')
  assert.ok(out.bytes.length > 0, 'produced bytes')
  // mp4 files carry an 'ftyp' box near the start.
  assert.ok(out.bytes.subarray(0, 32).includes(Buffer.from('ftyp')), 'looks like an mp4 (ftyp box)')
})

test('frames-to-video rejects an empty frame list', { skip: !hasFfmpeg }, async () => {
  const engine = new SpawnFfmpegEngine()
  await assert.rejects(() => engine.run({ op: 'frames-to-video', frames: [], fps: 4, format: 'mp4' }), /at least one frame/i)
})
