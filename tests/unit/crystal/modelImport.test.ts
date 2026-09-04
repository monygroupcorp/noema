// Model import by URL (`docs/spec/model-import.md`) — hermetic. The resolver is driven with a fake
// JSON fetcher over fixture Civitai/HF payloads; the importer with a fake fetcher/store/writer/
// gate. No network, no R2, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveImport, mapToFamilia, ModelImportError, SecretRequiredError } from '../../../src/crystal/modelImportResolver.js'
import { classifyBaseModel, licenseCommercial, civitaiCommercial, hfLicenseToId, combineCommercial, classifyModelLicense } from '../../../src/crystal/modelLicense.js'
import type { JsonFetcher } from '../../../src/crystal/modelImportResolver.js'
import { ModelImporter, deriveImportContentRating } from '../../../src/crystal/ModelImporter.js'
import type { ModerationGate } from '../../../src/crystal/ModerationGate.js'
import type { Intella } from '../../../src/types/intelligendi.js'

// ── Fixtures ────────────────────────────────────────────────────────────────

const CIVITAI_LORA = {
  id: 92654,
  name: 'Armored Dress',
  type: 'LORA',
  creator: { username: 'someartist' },
  tags: ['clothing', 'armor'],
  modelVersions: [
    {
      id: 1165788,
      name: 'v2.0',
      baseModel: 'SD 1.5',
      description: '<p>trigger with armored_dress</p>',
      trainedWords: ['gothic armor', 'armored_dress'],
      images: [{ url: 'https://civitai.com/preview/1.png' }],
      files: [{ name: 'armored_dress_V02.safetensors', downloadUrl: 'https://civitai.com/api/download/models/1165788', sizeKB: 13500 }],
    },
    { id: 999, name: 'v1.0', baseModel: 'SD 1.5', files: [{ name: 'old.safetensors', downloadUrl: 'https://civitai.com/api/download/models/999' }] },
  ],
}

// Same shape as CIVITAI_LORA but flagged adult by the origin itself. The numeric level is present
// too (the resolver captures it raw) — the derivation must ignore it and read only the boolean.
const CIVITAI_NSFW_LORA = { ...CIVITAI_LORA, id: 92655, name: 'Spicy Style', nsfw: true, nsfwLevel: 28 }

// Flagged safe by the origin, with a high numeric level — the shape that proves the level is not
// thresholded: mainstream checkpoints carry a high level purely from their community galleries.
const CIVITAI_SFW_LORA = { ...CIVITAI_LORA, id: 92656, name: 'Mainstream Style', nsfw: false, nsfwLevel: 31 }

const HF_LORA = {
  modelId: 'someuser/my-flux-lora',
  author: 'someuser',
  tags: ['lora', 'text-to-image'],
  cardData: { base_model: 'black-forest-labs/FLUX.1-dev', trigger_words: ['mytoken'], title: 'My Flux LoRA', description: 'a nice lora' },
  siblings: [{ rfilename: 'my_flux_lora.safetensors' }, { rfilename: 'preview.png' }, { rfilename: 'README.md' }],
}

const jsonOf = (payload: unknown): JsonFetcher => ({ async fetchJson() { return payload } })

// ── Resolver: family mapping ──────────────────────────────────────────────────

test('mapToFamilia: maps to families with a base flow (incl. SDXL finetunes); rejects the rest; order is load-bearing', () => {
  assert.equal(mapToFamilia('SDXL 1.0'), 'sdxl')
  assert.equal(mapToFamilia('SD 1.5'), 'sd15')
  assert.equal(mapToFamilia('FLUX.1-dev'), 'flux')
  assert.equal(mapToFamilia('FLUX.2 klein'), 'flux2')        // flux2 before flux
  assert.equal(mapToFamilia('Chroma'), 'chroma')
  assert.equal(mapToFamilia('Krea 2'), 'krea2')
  assert.equal(mapToFamilia('Z-Image Turbo'), 'zimage')
  assert.equal(mapToFamilia('Pony Realism'), 'sdxl')         // SDXL-architecture finetune → stacks on sdxl
  assert.equal(mapToFamilia('Flux.1 Kontext'), 'flux')        // flux1-family edit model — existing flux LoRAs apply
  // No base flow → rejected (null), NOT silently mismapped:
  assert.equal(mapToFamilia('SD3 Medium'), null)
  assert.equal(mapToFamilia('Stable Cascade'), null)
})

