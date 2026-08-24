// Legacy-preview rescan+rehost migration (noema-196-followon) — hermetic. Drives the pure
// decision function over fixture records + synthetic verdicts. No network, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideRescan } from '../../../scripts/migrations/2026_08_rescan_rehost_legacy_previews.js'

const ORIGIN_SAMPLE = { url: 'https://image.civitai.com/xyz/preview.jpeg' }
const HF_SAMPLE = { url: 'https://huggingface.co/datasets/foo/resolve/main/preview.png' }
const REHOSTED_SAMPLE = { url: 'https://pub-example.r2.dev/model-previews/import-abc/000.jpg' }

test('decideRescan: scan passes on an origin-hosted sample -> rehost', () => {
  const decision = decideRescan({ samples: [ORIGIN_SAMPLE] }, { ok: true })
  assert.equal(decision, 'rehost')
})

test('decideRescan: scan rejects (plain) -> unpublish', () => {
  const decision = decideRescan({ samples: [ORIGIN_SAMPLE] }, { ok: false, reason: 'known-hash match' })
  assert.equal(decision, 'unpublish')
})

test('decideRescan: scan rejects with hold -> unpublish (Intella has no distinct hold state)', () => {
  const decision = decideRescan({ samples: [HF_SAMPLE] }, { ok: false, reason: 'held for manual review', hold: true })
  assert.equal(decision, 'unpublish')
})

test('decideRescan: no origin-hosted sample remains -> skip-no-signal, no verdict required', () => {
  const decision = decideRescan({ samples: [REHOSTED_SAMPLE] })
  assert.equal(decision, 'skip-no-signal')
})

test('decideRescan: no samples at all -> skip-no-signal', () => {
  const decision = decideRescan({})
  assert.equal(decision, 'skip-no-signal')
})

test('decideRescan: a mix of origin + already-rehosted samples still counts as origin-hosted', () => {
  const decision = decideRescan({ samples: [REHOSTED_SAMPLE, ORIGIN_SAMPLE] }, { ok: true })
  assert.equal(decision, 'rehost')
})
