// =============================================================================
// loraSourceBackfill.test.ts
//
// Guards the rules behind scripts/migrations/2026_11_backfill_lora_sources.ts.
// The load-bearing one: a Civitai version is accepted only on strong evidence —
// an exact file-name match or ALL of the record's triggers, on a base model of
// the same family — because a wrong LoRA served under someone's trigger word is
// worse than none.
//
// Hermetic: no Mongo, no network.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  baseCompatible,
  civitaiSource,
  destFile,
  matchCivitaiVersion,
  mirrorLoraUri,
  mirrorSource,
  needsBackfill,
  parseCivitaiLink,
  pickLinkedVersion,
  safetensorsHeaderLength,
  type CivitaiVersion,
} from '../../../src/crystal/loraSourceBackfill.js'
import { hasDownloadSource } from '../../../src/crystal/intellaSourceGuard.js'

const v = (o: Partial<CivitaiVersion> & { versionId: number }): CivitaiVersion =>
  ({ modelId: 1, baseModel: 'Flux.1 D', trainedWords: [], files: [], ...o })

describe('mirror URIs', () => {
  test('use the record\'s own dest filename under loras/', () => {
    assert.equal(destFile('models/loras/samplestyleflux.safetensors'), 'samplestyleflux.safetensors')
    assert.equal(mirrorLoraUri('models/loras/samplestyleflux.safetensors'), 'https://models.miladystation2.net/loras/samplestyleflux.safetensors')
  })
  test('encode a filename that is not URL-safe', () => {
    assert.equal(mirrorLoraUri('models/loras/a b#.safetensors'), 'https://models.miladystation2.net/loras/a%20b%23.safetensors')
  })
  test('the sources written satisfy the guard', () => {
    assert.ok(hasDownloadSource([mirrorSource('models/loras/x.safetensors')]))
    assert.ok(hasDownloadSource([civitaiSource({ modelId: 2, versionId: 3, evidence: '' })]))
  })
})

describe('baseCompatible', () => {
  test('flux accepts Flux.1 dev and schnell', () => {
    assert.ok(baseCompatible('flux', 'Flux.1 D'))
    assert.ok(baseCompatible('flux', 'Flux.1 S'))
  })
  test('a different base of the same name family is not accepted', () => {
    assert.equal(baseCompatible('flux', 'Flux.2 Klein 9B'), false)
    assert.equal(baseCompatible('sdxl', 'Pony'), false)
    assert.equal(baseCompatible('sdxl', 'Illustrious'), false)
  })
  test('no familia or no base is never compatible', () => {
    assert.equal(baseCompatible(undefined, 'Flux.1 D'), false)
    assert.equal(baseCompatible('flux', undefined), false)
  })
})

describe('matchCivitaiVersion', () => {
  const record = { dest: 'models/loras/Retro_Console_Style_F1D.safetensors', familia: 'flux', triggers: ['retrostyle', 'retrov2'] }

  test('an exact file name on a compatible base matches, case-insensitively', () => {
    const m = matchCivitaiVersion(record, [
      v({ versionId: 10, files: ['retro_console_style_f1d.safetensors'] }),
      v({ versionId: 11, files: ['other.safetensors'], trainedWords: ['retrostyle'] }),
    ])
    assert.equal(m?.versionId, 10)
  })

  test('the same file name on an incompatible base does not', () => {
    const m = matchCivitaiVersion(record, [v({ versionId: 10, baseModel: 'SDXL 1.0', files: ['Retro_Console_Style_F1D.safetensors'] })])
    assert.equal(m, null)
  })

  test('a trigger match needs EVERY trigger, not just one', () => {
    const some = matchCivitaiVersion(record, [v({ versionId: 12, trainedWords: ['Retrostyle'] })])
    assert.equal(some, null)
    const all = matchCivitaiVersion(record, [v({ versionId: 13, trainedWords: ['Retro style', 'retrov2', 'low poly'] })])
    assert.equal(all?.versionId, 13)
  })

  test('triggers fold underscores, spaces and case', () => {
    const m = matchCivitaiVersion(
      { dest: 'models/loras/ToyBox.safetensors', familia: 'flux', triggers: ['acessory', 'boxed_toy_with_parts'] },
      [v({ versionId: 14, trainedWords: ['boxed toy with parts', 'text "TOY BOX"', 'acessory'] })],
    )
    assert.equal(m?.versionId, 14)
  })

  test('two versions satisfying the same rule is ambiguous — no guess', () => {
    const m = matchCivitaiVersion(record, [
      v({ versionId: 20, files: ['Retro_Console_Style_F1D.safetensors'] }),
      v({ versionId: 21, files: ['Retro_Console_Style_F1D.safetensors'] }),
    ])
    assert.equal(m, null)
  })

  test('the same version returned by two searches is counted once', () => {
    const one = v({ versionId: 30, files: ['Retro_Console_Style_F1D.safetensors'] })
    assert.equal(matchCivitaiVersion(record, [one, { ...one }])?.versionId, 30)
  })

  test('a record with no triggers matches only by file name', () => {
    assert.equal(matchCivitaiVersion({ ...record, triggers: [] }, [v({ versionId: 40, trainedWords: [] })]), null)
  })

  test('one generic trigger is not evidence, even when it is the only candidate', () => {
    const m = matchCivitaiVersion(
      { dest: 'models/loras/hat.safetensors', familia: 'sdxl', triggers: ['top_hat'] },
      [v({ versionId: 41, baseModel: 'SDXL 1.0', trainedWords: ['top hat'], files: ['top_hat.safetensors'] })],
    )
    assert.equal(m, null)
  })
})