// ── License classification (the axis familia collapses) ───────────────────────

test('classifyBaseModel: FLUX schnell vs dev — SAME familia, DIFFERENT license (the critical split)', () => {
  const schnell = classifyBaseModel('FLUX.1-schnell')
  const dev = classifyBaseModel('FLUX.1-dev')
  assert.equal(schnell.familia, 'flux')
  assert.equal(dev.familia, 'flux')                          // same compat family…
  assert.equal(schnell.license, 'apache-2.0')
  assert.equal(dev.license, 'flux-1-dev-nc')                 // …different license
  assert.equal(licenseCommercial(schnell.license), 'yes')    // schnell clears the commercial catalog
  assert.equal(licenseCommercial(dev.license), 'no')         // dev does NOT
})

test('classifyBaseModel: bare FLUX (no variant) is fail-closed, not assumed schnell', () => {
  assert.equal(licenseCommercial(classifyBaseModel('FLUX').license), 'unknown')
})

test('classifyBaseModel: Kontext is flux1 familia, still Non-Commercial license', () => {
  const kontext = classifyBaseModel('FLUX.1 Kontext dev')
  assert.equal(kontext.familia, 'flux')                          // existing flux LoRAs apply
  assert.equal(licenseCommercial(kontext.license), 'no')         // NC — the license column is unaffected
})

test('classifyBaseModel: license verdicts across families', () => {
  assert.equal(licenseCommercial(classifyBaseModel('SDXL 1.0').license), 'yes')     // openrail-m
  assert.equal(licenseCommercial(classifyBaseModel('SD 1.5').license), 'yes')       // openrail-m
  assert.equal(licenseCommercial(classifyBaseModel('Chroma').license), 'yes')       // apache
  assert.equal(licenseCommercial(classifyBaseModel('Z-Image').license), 'yes')      // apache
  assert.equal(licenseCommercial(classifyBaseModel('Krea 2').license), 'conditional') // <$1M community
  assert.equal(licenseCommercial(classifyBaseModel('Pony').license), 'yes')         // fair-ai-public
  // FLUX.2 variants (confirmed vs BFL): ONLY klein 4B is Apache; klein 9B + dev are Non-Commercial.
  assert.equal(classifyBaseModel('FLUX.2 klein 4B').license, 'apache-2.0')
  assert.equal(licenseCommercial(classifyBaseModel('FLUX.2 klein 4B').license), 'yes')
  assert.equal(licenseCommercial(classifyBaseModel('FLUX.2 Klein 9B').license), 'no')   // our seed = 9B → NC
  assert.equal(licenseCommercial(classifyBaseModel('flux2-klein').license), 'no')       // size unstated → fail-closed NC
  assert.equal(licenseCommercial(classifyBaseModel('FLUX.2 dev').license), 'no')
  assert.equal(licenseCommercial(classifyBaseModel('FLUX.2').license), 'unknown')
})

test('classifyModelLicense: base-string priority baseModel > provenance.base > nomen > familia (reclassify + sweep share this)', () => {
  // baseModel (the resolved training/import-time descriptor) wins over everything, including a
  // disagreeing provenance.base (a DIFFERENT statement — external retrain lineage).
  assert.deepEqual(
    classifyModelLicense({ baseModel: 'FLUX.1-schnell', provenance: { base: 'FLUX.1-dev' }, nomen: 'My Dev-ish LoRA', familia: 'flux' }),
    { license: 'apache-2.0', commercialUse: 'yes' },
  )
  // No baseModel → provenance.base wins even when nomen/familia disagree — the author-declared
  // lineage is truth.
  assert.deepEqual(
    classifyModelLicense({ provenance: { base: 'FLUX.1-dev' }, nomen: 'My Schnell-ish LoRA', familia: 'flux' }),
    { license: 'flux-1-dev-nc', commercialUse: 'no' },
  )
  // No provenance.base → fall to nomen (the descriptive title, e.g. canonical seeds).
  assert.deepEqual(
    classifyModelLicense({ nomen: 'FLUX.1 Schnell (fp8 scaled)', familia: 'flux' }),
    { license: 'apache-2.0', commercialUse: 'yes' },
  )
  // Only bare familia → license-ambiguous ('flux' can't tell schnell from dev) → fail-closed unknown.
  assert.deepEqual(
    classifyModelLicense({ familia: 'flux' }),
    { license: 'unknown', commercialUse: 'unknown' },
  )
  // Nothing to go on → fail-closed unknown (NOT a permissive default).
  assert.deepEqual(classifyModelLicense({}), { license: 'unknown', commercialUse: 'unknown' })
})

