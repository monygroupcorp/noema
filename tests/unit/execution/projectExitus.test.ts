import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectExitus, urlMediaType } from '../../../src/execution/projectExitus.js'
import type { Modus } from '../../../src/types/modus.js'

const modusWith = (exitus: Modus['exitus']): Pick<Modus, 'exitus'> => ({ exitus })

test('single image output lands under the declared image-typed exitus key', () => {
  const m = modusWith({ image: { type: 'image' } })
  const out = projectExitus(m, [{ url: 'https://r2/cat.png' }])
  assert.deepEqual(out, { image: 'https://r2/cat.png' })
})

test('the schema key wins even when the URL extension would guess otherwise', () => {
  // one media-typed Porta → its key is used regardless of extension (.bin)
  const m = modusWith({ image: { type: 'image' } })
  const out = projectExitus(m, [{ url: 'https://r2/blob.bin' }])
  assert.deepEqual(out, { image: 'https://r2/blob.bin' })
})

test('video output lands under a video-typed key; type picked by extension when several media Portae', () => {
  const m = modusWith({ image: { type: 'image' }, clip: { type: 'video' } })
  const out = projectExitus(m, [{ url: 'https://r2/out.mp4' }])
  assert.deepEqual(out, { clip: 'https://r2/out.mp4' })
})

test('3d output lands under the mesh-typed key', () => {
  const m = modusWith({ mesh: { type: '3d' } })
  const out = projectExitus(m, [{ url: 'https://r2/model.glb' }])
  assert.deepEqual(out, { mesh: 'https://r2/model.glb' })
})

test('extra media URLs land under <key>2, <key>3 (legacy multi-image behavior)', () => {
  const m = modusWith({ image: { type: 'image' } })
  const out = projectExitus(m, [{ url: 'https://r2/a.png' }, { url: 'https://r2/b.png' }, { url: 'https://r2/c.png' }])
  assert.deepEqual(out, { image: 'https://r2/a.png', image2: 'https://r2/b.png', image3: 'https://r2/c.png' })
})

test('no schema → falls back to the bare media-type name', () => {
  const out = projectExitus(null, [{ url: 'https://r2/cat.png' }])
  assert.deepEqual(out, { image: 'https://r2/cat.png' })
  const vid = projectExitus(undefined, [{ url: 'https://r2/x.webm' }])
  assert.deepEqual(vid, { video: 'https://r2/x.webm' })
})

test('no URLs → raw items pass through under outputs', () => {
  const m = modusWith({ text: { type: 'text' } })
  const items = [{ foo: 'bar' } as unknown as { url?: string }]
  assert.deepEqual(projectExitus(m, items), { outputs: items })
})

test('urlMediaType reads the extension, ignoring query strings', () => {
  assert.equal(urlMediaType('https://r2/a.png?sig=x'), 'image')
  assert.equal(urlMediaType('https://r2/a.mp4?t=1'), 'video')
  assert.equal(urlMediaType('https://r2/a.mp3'), 'audio')
  assert.equal(urlMediaType('https://r2/a.glb'), '3d')
})
