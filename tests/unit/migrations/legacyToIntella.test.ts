// Six fixtures covering shape-variety cases the migration has to handle.
// Each asserts the produced Intella matches the spec at docs/spec/intella-schema.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacyToIntella, type LegacyLoraDoc, type MigrationLookups } from '../../../src/migrations/loras/legacyToIntella.js'

const LOOKUPS: MigrationLookups = {
  checkpointToBaseIntellaId: {
    'FLUX':         'intella.flux-base',
    'SDXL':         'intella.sdxl-base',
    'SD1.5':        'intella.sd15-base',
    'KONTEXT':      'intella.kontext-base',
    'ILLUSTRIOUS':  'intella.illustrious-base',
  },
  platformAnimaIds: new Set(['platform']),
}

// ── 1. Platform-trained: createdBy is a regular user, importedFrom.source = platform-training ──
test('platform-trained: trainer becomes author + owner; not authorless', () => {
  const doc: LegacyLoraDoc = {
    _id: '507f1f77bcf86cd799439011',
    slug: 'cat-portrait', name: 'Cat Portrait',
    triggerWords: ['cat-portrait'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    visibility: 'public', permissionType: 'public',
    createdBy: 'anima-alice',
    importedFrom: { source: 'platform-training', importedAt: new Date('2026-01-01') },
    createdAt: new Date('2026-01-01'),
  }
  const { intella, log } = legacyToIntella(doc, LOOKUPS)
  assert.deepEqual(intella.authorAnimaIds, ['anima-alice'])
  assert.equal(intella.ownerAnimaId, 'anima-alice')
  assert.equal(intella.importerAnimaId, undefined, 'platform-trained → no importer rail')
  assert.equal(intella.canonica, false)
  assert.equal(intella.transferable, true)
  if (intella.genus !== 'lora') throw new Error('expected lora')
  assert.equal(intella.params.baseIntellaId, 'intella.flux-base')
  assert.deepEqual(intella.access, { kind: 'public' })
  // platform-trained docs typically have no external sourceUri ("no source URI"), and a bare
  // 'FLUX' checkpoint is license-indeterminable (schnell vs dev) → a fail-closed 'unknown' notice.
  // Both are informational + expected. Anything else is a real issue.
  const unexpected = log.warnings.filter(w => !w.includes('no source URI') && !w.includes('license indeterminable'))
  assert.deepEqual(unexpected, [], `unexpected warnings: ${unexpected.join('; ')}`)
})

// ── 2. HF import: imported model is AUTHORLESS; importer becomes owner ──
test('HF import: authorless; importer becomes owner; importerAnimaId set', () => {
  const doc: LegacyLoraDoc = {
    _id: '507f1f77bcf86cd799439012',
    slug: 'milady-v3', name: 'Milady v3',
    triggerWords: ['milady'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    visibility: 'public', permissionType: 'public',
    createdBy: 'anima-bob',
    importedFrom: {
      source: 'huggingface',
      url: 'https://huggingface.co/foo/milady-v3',
      originalAuthor: 'foo',
      importedAt: new Date('2026-02-01'),
    },
    createdAt: new Date('2026-02-01'),
  }
  const { intella } = legacyToIntella(doc, LOOKUPS)
  assert.deepEqual(intella.authorAnimaIds, [], 'authorless on import')
  assert.equal(intella.ownerAnimaId, 'anima-bob', 'importer becomes owner')
  assert.equal(intella.importerAnimaId, 'anima-bob', 'importerAnimaId records the curator')
  assert.equal(intella.importedFrom?.source, 'huggingface')
  assert.equal(intella.importedFrom?.sourceUri, 'https://huggingface.co/foo/milady-v3')
  assert.equal(intella.importedFrom?.originalAuthor, 'foo')
})

// ── 3. Civitai import: same shape as HF; just a different source ──
test('Civitai import: same authorless pattern; source = civitai', () => {
  const doc: LegacyLoraDoc = {
    _id: '507f1f77bcf86cd799439013',
    slug: 'sdxl-style',
    triggerWords: ['styleA', 'StyleA_v2'],
    defaultWeight: 0.8, checkpoint: 'SDXL',
    createdBy: 'anima-carol',
    importedFrom: { source: 'civitai', importedAt: new Date('2026-02-15') },
    createdAt: new Date('2026-02-15'),
  }
  const { intella } = legacyToIntella(doc, LOOKUPS)
  assert.deepEqual(intella.authorAnimaIds, [])
  assert.equal(intella.ownerAnimaId, 'anima-carol')
  assert.equal(intella.importedFrom?.source, 'civitai')
  if (intella.genus !== 'lora') throw new Error('expected lora')
  assert.equal(intella.params.baseIntellaId, 'intella.sdxl-base')
  assert.deepEqual(intella.params.triggerWords, ['stylea', 'stylea_v2'], 'lowercased, deduped')
})

// ── 4. Private with sharedWith allowlist (legacy permissionType=licensed) ──
test('legacy permissionType=licensed: maps to private with sharedWith allowlist', () => {
  const doc: LegacyLoraDoc = {
    _id: '507f1f77bcf86cd799439014',
    slug: 'private-stuff',
    triggerWords: ['secret'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    visibility: 'public', permissionType: 'licensed',   // legacy "licensed" → crystal private+allowlist
    accessControl: ['anima-buyer-1', 'anima-buyer-2'],
    createdBy: 'anima-dave',
    importedFrom: { source: 'platform-training', importedAt: new Date('2026-03-01') },
    createdAt: new Date('2026-03-01'),
  }
  const { intella } = legacyToIntella(doc, LOOKUPS)
  if (intella.access.kind !== 'private') throw new Error(`expected private, got ${intella.access.kind}`)
  assert.equal(intella.access.ownerAnimaId, 'anima-dave')
  assert.deepEqual(intella.access.sharedWith, ['anima-buyer-1', 'anima-buyer-2'])
})

// ── 5. Cognates: legacy cognate words merge into triggerWords[] ──
test('cognates: alias words merged into triggerWords; replaceWith preserved as alias too', () => {
  const doc: LegacyLoraDoc = {
    _id: '507f1f77bcf86cd799439015',
    slug: 'milady-long', name: 'Milady (long form)',
    triggerWords: ['milady_v3_finetune'],
    cognates: [
      { word: 'milady', replaceWith: 'milady_v3_finetune' },
      { word: 'mld' },
    ],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    createdBy: 'anima-eve',
    importedFrom: { source: 'platform-training', importedAt: new Date('2026-04-01') },
    createdAt: new Date('2026-04-01'),
  }
  const { intella, log } = legacyToIntella(doc, LOOKUPS)
  if (intella.genus !== 'lora') throw new Error('expected lora')
  // 'milady_v3_finetune' (canonical) + 'milady' + 'mld'
  assert.deepEqual(
    intella.params.triggerWords.sort(),
    ['milady', 'milady_v3_finetune', 'mld'].sort(),
  )
  // No cognate-related warning expected — replaceWith matches the canonical trigger.
  const cognateWarnings = log.warnings.filter(w => w.includes('cognate'))
  assert.equal(cognateWarnings.length, 0, "replaceWith === canonical trigger; no cognate warning expected")
})

// ── 6. Platform-canonical: createdBy is the platform anima ──
test('canonical platform model: canonica=true, transferable=false, royalty routes to platform', () => {
  const doc: LegacyLoraDoc = {
    _id: '507f1f77bcf86cd799439016',
    slug: 'flux-base-canonical', name: 'FLUX Base (canonical)',
    triggerWords: [], defaultWeight: 1.0,
    checkpoint: 'FLUX',
    visibility: 'public', permissionType: 'public',
    createdBy: 'platform',   // the platform anima id (per LOOKUPS.platformAnimaIds)
    createdAt: new Date('2025-01-01'),
  }
  const { intella } = legacyToIntella(doc, LOOKUPS)
  assert.equal(intella.canonica, true)
  assert.equal(intella.transferable, false)
  assert.deepEqual(intella.authorAnimaIds, [], 'canonical: authorAnimaIds empty')
  assert.equal(intella.ownerAnimaId, undefined, 'canonical: ownerAnimaId unset; routes to PLATFORM_ANIMA_ID at hook time')
})

// ── Edge: missing source treats as authorless (defensive) ─────────────────
test('missing importedFrom.source: defensive — authorless + importer=createdBy + warning', () => {
  const doc: LegacyLoraDoc = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    slug: 'mystery', triggerWords: ['mystery'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    createdBy: 'anima-x',
    createdAt: new Date('2026-05-01'),
  }
  const { intella, log } = legacyToIntella(doc, LOOKUPS)
  assert.deepEqual(intella.authorAnimaIds, [])
  assert.equal(intella.ownerAnimaId, 'anima-x')
  assert.equal(intella.importerAnimaId, 'anima-x')
  assert.ok(log.warnings.some(w => w.includes('source missing')), 'warning emitted')
})

// ── Edge: unknown checkpoint logs a warning + falls back ──────────────────
test('unknown checkpoint: baseIntellaId falls back to intella.unknown-base with warning', () => {
  const doc: LegacyLoraDoc = {
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    slug: 'oddball', triggerWords: ['oddball'],
    defaultWeight: 1.0, checkpoint: 'EXOTIC-V42',
    createdBy: 'anima-y',
    importedFrom: { source: 'platform-training', importedAt: new Date() },
    createdAt: new Date(),
  }
  const { intella, log } = legacyToIntella(doc, LOOKUPS)
  if (intella.genus !== 'lora') throw new Error('expected lora')
  assert.equal(intella.params.baseIntellaId, 'intella.unknown-base')
  assert.ok(log.warnings.some(w => w.includes('EXOTIC-V42')))
})

// ── Edge: monetization block preserved verbatim ───────────────────────────
test('monetization block: preserved on legacyMonetization field verbatim', () => {
  const monetization = { priceUSD: 5, forSale: true, licenseTerms: 'CC-BY-NC for non-commercial' }
  const doc: LegacyLoraDoc = {
    _id: 'cccccccccccccccccccccccc',
    slug: 'paid', triggerWords: ['paid'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    createdBy: 'anima-z',
    monetization,
    importedFrom: { source: 'platform-training', importedAt: new Date() },
    createdAt: new Date(),
  }
  const { intella } = legacyToIntella(doc, LOOKUPS)
  assert.deepEqual(intella.legacyMonetization, monetization, 'monetization preserved verbatim')
})

// ── Edge: tags['auto'] source rewritten to 'admin' per spec ──────────────
test("tags source 'auto': rewritten to 'admin'", () => {
  const doc: LegacyLoraDoc = {
    _id: 'dddddddddddddddddddddddd',
    slug: 'tagged', triggerWords: ['tagged'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    tags: [
      { tag: 'style', source: 'user', score: 1 },
      { tag: 'portrait', source: 'auto' },
    ],
    createdBy: 'anima-w',
    importedFrom: { source: 'platform-training', importedAt: new Date() },
    createdAt: new Date(),
  }
  const { intella } = legacyToIntella(doc, LOOKUPS)
  assert.deepEqual(
    intella.tags?.map(t => ({ tag: t.tag, source: t.source })),
    [{ tag: 'style', source: 'user' }, { tag: 'portrait', source: 'admin' }],
  )
})

// ── License backfill (go-public gate): derive license + commercialUse from the checkpoint ──
test('license reconcile: SDXL checkpoint → openrail-m / yes; bare FLUX → fail-closed unknown', () => {
  const sdxl: LegacyLoraDoc = {
    _id: 'ee11ee11ee11ee11ee11ee11',
    slug: 'sdxl-lora', triggerWords: ['sdxlstyle'],
    defaultWeight: 0.8, checkpoint: 'SDXL',
    createdBy: 'anima-x',
    importedFrom: { source: 'civitai', importedAt: new Date() },
    createdAt: new Date(),
  }
  const s = legacyToIntella(sdxl, LOOKUPS).intella
  assert.equal(s.license, 'openrail-m')
  assert.equal(s.commercialUse, 'yes')

  // Bare 'FLUX' can't disambiguate schnell (Apache) from dev (Non-Commercial) → fail-closed.
  const flux: LegacyLoraDoc = {
    _id: 'ff22ff22ff22ff22ff22ff22',
    slug: 'flux-lora', triggerWords: ['fluxstyle'],
    defaultWeight: 1.0, checkpoint: 'FLUX',
    createdBy: 'anima-y',
    importedFrom: { source: 'civitai', importedAt: new Date() },
    createdAt: new Date(),
  }
  const { intella: f, log } = legacyToIntella(flux, LOOKUPS)
  assert.equal(f.license, 'unknown')
  assert.equal(f.commercialUse, 'unknown')
  assert.ok(log.warnings.some(w => w.includes('license indeterminable')), 'fail-closed license warning emitted')
})
