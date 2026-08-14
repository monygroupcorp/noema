import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionsToTrainingImages } from '../../../src/platforms/web/app/src/lib/captionsets.js'
import type { Dataset } from '../../../src/platforms/web/app/src/lib/api.js'

// ---------------------------------------------------------------------------
// The captionset → training projection (web lib). This is the only gated web
// logic on the dataset → training path: the screens themselves are typecheck-only,
// which is why the rules live in a pure module instead of in JSX.
//
// Fixtures are invented throughout (`ds-…`, `m-…`, `https://r2.example/…`).
// ---------------------------------------------------------------------------

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds-1',
    owner: 'anima-abc',
    name: 'sample dataset',
    modality: 'image',
    custody: 'remote',
    media: [],
    captionsets: [],
    versions: [],
    natum: '2026-01-01T00:00:00.000Z',
    mutatum: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function media(id: string) {
  return { id, url: `https://r2.example/${id}.png`, source: 'upload' as const, addedAt: '2026-01-01T00:00:00.000Z' }
}

// ---------------------------------------------------------------------------
// Test 1 — captions bind by media id, not by position
// ---------------------------------------------------------------------------

test('captionsToTrainingImages: a caption follows its image when media order differs', () => {
  const d = dataset({
    // media order (m-3, m-1, m-2) deliberately differs from the caption map's insertion order
    media: [media('m-3'), media('m-1'), media('m-2')],
    captionsets: [
      { id: 'cs-1', name: 'natural language', method: 'manual', coverage: '3/3',
        captions: { 'm-1': 'first caption', 'm-2': 'second caption', 'm-3': 'third caption' } },
    ],
  })

  const out = captionsToTrainingImages(d, 'cs-1')

  assert.deepEqual(out, [
    { url: 'https://r2.example/m-3.png', caption: 'third caption' },
    { url: 'https://r2.example/m-1.png', caption: 'first caption' },
    { url: 'https://r2.example/m-2.png', caption: 'second caption' },
  ])
})

// ---------------------------------------------------------------------------
// Test 2 — an image the chosen captionset does not cover is left out entirely
// ---------------------------------------------------------------------------

test('captionsToTrainingImages: an uncaptioned image is dropped, not sent captionless', () => {
  const d = dataset({
    media: [media('m-1'), media('m-2'), media('m-3')],
    captionsets: [
      { id: 'cs-1', name: 'natural language', method: 'manual', coverage: '1/3',
        captions: { 'm-2': 'the only caption', 'm-3': '   ' } },
    ],
  })

  const out = captionsToTrainingImages(d, 'cs-1')

  assert.equal(out.length, 1, 'only the captioned media item is sent')
  assert.deepEqual(out, [{ url: 'https://r2.example/m-2.png', caption: 'the only caption' }])
  assert.ok(out.every((im) => typeof im.caption === 'string' && im.caption.trim() !== ''),
    'no image is sent without a caption')
})

// ---------------------------------------------------------------------------
// Test 3 — the caller's captionset is the one that is used
// ---------------------------------------------------------------------------

test('captionsToTrainingImages: the chosen captionset wins over the first one', () => {
  const d = dataset({
    media: [media('m-1')],
    captionsets: [
      { id: 'cs-1', name: 'tags', method: 'manual', coverage: '1/1', captions: { 'm-1': 'from the first set' } },
      { id: 'cs-2', name: 'natural language', method: 'manual', coverage: '1/1', captions: { 'm-1': 'from the chosen set' } },
    ],
  })

  assert.deepEqual(captionsToTrainingImages(d, 'cs-2'), [
    { url: 'https://r2.example/m-1.png', caption: 'from the chosen set' },
  ])
  // and the unknown-captionset case sends nothing rather than falling back
  assert.deepEqual(captionsToTrainingImages(d, 'cs-missing'), [])
})
