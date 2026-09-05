import { test } from 'node:test'
import assert from 'node:assert/strict'
import { envelopeMedia } from '../../../../src/allocutio/telegram/envelopeMedia.js'

test('no media → null', () => {
  assert.equal(envelopeMedia({}), null)
})

test('an absent message → null', () => {
  assert.equal(envelopeMedia(undefined), null)
})

test('photo resolves to the highest-resolution size', () => {
  const got = envelopeMedia({
    photo: [
      { file_id: 'small', width: 90, height: 90 },
      { file_id: 'large', width: 1280, height: 1280 },
    ],
  })
  assert.deepEqual(got, { fileId: 'large', type: 'image' })
})

test('an empty photo array is not media', () => {
  assert.equal(envelopeMedia({ photo: [] }), null)
})

test('video resolves as a video', () => {
  assert.deepEqual(envelopeMedia({ video: { file_id: 'v' } }), { fileId: 'v', type: 'video' })
})

test('an animation is a video', () => {
  assert.deepEqual(envelopeMedia({ animation: { file_id: 'a' } }), { fileId: 'a', type: 'video' })
})

test('audio resolves as audio', () => {
  assert.deepEqual(envelopeMedia({ audio: { file_id: 'm' } }), { fileId: 'm', type: 'audio' })
})

test('a voice note is audio', () => {
  assert.deepEqual(envelopeMedia({ voice: { file_id: 'o' } }), { fileId: 'o', type: 'audio' })
})

test('a document is classified by its MIME type', () => {
  assert.deepEqual(envelopeMedia({ document: { file_id: 'd', mime_type: 'image/png' } }), { fileId: 'd', type: 'image' })
  assert.deepEqual(envelopeMedia({ document: { file_id: 'd', mime_type: 'video/quicktime' } }), { fileId: 'd', type: 'video' })
  assert.deepEqual(envelopeMedia({ document: { file_id: 'd', mime_type: 'audio/flac' } }), { fileId: 'd', type: 'audio' })
})

test('a document that is not media is not media', () => {
  assert.equal(envelopeMedia({ document: { file_id: 'd', mime_type: 'application/pdf' } }), null)
  assert.equal(envelopeMedia({ document: { file_id: 'd' } }), null, 'no MIME type → nothing to classify by')
})

test('a photo alongside a document prefers the photo', () => {
  const got = envelopeMedia({
    photo: [{ file_id: 'p', width: 90, height: 90 }],
    document: { file_id: 'd', mime_type: 'image/png' },
  })
  assert.deepEqual(got, { fileId: 'p', type: 'image' })
})