test('isCatalogEligible: yes + conditional pass; no + unknown are refused', async () => {
  const { isCatalogEligible } = await import('../../../src/crystal/modelLicense.js')
  assert.equal(isCatalogEligible('yes'), true)
  assert.equal(isCatalogEligible('conditional'), true)   // SD3/Krea under-threshold — allowed
  assert.equal(isCatalogEligible('no'), false)
  assert.equal(isCatalogEligible('unknown'), false)
  assert.equal(isCatalogEligible(undefined), false)
})

test('licenseNote: a plain-language, use-vs-listing message per verdict', async () => {
  const { licenseNote } = await import('../../../src/crystal/modelLicense.js')
  assert.match(licenseNote('yes', 'apache-2.0'), /listable/i)
  assert.match(licenseNote('conditional', 'krea-community'), /threshold/i)
  assert.match(licenseNote('no', 'flux-1-dev-nc'), /Private use only/i)
  assert.match(licenseNote('unknown'), /unverified/i)
})

test('origin license signals: civitai commercial flags + HF license id + most-restrictive fold', () => {
  assert.equal(civitaiCommercial({ allowCommercialUse: ['Image', 'Sell'] }), 'yes')
  assert.equal(civitaiCommercial({ allowCommercialUse: ['None'] }), 'no')
  assert.equal(civitaiCommercial({ allowCommercialUse: false }), 'no')
  assert.equal(civitaiCommercial({}), 'unknown')
  assert.equal(hfLicenseToId('apache-2.0'), 'apache-2.0')
  assert.equal(hfLicenseToId('creativeml-openrail-m'), 'openrail-m')
  assert.equal(hfLicenseToId('cc-by-nc-4.0'), 'cc-by-nc')
  // a permissive base + a non-commercial artifact license → the artifact restriction wins
  assert.equal(combineCommercial('yes', 'no'), 'no')
  assert.equal(combineCommercial('yes', 'unknown'), 'unknown')
})

test('import resolve: license/commercialUse fold onto the resolved plan (Civitai)', async () => {
  // schnell base + civitai "Sell" allowed → commercially clear
  const schnell = { ...CIVITAI_LORA, allowCommercialUse: ['Image', 'Sell'], modelVersions: [{ id: 1, baseModel: 'FLUX.1-schnell', files: [{ name: 'a.safetensors', downloadUrl: 'https://civitai.com/api/download/models/1' }] }] }
  assert.equal((await resolveImport('https://civitai.com/models/1', { json: jsonOf(schnell) })).commercialUse, 'yes')
  // dev base → non-commercial, regardless of the uploader's flags
  const dev = { ...CIVITAI_LORA, allowCommercialUse: ['Sell'], modelVersions: [{ id: 1, baseModel: 'FLUX.1-dev', files: [{ name: 'a.safetensors', downloadUrl: 'https://civitai.com/api/download/models/1' }] }] }
  assert.equal((await resolveImport('https://civitai.com/models/1', { json: jsonOf(dev) })).commercialUse, 'no')
  // schnell base but uploader forbids commercial → the restriction wins
  const forbidden = { ...CIVITAI_LORA, allowCommercialUse: ['None'], modelVersions: [{ id: 1, baseModel: 'FLUX.1-schnell', files: [{ name: 'a.safetensors', downloadUrl: 'https://civitai.com/api/download/models/1' }] }] }
  assert.equal((await resolveImport('https://civitai.com/models/1', { json: jsonOf(forbidden) })).commercialUse, 'no')
})

// ── Resolver: gated origins → typed SecretRequiredError ────────────────────────

