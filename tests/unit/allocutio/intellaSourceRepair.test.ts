// =============================================================================
// intellaSourceRepair.test.ts — noema-185
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_08_repair_intella_source_uri.ts`, and encodes the
// two-axis breakage it repairs: after the HuggingFace org rename, the
// `/resolve/` download path does not follow the rename AND the filenames inside
// the renamed repos changed. A rewrite that only swaps the org produces
// differently-broken URLs, so the filename choice is a decision with rules —
// and an unresolvable choice must be reported, never guessed.
//
// Hermetic: no Mongo, no network. That is the whole point of the split.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_HF_ORG,
  STALE_HF_ORG,
  buildResolveUri,
  chooseReplacementFile,
  isStaleOrg,
  parseHfResolveUri,
} from '../../../src/crystal/intellaSourceRepair.js'

describe('parseHfResolveUri', () => {
  test('parses a HuggingFace /resolve/ download URI into its parts', () => {
    const parts = parseHfResolveUri(
      `https://huggingface.co/${STALE_HF_ORG}/SampleLora/resolve/main/sample-6a1e5a.safetensors`,
    )
    assert.deepEqual(parts, {
      org: STALE_HF_ORG,
      repo: 'SampleLora',
      branch: 'main',
      file: 'sample-6a1e5a.safetensors',
    })
  })

  test('returns null for a non-HuggingFace source (left completely alone)', () => {
    assert.equal(parseHfResolveUri('https://models.miladystation2.net/lora/sample.safetensors'), null)
    assert.equal(parseHfResolveUri('https://civitai.com/api/download/models/12345'), null)
  })

  test('returns null for a HuggingFace URL that is not a /resolve/ path', () => {
    assert.equal(parseHfResolveUri(`https://huggingface.co/${STALE_HF_ORG}/SampleLora`), null)
    assert.equal(parseHfResolveUri(`https://huggingface.co/api/models/${STALE_HF_ORG}/SampleLora`), null)
    assert.equal(parseHfResolveUri(`https://huggingface.co/${STALE_HF_ORG}/SampleLora/blob/main/sample.safetensors`), null)
  })
})

describe('isStaleOrg', () => {
  test('only the renamed-away org is stale', () => {
    assert.equal(isStaleOrg(STALE_HF_ORG), true)
    assert.equal(isStaleOrg(CURRENT_HF_ORG), false)
    assert.equal(isStaleOrg('someone-else'), false)
  })
})

describe('chooseReplacementFile', () => {
  test('rule 1 — the old filename still exists, so only the org moved', () => {
    const choice = chooseReplacementFile('sample.safetensors', ['README.md', 'sample.safetensors'])
    assert.deepEqual(choice, { file: 'sample.safetensors' })
  })

  test('rule 2 — the filename changed and exactly one sibling is a weight file', () => {
    // The shape this repair actually hits: a hashed filename replaced by a
    // repo-named one, so rule 1 cannot fire.
    const choice = chooseReplacementFile('sample-6a1e5a.safetensors', [
      '.gitattributes',
      'README.md',
      'SampleLora.safetensors',
    ])
    assert.deepEqual(choice, { file: 'SampleLora.safetensors' })
  })

  test('rule 3 — several weight files, exactly one matching the declared format', () => {
    const choice = chooseReplacementFile(
      'sample-6a1e5a.safetensors',
      ['SampleLora.safetensors', 'SampleLora.ckpt', 'README.md'],
      'safetensors',
    )
    assert.deepEqual(choice, { file: 'SampleLora.safetensors' })
  })

  test('rule 4 — several weight files and no discriminator is ambiguous, not a guess', () => {
    const choice = chooseReplacementFile('sample-6a1e5a.safetensors', [
      'SampleLora.safetensors',
      'SampleLora-v2.safetensors',
    ])
    assert.ok('ambiguous' in choice, 'must report an ambiguity rather than pick the closest name')
    assert.ok(!('file' in choice), 'must not return a file')
    assert.match((choice as { ambiguous: string }).ambiguous, /SampleLora-v2\.safetensors/)
  })

  test('rule 4 — the declared format matching several candidates stays ambiguous', () => {
    const choice = chooseReplacementFile(
      'sample-6a1e5a.safetensors',
      ['SampleLora.safetensors', 'SampleLora-v2.safetensors', 'SampleLora.ckpt'],
      'safetensors',
    )
    assert.ok('ambiguous' in choice)
    assert.ok(!('file' in choice))
  })

  test('a repo with no weight file at all is ambiguous', () => {
    const choice = chooseReplacementFile('sample-6a1e5a.safetensors', ['README.md', '.gitattributes'])
    assert.ok('ambiguous' in choice)
  })
})

describe('buildResolveUri', () => {
  test('always emits the current org, even when the parts carry the stale one', () => {
    assert.equal(
      buildResolveUri({ org: STALE_HF_ORG, repo: 'SampleLora', branch: 'main', file: 'SampleLora.safetensors' }),
      `https://huggingface.co/${CURRENT_HF_ORG}/SampleLora/resolve/main/SampleLora.safetensors`,
    )
  })

  test('round-trips a rebuilt URI back through the parser (idempotent on a repaired record)', () => {
    const rebuilt = buildResolveUri({
      org: STALE_HF_ORG,
      repo: 'SampleLora',
      branch: 'main',
      file: 'SampleLora.safetensors',
    })
    const parts = parseHfResolveUri(rebuilt)
    assert.ok(parts)
    assert.equal(parts!.org, CURRENT_HF_ORG)
    assert.equal(isStaleOrg(parts!.org), false)
  })
})
