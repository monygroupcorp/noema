#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill `Intella.contentRating` on already-imported models from their
// captured origin nsfw flag (`sources[].meta.originNsfw`).
// =============================================================================
//
// noema-188 (`deriveImportContentRating`, `src/crystal/ModelImporter.ts`) derives an
// imported model's `contentRating` from the origin's own adult-content flag at import
// time. Every model imported BEFORE that landed keeps whatever rating it started with
// while its `originNsfw` signal sits unread on the record. This script computes the
// SAME mapping over those existing records — a pure local re-derivation from a flag
// already stored on the document. No Civitai API call, no network.
//
// The mapping is IMPORTED from `deriveImportContentRating`, never re-implemented —
// duplicating it would drift on a content-gating axis. If that import becomes
// impossible (a heavy chain that dials Mongo at module load), this script does not
// attempt one — say so and stop rather than copy the table.
//
// A source's `meta` may live at any index — public promotion prepends an our-bucket
// source ahead of the origin (`ModelImporter.ts`), so the origin is not reliably
// `sources[0]` for every record. This script scans the whole `sources[]` array for
// the entry carrying an `originNsfw` key rather than assuming a position.
//
// Per-record decision:
//   - `canonica: true`                                    -> SKIP, report (canonical
//     records author their rating in src/crystal/seeds/, same rule as noema-186 and
//     the license backfill)
//   - no source carries an `originNsfw` key                -> SKIP, report (no signal)
//   - `contentRating` already 'sfw'/'suggestive'/'explicit' -> SKIP, report (NEVER
//     downgrade a human-set rating, even when the derivation disagrees — the same
//     refusal noema-186 makes. This is what protects the 59 records PR #280 stamped.)
//   - the signal is present but derives to 'untriaged' (wrong type/shape)
//                                                           -> SKIP, report (malformed
//     signal — nothing useful to write)
//   - otherwise                                             -> UPDATE to the derived
//     rating
//
// Idempotent: after a pass, every updated record now carries a decided rating, so a
// re-run finds it in the always-skipped 'already-rated' bucket.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live cluster). Dev/test work uses
// `noemaplane`; `noemaplane` IS the live app DB and is refused unless you also pass
// `--prod` (a deliberate, eyes-open production migration). `noema` is the
// pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (dev):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_backfill_import_content_rating.ts --db noemaplane --dry-run
//   drop --dry-run to write.
// Run (prod): …same… --db noemaplane --prod        (only when intentionally migrating production)
//
// Ships the script; does not run it. The prod run is a deliberate operator action, queued
// with the other migrations waiting on a production window.

import { MongoClient } from 'mongodb'
import { deriveImportContentRating } from '../../src/crystal/ModelImporter.js'
import type { IntellaContentRating } from '../../src/types/intelligendi.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[backfill-import-content-rating]'

export type BackfillDecision =
  | { action: 'update'; rating: IntellaContentRating }
  | { action: 'skip-no-signal' }
  | { action: 'skip-already-rated'; existing: IntellaContentRating; derived: IntellaContentRating; agrees: boolean }
  | { action: 'skip-canonical' }
  | { action: 'skip-malformed-signal' }

/** Pure decision function: given the fields a record carries, decide what (if
 *  anything) to do. No I/O — the hermetic test exercises this directly. */
export function decideBackfill(record: {
  contentRating?: IntellaContentRating
  canonica?: boolean
  sources?: Array<{ meta?: Record<string, unknown> }>
}): BackfillDecision {
  if (record.canonica === true) return { action: 'skip-canonical' }

  const signalSource = (record.sources ?? []).find(
    (s): s is { meta: Record<string, unknown> } => !!s.meta && 'originNsfw' in s.meta,
  )
  if (!signalSource) return { action: 'skip-no-signal' }

  const derived = deriveImportContentRating(signalSource.meta)
  const existing = record.contentRating

  if (existing !== undefined && existing !== 'untriaged') {
    return { action: 'skip-already-rated', existing, derived, agrees: existing === derived }
  }
  if (derived === 'untriaged') return { action: 'skip-malformed-signal' }
  return { action: 'update', rating: derived }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    // Discover, never assume a count. Any source carrying the key is a candidate —
    // narrower filtering (already-rated, canonical, malformed) happens per-record below.
    const docs = await col.find({ 'sources.meta.originNsfw': { $exists: true } }).toArray()
    console.log(`${TAG} ${dbName}.intellae — ${docs.length} record(s) with a captured origin nsfw signal`)

    const updated: string[] = []
    const skippedNoSignal: string[] = []
    const skippedAlreadyRated: string[] = []
    const skippedAlreadyRatedDisagree: string[] = []
    const skippedCanonical: string[] = []
    const skippedMalformed: string[] = []

    for (const doc of docs) {
      const id = String(doc.id ?? doc._id)
      const decision = decideBackfill({
        contentRating: doc.contentRating,
        canonica: doc.canonica,
        sources: Array.isArray(doc.sources) ? doc.sources : [],
      })

      switch (decision.action) {
        case 'update':
          updated.push(id)
          console.log(`${TAG}   UPDATE  ${id} -> ${decision.rating}${DRY_RUN ? ' [dry-run]' : ''}`)
          if (!DRY_RUN) await col.updateOne({ _id: doc._id }, { $set: { contentRating: decision.rating } })
          break
        case 'skip-no-signal':
          skippedNoSignal.push(id)
          console.log(`${TAG}   SKIP-NO-SIGNAL ${id}`)
          break
        case 'skip-already-rated':
          if (decision.agrees) {
            skippedAlreadyRated.push(id)
            console.log(`${TAG}   SKIP-ALREADY-RATED ${id} rating='${decision.existing}' (agrees with derived)`)
          } else {
            // A human and the origin disagree — the interesting bucket. Never rewritten,
            // but worth a human's second look, so it is printed distinctly.
            skippedAlreadyRatedDisagree.push(id)
            console.log(
              `${TAG}   SKIP-ALREADY-RATED-DISAGREE ${id} rating='${decision.existing}' ` +
              `derived='${decision.derived}' — never downgraded, review if intentional`,
            )
          }
          break
        case 'skip-canonical':
          skippedCanonical.push(id)
          console.log(`${TAG}   SKIP-CANONICAL ${id} — rated in src/crystal/seeds/, not swept`)
          break
        case 'skip-malformed-signal':
          skippedMalformed.push(id)
          console.log(`${TAG}   SKIP-MALFORMED-SIGNAL ${id} — originNsfw present but not a recognized shape`)
          break
      }
    }

    console.log(
      `${TAG} done — updated=${updated.length} skipped-no-signal=${skippedNoSignal.length} ` +
      `skipped-already-rated=${skippedAlreadyRated.length} ` +
      `skipped-already-rated-disagree=${skippedAlreadyRatedDisagree.length} ` +
      `skipped-canonical=${skippedCanonical.length} skipped-malformed-signal=${skippedMalformed.length}` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Guarded so the hermetic test can import decideBackfill without this script dialing
// Mongo — main() only runs when the file is executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