test('resolve: a gated origin (401/403) → typed SecretRequiredError carrying the provider', async () => {
  // A metadata fetch that 401s (private/gated Civitai model, no BYO token attached).
  const gated401: JsonFetcher = { async fetchJson(url) { throw new ModelImportError(`fetch failed: ${url} → 401`, 401) } }
  await assert.rejects(
    () => resolveImport('https://civitai.com/models/92654', { json: gated401 }),
    (e: unknown) => e instanceof SecretRequiredError && e.provider === 'civitai' && e.status === 401,
  )
  // HF host + 403 maps to the huggingface provider.
  const gated403: JsonFetcher = { async fetchJson(url) { throw new ModelImportError(`fetch failed: ${url} → 403`, 403) } }
  await assert.rejects(
    () => resolveImport('https://huggingface.co/someuser/my-flux-lora', { json: gated403 }),
    (e: unknown) => e instanceof SecretRequiredError && e.provider === 'huggingface',
  )
  // A non-auth failure (500) is NOT translated — stays a generic ModelImportError.
  const err500: JsonFetcher = { async fetchJson(url) { throw new ModelImportError(`fetch failed: ${url} → 500`, 500) } }
  await assert.rejects(
    () => resolveImport('https://civitai.com/models/92654', { json: err500 }),
    (e: unknown) => e instanceof ModelImportError && !(e instanceof SecretRequiredError),
  )
})

// ── Resolver: Civitai ─────────────────────────────────────────────────────────

test('civitai: resolves genus/familia/trigger/dest + origin source with meta', async () => {
  const r = await resolveImport('https://civitai.com/models/92654/armored-dress', { json: jsonOf(CIVITAI_LORA) })
  assert.equal(r.genus, 'lora')
  assert.equal(r.familia, 'sd15')
  assert.equal(r.nomen, 'Armored Dress')
  assert.equal(r.trigger, 'gothic armor,armored_dress')
  assert.equal(r.slug, 'armored-dress-v02')
  assert.equal(r.dest, 'loras/armored-dress-v02.safetensors')
  assert.equal(r.downloadUrl, 'https://civitai.com/api/download/models/1165788')
  assert.equal(r.filename, 'armored_dress_V02.safetensors')
  assert.equal(r.description, 'trigger with armored_dress')      // HTML stripped
  assert.deepEqual(r.samples, [{ url: 'https://civitai.com/preview/1.png' }])
  assert.equal(r.sizeBytes, 13500 * 1024)
  assert.equal(r.origin.provenance, 'civitai')
  assert.deepEqual(r.origin.meta, { modelId: '92654', modelVersionId: '1165788', author: 'someartist' })
  assert.equal(r.baseModel, 'SD 1.5')   // the same string familia/license were classified from
})

test('civitai: ?modelVersionId selects that version', async () => {
  const r = await resolveImport('https://civitai.com/models/92654?modelVersionId=999', { json: jsonOf(CIVITAI_LORA) })
  assert.equal(r.filename, 'old.safetensors')
  assert.equal(r.origin.meta?.modelVersionId, '999')
})

test('civitai: unsupported base model (no base flow) is rejected', async () => {
  const payload = { ...CIVITAI_LORA, modelVersions: [{ id: 1, baseModel: 'Stable Cascade', files: [{ name: 'x.safetensors', downloadUrl: 'https://civitai.com/api/download/models/1' }] }] }
  await assert.rejects(() => resolveImport('https://civitai.com/models/92654', { json: jsonOf(payload) }), ModelImportError)
})

// ── Resolver: HuggingFace ─────────────────────────────────────────────────────

test('huggingface: base_model → lora genus/familia, resolve download URL + preview', async () => {
  const r = await resolveImport('https://huggingface.co/someuser/my-flux-lora/tree/main', { json: jsonOf(HF_LORA) })
  assert.equal(r.genus, 'lora')
  assert.equal(r.familia, 'flux')
  assert.equal(r.nomen, 'My Flux LoRA')
  assert.equal(r.trigger, 'mytoken')
  assert.equal(r.downloadUrl, 'https://huggingface.co/someuser/my-flux-lora/resolve/main/my_flux_lora.safetensors')
  assert.deepEqual(r.samples, [{ url: 'https://huggingface.co/someuser/my-flux-lora/resolve/main/preview.png' }])
  assert.equal(r.origin.provenance, 'huggingface')
  assert.deepEqual(r.provenance, { repo: 'someuser/my-flux-lora', base: 'black-forest-labs/FLUX.1-dev' })
  assert.equal(r.baseModel, 'black-forest-labs/FLUX.1-dev')   // the same string familia/license were classified from
})

