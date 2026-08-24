#!/usr/bin/env -S npx tsx
// =============================================================================
// Rescan + rehost legacy-preview Intellae that reached `access:'public'` through
// the legacy migration without ever passing the CSAM/NCMEC preview scan.
// =============================================================================
//
// `ModelImporter.ts` scans preview media before a NEW import goes live, and
// `CrystalApi.ts` (`_settlePublication`) re-scans on a PROMOTION event. A record
// that reached `access:'public'` through the legacy migration went through
// neither checkpoint. This script closes that gap the same way the import path
// does: scan the record's current preview URLs with the REAL moderation gate
// (never `permissiveModerationGate`), then on pass re-host them into our bucket
// via the SAME `rehostPreviews` the import path uses (exported from
// `ModelImporter.ts` for this reuse — never reimplemented, so the two scan-then-
// store paths cannot drift apart on a content-gating axis).
//
// Target set: public Intellae whose `samples[]` still point at a third-party
// origin (image.civitai.com / huggingface.co) rather than our own bucket — a
// rehosted sample's `url` is always ours, so this predicate is self-refreshing:
// it finds whatever still needs a pass today, not a fixed id list frozen at
// decision time (the "31" named in the decision case may have moved since).
//
// Per-record outcome:
//   - no longer carries an origin-hosted sample (already rehosted, or the
//     samples changed) -> SKIP, report ('skip-no-signal')
//   - scan REJECTS (including a `hold` verdict — Intella has no distinct hold
//     state, `intelligendi.ts` `access` is a strict 'public'|'private' binary,
//     see `MongoIntella.ts` `setAccess`) -> unpublish: `setAccess(id, 'private')`,
//     same mechanism an operator uses to unpublish by hand
//   - scan PASSES -> rehost via `rehostPreviews`, `$set: { samples: rehosted }`.
//     A rehost-fetch failure inherits `rehostPreviews`'s existing policy: swallow
//     and keep the origin URL rather than fail the record (same as import).
//
// The moderation gate is selected with the SAME fail-closed precedence
// `src/index.ts` uses for the live app (real private gate > manual-review >
// permissive-opt-in > deny) — never a bespoke, weaker gate for this one script.
//
// SAFETY: `--db` is mandatory via `_dbTarget.ts` (`noemaplane` requires `--prod`;
// `noema`, the pre-cutover legacy db, is always refused). `--dry-run` is the
// default. Dropping `--dry-run` performs live writes (setAccess + samples).
//
// Run (read, dry):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_rescan_rehost_legacy_previews.ts --db noemaplane --prod --dry-run
// Run (prod, deliberate operator act — DOCTRINE §21, not run by this script's author):
//                   ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_rescan_rehost_legacy_previews.ts --db noemaplane --prod

import { MongoClient } from 'mongodb'
import type { ModerationGate, ModerationVerdict } from '../../src/crystal/ModerationGate.js'
import { selectModerationGate } from '../../src/crystal/ModerationGate.js'
import { rehostPreviews } from '../../src/crystal/ModelImporter.js'
import { httpMediaFetcher } from '../../src/crystal/MediaFetcher.js'
import { R2Uploader } from '../../src/crystal/R2Uploader.js'
import type { R2Config } from '../../src/crystal/comfyrunnerClient.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[rescan-rehost-legacy-previews]'

/** Matches a sample still hot-linked at a third-party origin — the exact hosts named in the
 *  decision case. A rehosted sample's `url` always points at our own bucket, so this predicate
 *  is what makes the target set self-refreshing rather than a frozen id list. */
const ORIGIN_HOST_RE = /(^|\/\/)([^/]*\.)?(image\.civitai\.com|huggingface\.co)\//i

function hasOriginSample(samples: Array<{ url: string }> | undefined): boolean {
  return !!samples?.some((s) => ORIGIN_HOST_RE.test(s.url))
}

export type RescanDecision = 'rehost' | 'unpublish' | 'skip-no-signal'

/** Pure decision function: given whether the record still carries an origin-hosted preview and
 *  the scan verdict for it (when a scan ran), decide what to do. No I/O — the hermetic test
 *  exercises this directly. `verdict` is unused (and may be omitted) on the no-signal path,
 *  since no scan runs when there is nothing left to scan. */
