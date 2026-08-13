#!/usr/bin/env -S npx tsx
// =============================================================================
// Publish the Klein-collection LoRAs into the public catalog.
// =============================================================================
//
// A named HuggingFace collection holds a set of Klein-base LoRA models. Every
// one of them already exists in the catalog as a private, non-canonical
// record — this script creates NO new records, it flips visibility on
// existing ones.
//
// `publicCatalog()` (`src/crystal/MongoIntella.ts`) admits a record on
// `access:'public'` (v1) OR `access.kind:'public'` (v2) OR `canonica:true`.
// This script sets BOTH `canonica:true` and a shape-correct public `access` —
// matching how other platform-published LoRAs already look — so no reader of
// either flag alone can miss them.
//
//     A RECORD'S ACCESS SHAPE IS NEVER GUESSED — IT IS READ FROM THE RECORD'S
//     OWN SCHEMA VERSION, THE SAME v1/v2 SPLIT `MongoIntella.ts` USES EVERYWHERE.
//
// Matching: each collection name is matched against `{ genus: 'lora' }`
// records on `nomen` exact, else `dest` or any `sources[].uri` CONTAINING the
// name — with `-` and `_` treated as equivalent, since the upload host uses
// `_` and HuggingFace uses `-` for the same slug. A name matching nothing is
// reported and skipped, never guessed at. A name matching more than one
// record is reported and EVERY matching record is repaired — this script does
// not deduplicate; see the scope note below.
//
// Scope notes:
//   * This script creates no records and imports nothing. If a name matches
//     zero records, it is reported as not-found; it is never fetched from
//     HuggingFace or otherwise materialised.
//   * Some names in the collection already have more than one catalog record
//     (the collection was built independently of catalog hygiene). Publishing
//     repairs every matching record's visibility rather than picking one —
//     deduplicating the catalog is a separate concern and out of scope here.
//
// Idempotent: a record already `canonica:true` with a public access value in
// its own shape is counted as already-done and left untouched.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live cluster). Dev/test work uses
// `noemaplane`; `noemaplane` IS the live app DB and is refused unless you also
// pass `--prod` (a deliberate, eyes-open production migration). `noema` is the
// pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_publish_klein_collection.ts --db noemaplane --prod --dry-run
//   --prod clears the live-db gate; --dry-run suppresses every write. BOTH are required to read prod.
// Run (WRITE, prod): …same, minus --dry-run…   (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[publish-klein-collection]'

/** The 22 collection names, hardcoded — a migration whose selection set depends on a live
 *  third-party API is not reproducible or reviewable. */
export const COLLECTION_NAMES: readonly string[] = [
  '13angel33flux-klein', '333flux-klein', 'aeonflux-klein', 'aespaflux-klein',
  'animalcrossingflux-klein', 'ansemflux-klein', 'cheeseworld1flux-klein', 'colvilleflux-klein',
  'cultkatflux2-klein', 'culttierflux-klein', 'dutchbaroqueflux-klein', 'impresstation-klein',
  'kaminosekkeiflux-klein', 'kemonokakiflux-klein', 'koichirouflux-klein', 'lainflux-klein',
  'minoteflux-klein', 'ohiseeflux-klein', 'pepeflux-klein', 'petravoiceflux2-klein',
  'poweredbypainflux-klein', 'radbroflux-klein',
]

interface SourceDoc { uri?: string }
interface AccessObj { kind?: string; [key: string]: unknown }
interface Doc {
  id?: unknown
  _id: unknown
  genus?: string
  nomen?: string
  dest?: string
  sources?: SourceDoc[]
  access?: AccessObj | string
  canonica?: boolean
  params?: { triggerWords?: string[] }
}

/** `-`/`_` are the same separator across the upload host and HuggingFace — normalize both to `-`. */
export function normalizeSlug(s: string): string {
  return s.toLowerCase().replace(/[-_]+/g, '-')
}

/** Exported for the transform test — same v1/v2 detection `MongoIntella.ts` uses everywhere. */
export function isV2(doc: Doc): boolean {
  return Array.isArray(doc.params?.triggerWords)
}

/** Does this record match this collection name? Exact `nomen`, else `dest`/`sources[].uri`
 *  containing the (normalized) name. */
export function matchesName(name: string, doc: Doc): boolean {
  const target = normalizeSlug(name)
  if (doc.nomen !== undefined && normalizeSlug(String(doc.nomen)) === target) return true
  if (doc.dest !== undefined && normalizeSlug(String(doc.dest)).includes(target)) return true
  for (const s of doc.sources ?? []) {
    if (s.uri !== undefined && normalizeSlug(s.uri).includes(target)) return true
  }
  return false
}

export interface FieldWrite { canonica: true; accessField: 'access' | 'access.kind'; accessValue: 'public' }

export type PublishDecision =
  | { kind: 'already-done' }
  | { kind: 'publish'; write: FieldWrite }

/** The pure decision core for one already-matched record: is it already public+canonica in its
 *  own shape, or does it need the write? No I/O — covered directly by the transform test. */
export function decidePublish(doc: Doc): PublishDecision {
  const v2 = isV2(doc)
  const alreadyPublic = v2
    ? typeof doc.access === 'object' && doc.access !== null && (doc.access as AccessObj).kind === 'public'
    : doc.access === 'public'
  if (alreadyPublic && doc.canonica === true) return { kind: 'already-done' }
  return {
    kind: 'publish',
    write: { canonica: true, accessField: v2 ? 'access.kind' : 'access', accessValue: 'public' },
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')
    const candidates = (await col.find({ genus: 'lora' }).toArray()) as unknown as Doc[]

    const notFound: string[] = []
    const matchedSingle: string[] = []
    const matchedMultiple: { name: string; count: number }[] = []
    let published = 0
    let alreadyDone = 0

    for (const name of COLLECTION_NAMES) {
      const matches = candidates.filter(d => matchesName(name, d))
      if (matches.length === 0) { notFound.push(name); continue }
      if (matches.length === 1) matchedSingle.push(name)
      else matchedMultiple.push({ name, count: matches.length })

      for (const doc of matches) {
        const decision = decidePublish(doc)
        if (decision.kind === 'already-done') { alreadyDone++; continue }
        published++
        console.log(`${TAG}   ${name} -> ${String(doc.id ?? doc._id)}: set canonica=true, ${decision.write.accessField}='public'${DRY_RUN ? ' [dry-run]' : ''}`)
        if (!DRY_RUN) {
          const set: Record<string, unknown> = { canonica: true }
          set[decision.write.accessField] = decision.write.accessValue
          await col.updateOne({ _id: doc._id }, { $set: set })
        }
      }
    }

    console.log(`${TAG} --- matched, single record (${matchedSingle.length})`)
    for (const n of matchedSingle) console.log(`${TAG}   ${n}`)
    console.log(`${TAG} --- matched, multiple records — every match repaired, catalog not deduplicated (${matchedMultiple.length})`)
    for (const m of matchedMultiple) console.log(`${TAG}   ${m.name}: ${m.count} records`)
    console.log(`${TAG} --- not found (${notFound.length})`)
    for (const n of notFound) console.log(`${TAG}   ${n}`)

    console.log(
      `${TAG} done — names=${COLLECTION_NAMES.length} not-found=${notFound.length} ` +
      `published=${published} already-done=${alreadyDone}${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Only run when executed directly — importing this module (the transform test does, for
// `decidePublish`/`matchesName`/`isV2`) must never open a db connection or touch argv/process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