test('huggingface: a multi-file diffusers repo (weights only in subfolders) is rejected, not grabbed', async () => {
  const diffusers = {
    modelId: 'org/flux-full', tags: ['diffusers'], cardData: {},
    siblings: [{ rfilename: 'model_index.json' }, { rfilename: 'unet/diffusion_pytorch_model.safetensors' }, { rfilename: 'text_encoder/model.safetensors' }],
  }
  await assert.rejects(
    () => resolveImport('https://huggingface.co/org/flux-full', { json: jsonOf(diffusers) }),
    /multi-file diffusers/,
  )
})

// ── Resolver: direct file + host policy ───────────────────────────────────────

test('direct file: infers familia from filename', async () => {
  const r = await resolveImport('https://example.com/weights/my-sdxl-style.safetensors', { json: jsonOf({}) })
  assert.equal(r.genus, 'lora')
  assert.equal(r.familia, 'sdxl')
  assert.equal(r.filename, 'my-sdxl-style.safetensors')
  assert.equal(r.origin.provenance, 'custom')
  assert.equal(r.baseModel, 'my-sdxl-style')   // the parsed filename stem — the only descriptor a direct file has
})

test('direct file: genus hint honored; unknown family rejected', async () => {
  const r = await resolveImport('https://example.com/flux-checkpoint.safetensors', { json: jsonOf({}) }, { genus: 'model' })
  assert.equal(r.genus, 'model')
  assert.equal(r.dest, 'checkpoints/flux-checkpoint.safetensors')
  await assert.rejects(() => resolveImport('https://example.com/mystery.safetensors', { json: jsonOf({}) }), ModelImportError)
})

test('host policy: r2.dev download host is rejected', async () => {
  const payload = { ...CIVITAI_LORA, modelVersions: [{ id: 1, baseModel: 'SD 1.5', files: [{ name: 'x.safetensors', downloadUrl: 'https://abc.r2.dev/x.safetensors' }] }] }
  await assert.rejects(() => resolveImport('https://civitai.com/models/92654', { json: jsonOf(payload) }), /not permitted/)
})

test('unsupported URL is rejected', async () => {
  await assert.rejects(() => resolveImport('https://example.com/some-page', { json: jsonOf({}) }), ModelImportError)
})

// ── Importer: private Intella, dedup, preview re-host ─────────────────────────

function harness(opts: { gate?: ModerationGate; store?: boolean; payload?: unknown } = {}) {
  const gate = opts.gate ?? { async scan() { return { ok: true } } }
  const upserts: Intella[] = []
  const puts: Array<{ key: string; bytes: Buffer }> = []
  // Records survive between imports so a re-import sees what the previous one wrote — the shape
  // the store has in production (a full replace on the deterministic id, readable by `find`).
  const records = new Map<string, Intella>()
  const intellae = {
    async upsert(i: Intella) { upserts.push(i); records.set(i.id, i) },
    async find(id: string) { return records.get(id) ?? null },
  }
  const deps: ConstructorParameters<typeof ModelImporter>[0] = { json: jsonOf(opts.payload ?? CIVITAI_LORA), intellae, moderationGate: gate, now: () => new Date(0) }
  if (opts.store) {
    deps.fetcher = { async fetch() { return Buffer.from('IMG') } }
    deps.store = { async put(key, bytes) { puts.push({ key, bytes }); return `https://models.miladystation2.net/${key}` } }
  }
  return { upserts, puts, records, importer: new ModelImporter(deps) }
}

test('import: registers a private, owner-scoped, ORIGIN-ONLY Intella (no R2 weight copy)', async () => {
  const h = harness()
  const intella = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })

  // private, owner-scoped, off the public catalogue; id is deterministic (dedup key)
  assert.match(intella.id, /^import-[0-9a-f]{24}$/)
  assert.equal(intella.access, 'private')
  assert.equal(intella.canonica, false)
  assert.equal(intella.ownerAnimaId, 'anima-9')
  assert.equal(intella.auctor, 'anima-9')
  assert.equal(intella.familia, 'sd15')
  assert.equal(intella.trigger, 'gothic armor,armored_dress')
  assert.equal(intella.dest, 'loras/armored-dress-v02.safetensors')
  // §3: every genus gets one classifier-usable field — populated consistently with familia/license.
  assert.equal(intella.baseModel, 'SD 1.5')

  // WEIGHT sources = origin ONLY. No miladystation mirror at import — the pod downloads from the
  // origin; a public promotion prepends the our-bucket source later.
  assert.equal(intella.sources.length, 1)
  assert.equal(intella.sources[0].provenance, 'civitai')
  assert.equal(intella.sources[0].uri, 'https://civitai.com/api/download/models/1165788')
  assert.equal(intella.sizeGb, (13500 * 1024) / 1e9)   // from Civitai metadata, no download
})

