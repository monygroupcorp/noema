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

test('a round video note is a video', () => {
  assert.deepEqual(envelopeMedia({ video_note: { file_id: 'n' } }), { fileId: 'n', type: 'video' })
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

test('a document with no MIME type falls back to its filename', () => {
  assert.deepEqual(envelopeMedia({ document: { file_id: 'd', file_name: 'shot.PNG' } }), { fileId: 'd', type: 'image' })
  assert.deepEqual(envelopeMedia({ document: { file_id: 'd', file_name: 'clip.mov' } }), { fileId: 'd', type: 'video' })
  assert.deepEqual(envelopeMedia({ document: { file_id: 'd', file_name: 'take.m4a' } }), { fileId: 'd', type: 'audio' })
})

test('a generic MIME type still classifies by filename', () => {
  const got = envelopeMedia({ document: { file_id: 'd', mime_type: 'application/octet-stream', file_name: 'clip.mp4' } })
  assert.deepEqual(got, { fileId: 'd', type: 'video' })
})

test('a filename that names no media is not media', () => {
  assert.equal(envelopeMedia({ document: { file_id: 'd', file_name: 'archive.zip' } }), null)
  assert.equal(envelopeMedia({ document: { file_id: 'd', file_name: 'README' } }), null, 'no extension to read')
})

test('a photo alongside a document prefers the photo', () => {
  const got = envelopeMedia({
    photo: [{ file_id: 'p', width: 90, height: 90 }],
    document: { file_id: 'd', mime_type: 'image/png' },
  })
  assert.deepEqual(got, { fileId: 'p', type: 'image' })
})
