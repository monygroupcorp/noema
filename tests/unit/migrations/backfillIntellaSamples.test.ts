import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAbsoluteHttpUrl,
  isCandidate,
  previewUrisToSamples,
} from '../../../scripts/migrations/2026_08_backfill_intella_samples.js'

test('isAbsoluteHttpUrl: accepts http/https, rejects relative paths and non-strings', () => {
  assert.equal(isAbsoluteHttpUrl('https://example.com/a.jpg'), true)
  assert.equal(isAbsoluteHttpUrl('http://example.com/a.jpg'), true)
  assert.equal(isAbsoluteHttpUrl('loraExamples/example.jpg'), false)
  assert.equal(isAbsoluteHttpUrl(''), false)
  assert.equal(isAbsoluteHttpUrl(undefined), false)
  assert.equal(isAbsoluteHttpUrl(42), false)
})

test('previewUrisToSamples: an absolute, live URL maps to a single-entry samples array', () => {
  const live = new Set(['https://example.com/a.jpg'])
  const samples = previewUrisToSamples(['https://example.com/a.jpg'], live)
  assert.deepEqual(samples, [{ url: 'https://example.com/a.jpg' }])
})

test('previewUrisToSamples: a relative-path-only record maps to an empty array', () => {
  const live = new Set<string>()
  const samples = previewUrisToSamples(['loraExamples/example.jpg'], live)
  assert.deepEqual(samples, [])
})

test('previewUrisToSamples: an absolute URL that did not probe live is excluded', () => {
  const live = new Set<string>() // caller never added this entry — the probe failed
  const samples = previewUrisToSamples(['https://example.com/dead.jpg'], live)
  assert.deepEqual(samples, [])
})

test('previewUrisToSamples: non-array input maps to an empty array', () => {
  assert.deepEqual(previewUrisToSamples(undefined, new Set()), [])
})

test('isCandidate: previewUris present and samples absent is a candidate', () => {
  assert.equal(isCandidate({ previewUris: ['https://example.com/a.jpg'] }), true)
})

test('isCandidate: a record with existing samples is never selected', () => {
  assert.equal(
    isCandidate({
      previewUris: ['https://example.com/a.jpg'],
      samples: [{ url: 'https://example.com/existing.jpg' }],
    }),
    false,
  )
})

test('isCandidate: no previewUris is not a candidate', () => {
  assert.equal(isCandidate({}), false)
  assert.equal(isCandidate({ previewUris: [] }), false)
})
