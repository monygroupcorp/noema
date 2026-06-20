import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Jimp } from 'jimp'
import { JimpLayerCompositeEngine } from '../../../src/crystal/LayerCompositeEngine.js'

const engine = new JimpLayerCompositeEngine()

async function png(width: number, height: number, color: number): Promise<Buffer> {
  return new Jimp({ width, height, color }).getBuffer('image/png')
}

test('composites layers bottom→top; the top layer wins on overlap', async () => {
  const red = await png(4, 4, 0xff0000ff)   // base
  const green = await png(2, 2, 0x00ff00ff) // overlay (top), drawn at origin

  const out = await engine.composite([red, green])
  const img = await Jimp.read(out)

  assert.equal(img.bitmap.width, 4)
  assert.equal(img.bitmap.height, 4)
  // (0,0) is covered by the green overlay → green wins (drawn last / on top).
  assert.equal(img.getPixelColor(0, 0), 0x00ff00ff)
  // (3,3) is outside the overlay → base red shows through.
  assert.equal(img.getPixelColor(3, 3), 0xff0000ff)
})

test('canvas defaults to the largest layer dimensions', async () => {
  const small = await png(2, 2, 0xff0000ff)
  const big = await png(6, 5, 0x0000ffff)
  const out = await engine.composite([small, big])
  const img = await Jimp.read(out)
  assert.equal(img.bitmap.width, 6)
  assert.equal(img.bitmap.height, 5)
})

test('explicit width/height override the canvas size', async () => {
  const a = await png(4, 4, 0xff0000ff)
  const out = await engine.composite([a], { width: 10, height: 8 })
  const img = await Jimp.read(out)
  assert.equal(img.bitmap.width, 10)
  assert.equal(img.bitmap.height, 8)
})

test('no layers is an error', async () => {
  await assert.rejects(() => engine.composite([]), /at least one layer/i)
})
