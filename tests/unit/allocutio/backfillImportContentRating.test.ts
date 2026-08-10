// Backfill migration (noema-189) — hermetic. Drives the pure decision function over
// fixture records. No network, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideBackfill } from '../../../scripts/migrations/2026_08_backfill_import_content_rating.js'

// ── originNsfw: true → derives 'explicit', is untriaged, and gets updated ──────

test('decideBackfill: originNsfw true on an untriaged record -> update to explicit', () => {
  const decision = decideBackfill({
    contentRating: 'untriaged',
    sources: [{ meta: { originNsfw: true } }],
  })
  assert.deepEqual(decision, { action: 'update', rating: 'explicit' })
})

// ── originNsfw: false → derives 'sfw', absent rating, gets updated ─────────────

test('decideBackfill: originNsfw false on a record with no contentRating -> update to sfw', () => {
  const decision = decideBackfill({
    sources: [{ meta: { originNsfw: false } }],
  })
  assert.deepEqual(decision, { action: 'update', rating: 'sfw' })
})

// ── no signal on any source → skip, never guess ─────────────────────────────

test('decideBackfill: no source carries an originNsfw key -> skip-no-signal', () => {
  const decision = decideBackfill({
    contentRating: 'untriaged',
    sources: [{ meta: { modelId: 92654 } }, { meta: {} }],
  })
  assert.deepEqual(decision, { action: 'skip-no-signal' })
})

test('decideBackfill: no sources at all -> skip-no-signal', () => {
  const decision = decideBackfill({ contentRating: 'untriaged' })
  assert.deepEqual(decision, { action: 'skip-no-signal' })
})

// ── malformed signal → the key exists but does not parse to true/false ─────────

test('decideBackfill: originNsfw present but the wrong type -> skip-malformed-signal', () => {
  const decision = decideBackfill({
    contentRating: 'untriaged',
    sources: [{ meta: { originNsfw: 'yes' } }],
  })
  assert.deepEqual(decision, { action: 'skip-malformed-signal' })
})

// ── already rated → NEVER downgraded, even when the derivation disagrees ───────

test('decideBackfill: already sfw, derivation agrees -> skip-already-rated, not rewritten', () => {
  const decision = decideBackfill({
    contentRating: 'sfw',
    sources: [{ meta: { originNsfw: false } }],
  })
  assert.deepEqual(decision, { action: 'skip-already-rated', existing: 'sfw', derived: 'sfw', agrees: true })
})

test('decideBackfill: already sfw, derivation disagrees (origin now says explicit) -> still skip, never downgrade', () => {
  const decision = decideBackfill({
    contentRating: 'sfw',
    sources: [{ meta: { originNsfw: true } }],
  })
  assert.deepEqual(decision, { action: 'skip-already-rated', existing: 'sfw', derived: 'explicit', agrees: false })
})

test('decideBackfill: already explicit -> skip-already-rated regardless of the derived value', () => {
  const decision = decideBackfill({
    contentRating: 'explicit',
    sources: [{ meta: { originNsfw: false } }],
  })
  assert.deepEqual(decision, { action: 'skip-already-rated', existing: 'explicit', derived: 'sfw', agrees: false })
})

test('decideBackfill: already suggestive (human-triage-only value) -> skip-already-rated, never touched', () => {
  const decision = decideBackfill({
    contentRating: 'suggestive',
    sources: [{ meta: { originNsfw: true } }],
  })
  assert.deepEqual(decision, { action: 'skip-already-rated', existing: 'suggestive', derived: 'explicit', agrees: false })
})

// ── canonical seeds → always skipped, authoritative regardless of signal ───────

test('decideBackfill: canonica true -> skip-canonical even with a clear signal and untriaged rating', () => {
  const decision = decideBackfill({
    contentRating: 'untriaged',
    canonica: true,
    sources: [{ meta: { originNsfw: true } }],
  })
  assert.deepEqual(decision, { action: 'skip-canonical' })
})

// ── the origin is not always sources[0] (public promotion prepends our bucket) ─

test('decideBackfill: the origin signal is found regardless of its index in sources[]', () => {
  const decision = decideBackfill({
    contentRating: 'untriaged',
    sources: [{ meta: { modelId: 1 } }, { meta: { originNsfw: false } }],
  })
  assert.deepEqual(decision, { action: 'update', rating: 'sfw' })
})