test('import: idempotent — re-importing the same URL yields the same id (dedup, no duplicate)', async () => {
  const h = harness()
  const a = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  const b = await h.importer.import({ url: 'https://civitai.com/models/92654/renamed-slug', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(a.id, b.id)                                        // same (owner, origin) → same record
  // a DIFFERENT owner importing the same model gets a distinct private record
  const c = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'anima:anima-other', ownerAnimaId: 'anima-other' })
  assert.notEqual(a.id, c.id)
})

test('import: preview media is scanned on the ORIGIN url, then re-hosted into our bucket', async () => {
  const h = harness({ store: true })
  const intella = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  // re-hosted: the sample now points at OUR bucket, not civitai
  assert.equal(h.puts.length, 1)
  assert.match(h.puts[0].key, /^model-previews\/import-[0-9a-f]{24}\/000\.png$/)
  assert.equal(intella.samples?.[0].url, `https://models.miladystation2.net/${h.puts[0].key}`)
})

test('import: WEIGHTS are never re-hosted (only the preview is)', async () => {
  const h = harness({ store: true })
  await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  // exactly one put — the preview. The weight source stays the civitai origin.
  assert.equal(h.puts.length, 1)
  assert.ok(h.puts[0].key.startsWith('model-previews/'))
})

test('import: preview scan refusal keeps origin previews, still imports (no re-host)', async () => {
  const h = harness({ gate: { async scan() { return { ok: false, reason: 'no scanner configured' } } }, store: true })
  const intella = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(h.puts.length, 0)     // LOAD-BEARING: unscanned bytes never reach our bucket
  assert.equal(h.upserts.length, 1)  // the import lands — a private import is not a moderation boundary
  assert.equal(intella.samples?.[0]?.url, 'https://civitai.com/preview/1.png')  // origin url, not re-hosted
})

test('import: requires an owner', async () => {
  const h = harness()
  await assert.rejects(() => h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: '' }), ModelImportError)
})

test('import: a Bursa purse (no animaId) can own an import — ownerKey set, ownerAnimaId absent', async () => {
  const h = harness()
  const intella = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'bursa:deadbeef' })
  assert.equal(intella.ownerKey, 'bursa:deadbeef')
  assert.equal(intella.ownerAnimaId, undefined)
  assert.equal(intella.auctor, 'bursa:deadbeef')
  assert.equal(intella.access, 'private')
  // A purse import dedups on ownerKey (no animaId to key on).
  const again = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'bursa:deadbeef' })
  assert.equal(intella.id, again.id)
  // A different purse → distinct record.
  const other = await h.importer.import({ url: 'https://civitai.com/models/92654', ownerKey: 'bursa:cafe' })
  assert.notEqual(intella.id, other.id)
})

// ── Content rating: derived from the origin's own flag ────────────────────────

test('deriveImportContentRating: the origin boolean is the whole table (both boolean and string form)', () => {
  assert.equal(deriveImportContentRating({ originNsfw: true }), 'explicit')
  assert.equal(deriveImportContentRating({ originNsfw: 'true' }), 'explicit')
  assert.equal(deriveImportContentRating({ originNsfw: false }), 'sfw')
  assert.equal(deriveImportContentRating({ originNsfw: 'false' }), 'sfw')
})

test('deriveImportContentRating: no signal → untriaged (absent key, absent meta, and wrong types)', () => {
  assert.equal(deriveImportContentRating(undefined), 'untriaged')
  assert.equal(deriveImportContentRating({}), 'untriaged')
  assert.equal(deriveImportContentRating({ modelId: '92654', author: 'someartist' }), 'untriaged')
  // Wrong types must fall through, never throw — origin.meta is loosely typed.
  for (const value of [1, 0, null, 'yes', 'TRUE', {}, [], NaN]) {
    assert.equal(deriveImportContentRating({ originNsfw: value }), 'untriaged', `value: ${String(value)}`)
  }
})