describe('needsBackfill', () => {
  test('empty, missing, bare-host and page-only sources need one', () => {
    assert.ok(needsBackfill([]))
    assert.ok(needsBackfill(undefined))
    assert.ok(needsBackfill([{ provenance: 'civitai', uri: 'miladystation2.net' }]))
    assert.ok(needsBackfill([{ provenance: 'civitai', uri: 'https://civitai.com/models/1/x' }]))
  })
  test('a record with one download-shaped source does not', () => {
    assert.equal(needsBackfill([{ provenance: 'civitai', uri: 'https://civitai.com/models/1/x' }, mirrorSource('models/loras/x.safetensors')]), false)
  })
})

describe('parseCivitaiLink', () => {
  test('reads the model id and, when present, the version id', () => {
    assert.deepEqual(parseCivitaiLink('https://civitai.com/models/2002?modelVersionId=3003'), { modelId: 2002, versionId: 3003 })
    assert.deepEqual(parseCivitaiLink('https://civitai.com/models/4004/sample-style'), { modelId: 4004 })
  })
  test('ignores anything that is not a civitai model link', () => {
    assert.equal(parseCivitaiLink('miladystation2.net'), null)
    assert.equal(parseCivitaiLink('https://civitai.com/api/download/models/1'), null)
    assert.equal(parseCivitaiLink('https://example.com/models/1'), null)
  })
})

describe('pickLinkedVersion', () => {
  const rec = { dest: 'models/loras/sample.safetensors', familia: 'sdxl' }
  const sdxl = (versionId: number, files: string[] = []) => v({ modelId: 7, versionId, baseModel: 'SDXL 1.0', files })

  test('takes the version the link names, when its base is compatible', () => {
    assert.equal(pickLinkedVersion({ modelId: 7, versionId: 2 }, rec, [sdxl(1), sdxl(2)])?.versionId, 2)
  })
  test('refuses the named version on an incompatible base rather than substituting another', () => {
    assert.equal(pickLinkedVersion({ modelId: 7, versionId: 2 }, rec, [sdxl(1), v({ modelId: 7, versionId: 2, baseModel: 'Pony' })]), null)
  })
  test('with no named version: the dest filename, else the only compatible version', () => {
    assert.equal(pickLinkedVersion({ modelId: 7 }, rec, [sdxl(1), sdxl(2, ['SAMPLE.safetensors'])])?.versionId, 2)
    assert.equal(pickLinkedVersion({ modelId: 7 }, rec, [sdxl(3), v({ modelId: 7, versionId: 4, baseModel: 'Pony' })])?.versionId, 3)
  })
  test('several compatible versions and no filename to tell them apart is no pick', () => {
    assert.equal(pickLinkedVersion({ modelId: 7 }, rec, [sdxl(1), sdxl(2)]), null)
  })
  test('versions of a different model are never considered', () => {
    assert.equal(pickLinkedVersion({ modelId: 7 }, rec, [v({ modelId: 8, versionId: 9, baseModel: 'SDXL 1.0' })]), null)
  })
})

describe('safetensorsHeaderLength', () => {
  const le = (n: number) => { const b = new Uint8Array(8); let x = n; for (let i = 0; i < 8; i++) { b[i] = x % 256; x = Math.floor(x / 256) } return b }
  test('reads a little-endian u64', () => {
    assert.equal(safetensorsHeaderLength(le(0x020e)), 0x020e)
  })
  test('rejects what an HTML error page starts with', () => {
    assert.equal(safetensorsHeaderLength(new TextEncoder().encode('<!DOCTYP')), null)
  })
  test('rejects a short read and an absurd length', () => {
    assert.equal(safetensorsHeaderLength(new Uint8Array(4)), null)
    assert.equal(safetensorsHeaderLength(le(0)), null)
    assert.equal(safetensorsHeaderLength(le(200_000_000)), null)
  })
})
