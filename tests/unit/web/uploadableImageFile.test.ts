import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isUploadableImageFile, partitionUploadable } from '../../../src/platforms/web/app/src/lib/fileIngest.js'

// storageRouter's /uploads/sign signs only image/png, image/jpeg and image/webp
// (ALLOWED_CONTENT_TYPES) — a GIF, an AVIF, or a HEIC straight off an iPhone IS an image
// (isImageFile lets it through) but is not one storage will ever accept, and used to reach the
// server and 400 there with nothing in the UI explaining why. isUploadableImageFile is the
// narrower check the picker applies before that round trip.

function fakeFile(name: string, type: string): File {
  return { name, type } as unknown as File
}

test('png, jpeg and webp are uploadable by MIME type', () => {
  assert.equal(isUploadableImageFile(fakeFile('a.png', 'image/png')), true)
  assert.equal(isUploadableImageFile(fakeFile('a.jpg', 'image/jpeg')), true)
  assert.equal(isUploadableImageFile(fakeFile('a.webp', 'image/webp')), true)
})

test('a gif, an avif and a heic are images, but not uploadable', () => {
  assert.equal(isUploadableImageFile(fakeFile('a.gif', 'image/gif')), false)
  assert.equal(isUploadableImageFile(fakeFile('a.avif', 'image/avif')), false)
  assert.equal(isUploadableImageFile(fakeFile('IMG_0001.heic', 'image/heic')), false)
})

test('a typeless file (a folder walk, or a file Chrome failed to sniff) falls back to its extension', () => {
  assert.equal(isUploadableImageFile(fakeFile('a.png', '')), true)
  assert.equal(isUploadableImageFile(fakeFile('a.heic', '')), false)
})

test('partitionUploadable splits a mixed batch and keeps both lists in input order', () => {
  const files = [fakeFile('a.png', 'image/png'), fakeFile('b.gif', 'image/gif'), fakeFile('c.webp', 'image/webp')]
  const { ok, rejected } = partitionUploadable(files)
  assert.deepEqual(ok.map((f) => f.name), ['a.png', 'c.webp'])
  assert.deepEqual(rejected.map((f) => f.name), ['b.gif'])
})
