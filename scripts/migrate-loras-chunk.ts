#!/usr/bin/env -S npx tsx
// =============================================================================
// migrate-loras-chunk.ts — N-most-recently-used LoRA chunk → crystal Intellae
// =============================================================================
//
// Reads the legacy `loraModels` collection sorted by `lastUsedAt` desc (fallback
// `updatedAt`, then `createdAt`), takes the top N (default 25), transforms each
// via legacyToIntella, and either:
//
//   - Default (dry-run): prints a per-record summary + warning log; no writes
//   - `--commit`: upserts into the crystal `intellae` collection in the
//     `noema_fake` database (idempotent on id)
//
// Usage:
//
//     npx tsx scripts/migrate-loras-chunk.ts            # dry-run, 25 records
//     npx tsx scripts/migrate-loras-chunk.ts --n 10     # smaller chunk
//     npx tsx scripts/migrate-loras-chunk.ts --commit   # writes to noema_fake
//
// Source DB:    LEGACY_MONGODB_URI / LEGACY_DB_NAME (env, REQUIRED)
//                                    LEGACY_LORAS_COLLECTION (default 'loraModels')
// Target DB:    MONGODB_URI         / DB_NAME            (env, REQUIRED for --commit)
//                                    TARGET_INTELLAE_COLLECTION (default 'intellae')

import { MongoClient, type Collection, type Document } from 'mongodb'
import {
  legacyToIntella,
  type LegacyLoraDoc,
  type MigrationLookups,
  type IntellaV2,
  type MigrationLogEntry,
} from '../src/migrations/loras/legacyToIntella.js'

// ─ Lookups (would be its own file once stable) ─────────────────────────────

const CHECKPOINT_TO_BASE_INTELLA_ID: Record<string, string> = {
  'FLUX':         'intella.flux-base',
  'SDXL':         'intella.sdxl-base',
  'SD1.5':        'intella.sd15-base',
  'KONTEXT':      'intella.kontext-base',
  'ILLUSTRIOUS':  'intella.illustrious-base',
}

const PLATFORM_ANIMA_IDS = new Set<string>(
  (process.env.PLATFORM_ANIMA_IDS ?? process.env.PLATFORM_ANIMA_ID ?? 'platform')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
)

// ─ Args ───────────────────────────────────────────────────────────────────

interface Args { n: number; commit: boolean }

function parseArgs(): Args {
  const a: Args = { n: 25, commit: false }
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--n' && i + 1 < args.length) {
      a.n = parseInt(args[++i], 10)
      if (isNaN(a.n) || a.n <= 0) throw new Error(`invalid --n: ${args[i]}`)
    } else if (arg === '--commit') {
      a.commit = true
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: migrate-loras-chunk.ts [--n N] [--commit]')
      process.exit(0)
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return a
}

// ─ Pretty-print one transformed record for dry-run inspection ─────────────

function summarizeIntella(i: IntellaV2): string {
  const lora = i.genus === 'lora' ? i.params : null
  const accessKind = i.access.kind
  return [
    `  id=${i.id}`,
    `  nomen=${i.nomen}`,
    lora ? `  slug=${lora.slug}  triggers=[${lora.triggerWords.slice(0, 3).join(', ')}${lora.triggerWords.length > 3 ? ', …' : ''}]` : '',
    lora ? `  base=${lora.baseIntellaId}` : '',
    `  access=${accessKind}${i.access.kind === 'private' ? ` (sharedWith=${(i.access as { sharedWith?: string[] }).sharedWith?.length ?? 0})` : ''}`,
    `  authors=[${i.authorAnimaIds.join(', ') || '—authorless—'}]  owner=${i.ownerAnimaId ?? '(none)'}  importer=${i.importerAnimaId ?? '(none)'}`,
    `  canonica=${i.canonica}  transferable=${i.transferable}  contentRating=${i.contentRating}  blocked=${i.blocked}`,
    i.importedFrom ? `  importedFrom={source: ${i.importedFrom.source}${i.importedFrom.originalAuthor ? `, author: ${i.importedFrom.originalAuthor}` : ''}}` : '',
    i.legacyMonetization ? `  legacyMonetization=<preserved>` : '',
  ].filter(Boolean).join('\n')
}

