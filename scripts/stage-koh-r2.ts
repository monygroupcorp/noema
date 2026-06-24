// =============================================================================
// stage-koh-r2 — one-off: push the local koh dataset to R2 + emit a manifest
// =============================================================================
//
// The remote training pod pulls its dataset from R2 by URL (see the manifest
// resolver, src/crystal/datasetManifest.ts). In production a user's images
// already live in R2 (the upload path); koh is a LOCAL spike dir, so this stager
// stands in for that: it uploads each image to an R2 `datasets/` prefix, reads
// the sibling `.txt` caption, and writes a `[{url,caption?}]` manifest the remote
// launcher can hand straight to the pod (proving the prod pull-path end to end).
//
// Run (uses .env R2 creds; nothing GPU, nothing DB):
//   node --env-file=.env --import tsx scripts/stage-koh-r2.ts
//
// Output: scripts/.koh-manifest.json (also printed to stdout).
// =============================================================================

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { R2Uploader } from '../src/crystal/R2Uploader.js'
import { corpusToManifest } from '../src/crystal/datasetManifest.js'
import type { Exemplar } from '../src/types/corpus.js'

const DATASET = '/mnt/data/datasets/koh'
const PREFIX = 'datasets/spike-koh'          // R2 key prefix for this staged dataset
const OUT = 'scripts/.koh-manifest.json'

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
}

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`missing env ${name} (run with --env-file=.env)`)
  return v
}

async function main(): Promise<void> {
  const store = new R2Uploader({
    endpoint: `https://${req('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    accessKeyId: req('R2_ACCESS_KEY_ID'),
    secretAccessKey: req('R2_SECRET_ACCESS_KEY'),
    bucket: req('R2_BUCKET_NAME'),
    publicUrl: req('R2_PUBLIC_URL'),         // the pod fetches by this public URL — required
  })

  const images = readdirSync(DATASET).filter(f => extname(f).toLowerCase() in MIME).sort()
  if (images.length === 0) throw new Error(`no images under ${DATASET}`)
  console.log(`[stage] ${images.length} images → ${PREFIX}/`)

  // Upload each image + collect it as a Corpus exemplar (ref = the R2 URL, titulus = its caption).
  // Reusing corpusToManifest keeps the staged manifest IDENTICAL in shape to the production path.
  const exemplaria: Exemplar[] = []
  for (const file of images) {
    const ext = extname(file).toLowerCase()
    const bytes = readFileSync(join(DATASET, file))
    const url = await store.put(`${PREFIX}/${file}`, bytes, MIME[ext])
    let titulus: string | undefined
    try { titulus = readFileSync(join(DATASET, `${basename(file, ext)}.txt`), 'utf8').trim() || undefined }
    catch { titulus = undefined }
    exemplaria.push(titulus ? { ref: url, genus: MIME[ext], titulus } : { ref: url, genus: MIME[ext] })
    console.log(`[stage]   ${file} → ${url}${titulus ? ' (+caption)' : ''}`)
  }

  const manifest = corpusToManifest({
    id: 'spike-koh', nomen: 'koh', genus: 'paria', auctor: 'spike-anima',
    exemplaria, numerus: exemplaria.length, status: 'validatus', natum: new Date(0), mutatum: new Date(0),
  })
  writeFileSync(OUT, JSON.stringify(manifest, null, 2))
  console.log(`\n[stage] wrote ${manifest.length}-item manifest → ${OUT}`)
  console.log(JSON.stringify(manifest))
}

main().then(() => process.exit(0)).catch((err) => { console.error('[stage] FAILED:', err); process.exit(1) })