test('deriveImportContentRating: the numeric level is never consulted — a high level with a false flag stays sfw', () => {
  // The level aggregates a model's community gallery, so mainstream checkpoints read high while
  // the origin's own flag says safe. Reading the level would hide them from the catalog.
  assert.equal(deriveImportContentRating({ originNsfw: false, originNsfwLevel: 31 }), 'sfw')
  assert.equal(deriveImportContentRating({ originNsfwLevel: 31 }), 'untriaged')
  assert.equal(deriveImportContentRating({ originNsfw: true, originNsfwLevel: 0 }), 'explicit')
})

test('import: an origin-flagged adult model lands rated, and the raw signal survives the mapping', async () => {
  const h = harness({ payload: CIVITAI_NSFW_LORA })
  const intella = await h.importer.import({ url: 'https://civitai.com/models/92655', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })

  assert.equal(intella.contentRating, 'explicit')
  // The capture contract is untouched: the origin's fields stay raw and unmapped on the source.
  assert.equal(intella.sources[0].meta?.originNsfw, true)
  assert.equal(intella.sources[0].meta?.originNsfwLevel, 28)
})

test('import: an origin-flagged safe model lands sfw even with a high numeric level', async () => {
  const h = harness({ payload: CIVITAI_SFW_LORA })
  const intella = await h.importer.import({ url: 'https://civitai.com/models/92656', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(intella.contentRating, 'sfw')
})

test('import: an origin with no nsfw signal at all stays untriaged', async () => {
  const h = harness({ payload: HF_LORA })
  const intella = await h.importer.import({ url: 'https://huggingface.co/someuser/my-flux-lora', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(intella.contentRating, 'untriaged')
  assert.equal(intella.sources[0].meta?.originNsfw, undefined)
})

test('import: the derivation is a DEFAULT — a re-import never overwrites a decided rating', async () => {
  const h = harness({ payload: CIVITAI_NSFW_LORA })
  const url = 'https://civitai.com/models/92655'
  const first = await h.importer.import({ url, ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(first.contentRating, 'explicit')

  // A human decides otherwise on the record (the triage outcome the derivation must not undo).
  h.records.set(first.id, { ...h.records.get(first.id)!, contentRating: 'sfw' })
  const again = await h.importer.import({ url, ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(again.id, first.id)               // full replace on the same deterministic id…
  assert.equal(again.contentRating, 'sfw')       // …but the decided rating is carried over

  // An 'untriaged' record is NOT a decision — a re-import re-derives it.
  h.records.set(first.id, { ...h.records.get(first.id)!, contentRating: 'untriaged' })
  const third = await h.importer.import({ url, ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(third.contentRating, 'explicit')
})

test('import: a writer with no read seam still derives (no read → no carry-over, never a throw)', async () => {
  const importer = new ModelImporter({
    json: jsonOf(CIVITAI_NSFW_LORA),
    intellae: { async upsert() {} },
    moderationGate: { async scan() { return { ok: true } } },
  })
  const intella = await importer.import({ url: 'https://civitai.com/models/92655', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(intella.contentRating, 'explicit')
})

test('import: a failing read does not sink the import — the rating falls back to the derived value', async () => {
  const importer = new ModelImporter({
    json: jsonOf(CIVITAI_NSFW_LORA),
    intellae: { async upsert() {}, async find() { throw new Error('store unavailable') } },
    moderationGate: { async scan() { return { ok: true } } },
  })
  const intella = await importer.import({ url: 'https://civitai.com/models/92655', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9' })
  assert.equal(intella.contentRating, 'explicit')
})

// ── CrystalApi facade: import auth/delegation + owner-scoped listing ──────────

test('CrystalApi.importModel: identified AND anon (Bursa) callers → ModelCard; refusal → 400', async () => {
  const { CrystalApi } = await import('../../../src/allocutio/api/CrystalApi.js')
  const h = harness()
  const api = new CrystalApi({ modelImporter: h.importer } as unknown as import('../../../src/allocutio/api/CrystalApi.js').CrystalApiDeps)

  const card = await api.importModel({ animaId: 'anima-9' } as never, { url: 'https://civitai.com/models/92654' })
  assert.match(card.intellaId, /^import-/)
  assert.equal(card.genus, 'lora')
  assert.equal(card.basis, 'sd15')
  assert.equal(card.trigger, 'gothic armor,armored_dress')

  // anonymous callers own their imports too (imports must be Bursa-possible).
  const purseCard = await api.importModel({ bursaToken: 'purse-1' } as never, { url: 'https://civitai.com/models/92654' })
  assert.match(purseCard.intellaId, /^import-/)
  // a commitment caller likewise succeeds (no 403).
  const anonCard = await api.importModel({ commitment: '0xabc' } as never, { url: 'https://civitai.com/models/92654' })
  assert.match(anonCard.intellaId, /^import-/)

  // a resolver/import refusal surfaces as a 400 input.malformed (not a raw ModelImportError)
  const denied = new CrystalApi({
    modelImporter: new ModelImporter({
      // A non-401 resolver refusal — 401 would route to the `secret.required` 422 branch below.
      json: { async fetchJson(url: string) { throw new ModelImportError(`fetch failed: ${url} → 500`, 500) } },
      intellae: { async upsert() {} },
      moderationGate: { async scan() { return { ok: true } } },
    }),
  } as unknown as import('../../../src/allocutio/api/CrystalApi.js').CrystalApiDeps)
  await assert.rejects(
    () => denied.importModel({ animaId: 'a' } as never, { url: 'https://civitai.com/models/92654' }),
    (e: unknown) => (e as { code?: string }).code === 'input.malformed',
  )

  // a gated origin with no connected secret → typed `secret.required` (422) carrying the provider,
  // NOT a generic input.malformed — the frontend deep-links to Profile → Connected accounts (F2).
  const gated = new CrystalApi({
    modelImporter: new ModelImporter({
      json: { async fetchJson(url: string) { throw new ModelImportError(`fetch failed: ${url} → 401`, 401) } },
      intellae: { async upsert() {} },
      moderationGate: { async scan() { return { ok: true } } },
    }),
  } as unknown as import('../../../src/allocutio/api/CrystalApi.js').CrystalApiDeps)
  await assert.rejects(
    () => gated.importModel({ animaId: 'a' } as never, { url: 'https://civitai.com/models/92654' }),
    (e: unknown) => {
      const err = e as { code?: string; httpStatus?: number; opts?: { details?: { provider?: string } } }
      return err.code === 'secret.required' && err.httpStatus === 422 && err.opts?.details?.provider === 'civitai'
    },
  )
})

test('CrystalApi.listMyModels: owner-scoped by ownerKey (anima AND Bursa); uses listByOwner', async () => {
  const { CrystalApi } = await import('../../../src/allocutio/api/CrystalApi.js')
  const anima: Intella[] = [
    { id: 'import-abc', nomen: 'My Import', genus: 'lora', architectura: 'lora', parametri: 0, sources: [], dest: 'loras/x.safetensors', sizeGb: 0, versio: '1', canonica: false, access: 'private', ownerKey: 'anima:anima-9', ownerAnimaId: 'anima-9', familia: 'flux', trigger: 'mytok', natum: new Date(0) } as unknown as Intella,
  ]
  const purse: Intella[] = [
    { id: 'import-xyz', nomen: 'Purse Import', genus: 'lora', architectura: 'lora', parametri: 0, sources: [], dest: 'loras/p.safetensors', sizeGb: 0, versio: '1', canonica: false, access: 'private', ownerKey: 'bursa:2f2ce3c0', familia: 'flux', trigger: 'ptok', natum: new Date(0) } as unknown as Intella,
  ]
  // Fake keys on the generic ownerKey now (not a bare animaId).
  const intellarum = { async listByOwner(ownerKey: string) { return ownerKey === 'anima:anima-9' ? anima : ownerKey.startsWith('bursa:') ? purse : [] } }
  const api = new CrystalApi({ intellarum } as unknown as import('../../../src/allocutio/api/CrystalApi.js').CrystalApiDeps)

  const cards = await api.listMyModels({ animaId: 'anima-9' } as never)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].intellaId, 'import-abc')
  assert.equal(cards[0].basis, 'flux')       // familia → basis
  assert.equal(cards[0].access, 'private')

  // a Bursa purse sees ITS OWN imports (no longer forced empty).
  const purseCards = await api.listMyModels({ bursaToken: 'purse-1' } as never)
  assert.equal(purseCards.length, 1)
  assert.equal(purseCards[0].intellaId, 'import-xyz')
})