// ─ Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs()

  const SOURCE_URI = process.env.LEGACY_MONGODB_URI
  const SOURCE_DB  = process.env.LEGACY_DB_NAME
  if (!SOURCE_URI || !SOURCE_DB) {
    console.error('LEGACY_MONGODB_URI and LEGACY_DB_NAME are required')
    process.exit(1)
  }
  const SOURCE_COLL = process.env.LEGACY_LORAS_COLLECTION ?? 'loraModels'

  const TARGET_URI = process.env.MONGODB_URI
  const TARGET_DB  = process.env.DB_NAME ?? 'noema_fake'
  const TARGET_COLL = process.env.TARGET_INTELLAE_COLLECTION ?? 'intellae'

  if (args.commit && (!TARGET_URI || !TARGET_DB)) {
    console.error('--commit requires MONGODB_URI and DB_NAME')
    process.exit(1)
  }

  const mode = args.commit ? 'COMMIT' : 'DRY-RUN'
  console.log(`[migrate-loras-chunk] ${mode}  N=${args.n}`)
  console.log(`  source:  ${SOURCE_URI.replace(/\/\/.*@/, '//<redacted>@')}  db=${SOURCE_DB}  coll=${SOURCE_COLL}`)
  console.log(`  target:  ${TARGET_URI?.replace(/\/\/.*@/, '//<redacted>@') ?? '(none — dry-run)'}  db=${TARGET_DB}  coll=${TARGET_COLL}`)
  console.log('')

  const sourceClient = new MongoClient(SOURCE_URI)
  let targetClient: MongoClient | null = null
  try {
    await sourceClient.connect()
    const sourceColl: Collection<LegacyLoraDoc> = sourceClient.db(SOURCE_DB).collection(SOURCE_COLL)

    // Sort: lastUsedAt desc, fallback updatedAt desc, fallback createdAt desc.
    // Mongo $sort with multiple keys + missing-fields lands the "null is least"
    // ordering which we want here (records with lastUsedAt come first).
    const cursor = sourceColl
      .find({})
      .sort({ lastUsedAt: -1, updatedAt: -1, createdAt: -1 })
      .limit(args.n)

    const legacyDocs = await cursor.toArray()
    if (legacyDocs.length === 0) {
      console.log('(no legacy LoRAs found)')
      return
    }
    console.log(`[migrate-loras-chunk] fetched ${legacyDocs.length} legacy records\n`)

    const lookups: MigrationLookups = {
      checkpointToBaseIntellaId: CHECKPOINT_TO_BASE_INTELLA_ID,
      platformAnimaIds: PLATFORM_ANIMA_IDS,
    }

    const transformed: Array<{ intella: IntellaV2; log: MigrationLogEntry }> = []
    for (const doc of legacyDocs) {
      transformed.push(legacyToIntella(doc as LegacyLoraDoc, lookups))
    }

    // ─ Print each ─────────────────────────────────────────────────────
    for (const { intella, log } of transformed) {
      console.log(`── ${intella.nomen} ─────────────`)
      console.log(summarizeIntella(intella))
      if (log.warnings.length > 0) {
        console.log(`  warnings:`)
        for (const w of log.warnings) console.log(`    • ${w}`)
      }
      if (log.drops.length > 0) {
        console.log(`  dropped: ${log.drops.join(', ')}`)
      }
      console.log('')
    }

    // ─ Aggregate stats ────────────────────────────────────────────────
    const stats = {
      total:           transformed.length,
      canonica:        transformed.filter(t => t.intella.canonica).length,
      authorless:      transformed.filter(t => t.intella.authorAnimaIds.length === 0).length,
      platformTrained: transformed.filter(t => t.intella.authorAnimaIds.length > 0).length,
      withImporter:    transformed.filter(t => t.intella.importerAnimaId).length,
      privateAccess:   transformed.filter(t => t.intella.access.kind === 'private').length,
      unlistedAccess:  transformed.filter(t => t.intella.access.kind === 'unlisted').length,
      publicAccess:    transformed.filter(t => t.intella.access.kind === 'public').length,
      withMonetization: transformed.filter(t => t.intella.legacyMonetization).length,
      noSourceUri:     transformed.filter(t => t.intella.sources.length === 0).length,
      withWarnings:    transformed.filter(t => t.log.warnings.length > 0).length,
    }
    console.log('── aggregate ─────────────')
    for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`)
    console.log('')

    // ─ Commit ─────────────────────────────────────────────────────────
    if (args.commit) {
      targetClient = new MongoClient(TARGET_URI!)
      await targetClient.connect()
      const targetColl: Collection<Document> = targetClient.db(TARGET_DB).collection(TARGET_COLL)

      let upserted = 0
      for (const { intella } of transformed) {
        await targetColl.replaceOne(
          { id: intella.id },
          intella as unknown as Document,
          { upsert: true },
        )
        upserted++
      }
      console.log(`[migrate-loras-chunk] upserted ${upserted} → ${TARGET_DB}.${TARGET_COLL}`)
    } else {
      console.log('[migrate-loras-chunk] dry-run complete. Pass --commit to write.')
    }
  } finally {
    await sourceClient.close().catch(() => {})
    if (targetClient) await targetClient.close().catch(() => {})
  }
}

main().catch(err => {
  console.error('[migrate-loras-chunk] failed:', err)
  process.exit(1)
})