export function decideRescan(
  record: { samples?: Array<{ url: string }> },
  verdict?: ModerationVerdict,
): RescanDecision {
  if (!hasOriginSample(record.samples)) return 'skip-no-signal'
  if (!verdict) throw new Error(`${TAG} decideRescan: a scan verdict is required once an origin sample is present`)
  // A hold is a refusal to auto-publish, same as a reject — Intella has no distinct hold state
  // to route it to (see MongoIntella.ts / intelligendi.ts), so both collapse to 'unpublish'.
  return verdict.ok ? 'rehost' : 'unpublish'
}

/** Build the SAME →public moderation gate `src/index.ts` wires for the live app: the real
 *  PRIVATE gate when configured, else the fail-closed precedence chain (`selectModerationGate`).
 *  Never `permissiveModerationGate` directly — this migration must see exactly what a real
 *  publish would see today. */
async function buildRealModerationGate(): Promise<ModerationGate> {
  interface PrivateCompliance {
    configureModerationGate(deps: { fetcher: typeof httpMediaFetcher; log: Console }): Promise<ModerationGate | null>
  }
  let compliance: PrivateCompliance | null = null
  try {
    compliance = (await import('../../src/private/compliance/index.js')) as unknown as PrivateCompliance
  } catch {
    console.warn(`${TAG} private compliance module not present — falling back to the same deny/permissive/manual precedence src/index.ts uses.`)
  }
  const privateGate = compliance ? await compliance.configureModerationGate({ fetcher: httpMediaFetcher, log: console }) : null
  const { gate, mode } = selectModerationGate({
    privateGate,
    manualReview: process.env.MODERATION_MANUAL_REVIEW === '1',
    allowUnscanned: process.env.MODERATION_ALLOW_UNSCANNED === '1',
  })
  console.log(`${TAG} moderation gate mode: ${mode}`)
  return gate
}

function buildR2Store(): R2Uploader | undefined {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL } = process.env
  const bucket = process.env.R2_OUTPUTS_BUCKET ?? process.env.R2_BUCKET_NAME
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !bucket) return undefined
  const config: R2Config = {
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket,
    publicUrl: R2_PUBLIC_URL,
  }
  return new R2Uploader(config)
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const store = buildR2Store()
  const fetcher = httpMediaFetcher
  if (!store) console.warn(`${TAG} no R2 store configured — any 'rehost' decision will keep the origin URL (rehostPreviews no-ops without a store).`)
  const moderationGate = await buildRealModerationGate()

  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    // Discover, never assume a count or an id list: re-run the census this migration exists to
    // act on, at run time, against whatever the target set looks like today.
    const docs = await col.find({ access: 'public', 'samples.url': { $exists: true } }).toArray()
    console.log(`${TAG} ${dbName}.intellae — ${docs.length} public record(s) carrying preview samples; filtering to origin-hosted`)

    const rehosted: string[] = []
    const unpublished: string[] = []
    const skippedNoSignal: string[] = []

    for (const doc of docs) {
      const id = String(doc.id ?? doc._id)
      const samples = Array.isArray(doc.samples) ? doc.samples : []

      if (!hasOriginSample(samples)) {
        skippedNoSignal.push(id)
        console.log(`${TAG}   SKIP-NO-SIGNAL ${id} — no origin-hosted sample remains`)
        continue
      }

      const verdict = await moderationGate.scan({
        ref: { kind: 'intella', id },
        output: { samples },
        ...(doc.ownerAnimaId ? { by: { animaId: String(doc.ownerAnimaId) } } : {}),
      })
      const decision = decideRescan({ samples }, verdict)

      switch (decision) {
        case 'rehost': {
          rehosted.push(id)
          console.log(`${TAG}   REHOST  ${id}${DRY_RUN ? ' [dry-run]' : ''}`)
          if (!DRY_RUN) {
            const rehostedSamples = await rehostPreviews(id, samples, { store, fetcher })
            await col.updateOne({ _id: doc._id }, { $set: { samples: rehostedSamples } })
          }
          break
        }
        case 'unpublish': {
          unpublished.push(id)
          const reason = verdict.ok ? '' : ` reason='${verdict.reason}'${verdict.hold ? ' (hold)' : ''}`
          console.log(`${TAG}   UNPUBLISH ${id}${reason}${DRY_RUN ? ' [dry-run]' : ''}`)
          if (!DRY_RUN) await col.updateOne({ _id: doc._id }, { $set: { access: 'private', mutatum: new Date() } })
          break
        }
      }
    }

    console.log(
      `${TAG} done — rehosted=${rehosted.length} unpublished=${unpublished.length} ` +
      `skipped-no-signal=${skippedNoSignal.length}${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Guarded so the hermetic test can import decideRescan without this script dialing Mongo.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
