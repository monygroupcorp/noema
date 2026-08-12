#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill `Intella.samples` from the migration's orphaned `previewUris` field.
// =============================================================================
//
// `src/migrations/loras/legacyToIntella.ts` writes preview images to
// `previewUris`, but the app's first-class preview field is `samples` (see
// `src/types/intelligendi.ts`) — the model-detail card, the /make picker, and
// every other preview consumer reads `samples`, never `previewUris`. Records
// carrying only `previewUris` render with no preview at all.
//
// This backfill derives `samples` from `previewUris` for records that have
// the former and not the latter. The load-bearing rule, adopted verbatim from
// `scripts/migrations/2026_08_repair_intella_source_uri.ts`:
//
//     A URI IS NEVER WRITTEN UNTIL THAT EXACT URI HAS RETURNED 200.
//
// `previewUris` entries are a mix of absolute `http(s)` URLs and bare
// relative filenames left over from a legacy host layout that this app no
// longer serves. A relative entry cannot be probed or resolved here — it is
// reported and skipped, never guessed at, never rewritten into a URL.
//
// Scope notes:
//   * `previewUris` is NEVER deleted or modified. Leaving it makes this
//     migration non-destructive and trivially reversible (`$unset samples`
//     restores the prior state exactly).
//   * Records that already carry a non-empty `samples` are never touched —
//     `samples` is authoritative once populated (natively-trained records
//     already have it correct).
//   * `prompt` is left unset on every written sample — `previewUris` carried
//     no prompt text, and inventing one would misattribute the image.
//   * Any relative or otherwise unparseable `previewUris` entry is reported
//     under its own count and left alone; locating those source files is a
//     separate, tracked follow-up.
//
// Idempotent: a record with a non-empty `samples` is excluded by the
// selection filter, so a re-run over already-migrated records is a no-op.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is
// NO default — `.env` points `MONGODB_URI` at the live cluster). Dev/test
// work uses `noemaplane`; `noemaplane` IS the live app DB and is refused
// unless you also pass `--prod` (a deliberate, eyes-open production
// migration). `noema` is the pre-cutover legacy db and is always refused —
// see `_dbTarget.ts`.
//
// Run (dev):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_backfill_intella_samples.ts --db noemaplane --dry-run
//   drop --dry-run to write.
// Run (prod): …same… --db noemaplane --prod        (only when intentionally migrating production)

import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[backfill-intella-samples]'

export interface CandidateDoc {
  id?: string
  _id?: unknown
  previewUris?: unknown
  samples?: unknown
}

export interface Sample { url: string }

/** True only for a well-formed absolute http(s) URL — never a bare filename or relative path. */
export function isAbsoluteHttpUrl(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Pure transform: `previewUris` -> the `samples` this record should carry, given the
 * subset of those URIs already proven to serve (via `liveUrls`, checked by the caller
 * with a real HEAD/GET probe — this function does no network I/O and is unit-testable
 * without one). Absolute-but-dead and relative entries are both excluded, indistinguishably
 * from the transform's point of view; the caller separates them for reporting.
 */
export function previewUrisToSamples(previewUris: unknown, liveUrls: ReadonlySet<string>): Sample[] {
  if (!Array.isArray(previewUris)) return []
  const out: Sample[] = []
  for (const entry of previewUris) {
    if (isAbsoluteHttpUrl(entry) && liveUrls.has(entry)) out.push({ url: entry })
  }
  return out
}

/** Selection filter: eligible for this backfill iff previewUris is non-empty and samples is absent/empty. */
export function isCandidate(doc: CandidateDoc): boolean {
  const previewUris = Array.isArray(doc.previewUris) ? doc.previewUris : []
  const samples = Array.isArray(doc.samples) ? doc.samples : []
  return previewUris.length > 0 && samples.length === 0
}

/** Prove a preview URI actually serves. HEAD first; ranged GET if HEAD is not honoured. */
async function uriServes(uri: string): Promise<boolean> {
  try {
    const head = await fetch(uri, { method: 'HEAD', redirect: 'follow' })
    if (head.ok) return true
    if (head.status !== 405 && head.status !== 501) return false
  } catch {
    // fall through to the ranged GET
  }
  try {
    const ranged = await fetch(uri, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } })
    // Never read the body — this only proves liveness, not content.
    return ranged.status === 200 || ranged.status === 206
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    const allDocs = await col.find({ previewUris: { $exists: true, $ne: [] } }).toArray()
    console.log(`${TAG} ${dbName}.intellae — ${allDocs.length} record(s) with a non-empty previewUris`)

    let alreadyPopulated = 0
    let relativeOnly = 0
    let updated = 0
    const droppedUris: Array<{ id: string; uri: string }> = []

    for (const doc of allDocs) {
      const id = String(doc.id ?? doc._id)

      if (!isCandidate(doc as CandidateDoc)) {
        alreadyPopulated++
        continue
      }

      const previewUris = doc.previewUris as unknown[]
      const absoluteEntries = previewUris.filter(isAbsoluteHttpUrl)

      if (absoluteEntries.length === 0) {
        relativeOnly++
        continue
      }

      const liveUrls = new Set<string>()
      for (const entry of absoluteEntries) {
        if (await uriServes(entry)) {
          liveUrls.add(entry)
        } else {
          droppedUris.push({ id, uri: entry })
        }
      }

      const samples = previewUrisToSamples(previewUris, liveUrls)
      if (samples.length === 0) continue

      console.log(`${TAG}   ${id}: previewUris -> samples (${samples.length} live)${DRY_RUN ? ' [dry-run]' : ''}`)
      if (!DRY_RUN) {
        await col.updateOne({ _id: doc._id }, { $set: { samples } })
      }
      updated++
    }

    console.log(`${TAG} --- skipped, relative-path-only, no absolute URI to probe (${relativeOnly})`)
    console.log(`${TAG} --- skipped, samples already populated (${alreadyPopulated})`)
    console.log(`${TAG} --- URIs dropped, non-200 probe (${droppedUris.length})`)
    for (const d of droppedUris) console.log(`${TAG}   ${d.id}: ${d.uri}`)

    console.log(
      `${TAG} done — updated=${updated} relative-only-skipped=${relativeOnly} ` +
      `already-populated-skipped=${alreadyPopulated} uris-dropped=${droppedUris.length}` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Guard so importing this module for its exported pure functions (tests) never triggers a
// live DB connection attempt — only running the file directly does.
const isEntrypoint = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
