#!/usr/bin/env -S npx tsx
// =============================================================================
// Repair dangling LoRA `baseIntellaId` pointers left by the legacy checkpoint
// migration (`scripts/migrate-loras-chunk.ts`).
// =============================================================================
//
// The chunk migration wrote `baseIntellaId` from a checkpoint-name lookup table
// whose values never matched a real catalog id — the pointer names a base
// intella that was never seeded. `FAMILIA_BY_BASE_INTELLA_ID`
// (`src/crystal/modelLicense.ts`) keyed on that SAME migration vocabulary, so
// `familia` resolution kept working while the pointer itself dangled — a
// grouping bug masked as healthy by a compat table using the wrong keys.
//
// This script repoints dangling `baseIntellaId` values at the real catalog ids
// they were meant to name, and only for ids this run can PROVE exist. The
// mapping from migration vocabulary to real catalog id is fixed structural
// knowledge (both sides are stable identifiers, not data); the record counts
// and the catalog's actual contents are discovered at runtime, never assumed.
//
//     A POINTER IS NEVER WRITTEN TO AN ID THAT HAS NOT BEEN PROVEN TO EXIST.
//
// Two independent checks gate every write:
//   1. the repoint TARGET must exist in the catalog (queried fresh, not
//      hardcoded) — an unproven target is reported and the whole group is
//      skipped, never guessed at.
//   2. the record's `familia` recomputed from the NEW id must equal its
//      currently stored `familia` — a record whose familia would change or
//      become unresolvable is reported and left untouched, never silently
//      reclassified. (`src/crystal/modelLicense.ts`'s `FAMILIA_BY_BASE_INTELLA_ID`
//      carries the real catalog ids for exactly this reason — see that file.)
//
// The collection holds both schema shapes (`src/crystal/MongoIntella.ts`):
// v2 records carry the pointer at `params.baseIntellaId`, v1 records carry it
// flat at `baseIntellaId`. Shape is detected per record, never assumed.
//
// Two record classes are deliberately OUT OF SCOPE and only counted, never
// touched:
//   - records with no base pointer at all (a different defect; there is no
//     evidence yet of what they should point at)
//   - records whose base checkpoint was never seeded at all (there is no
//     catalog id to repoint to until an operator names one and it is seeded)
//
// Idempotent: a record already pointing at a real catalog id is not selected
// by the discovery query, so re-running over already-repaired records is a
// no-op.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live cluster). Dev/test work uses
// `noemaplane`; `noemaplane` IS the live app DB and is refused unless you also
// pass `--prod` (a deliberate, eyes-open production migration). `noema` is the
// pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_repair_lora_base_intella_id.ts --db noemaplane --prod --dry-run
//   --prod clears the live-db gate; --dry-run suppresses every write. BOTH are required to read prod.
// Run (WRITE, prod): …same, minus --dry-run…   (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { familiaFromBaseIntellaId, isKnownBaseIntellaId } from '../../src/crystal/modelLicense.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[repair-lora-base-intella-id]'

/** Migration-vocabulary id → the real catalog id it was meant to name. Fixed structural mapping —
 *  both sides are stable identifiers, not data discovered per run. Every target here still gets
 *  proven to exist against the live catalog before anything is written (see `resolvableTargets`). */
const STALE_TO_REAL: Record<string, string> = {
  'intella.flux-base':    'intella.flux-schnell-fp8-scaled',
  'intella.sdxl-base':    'intella.sdxl-base-1-0',
  'intella.sd15-base':    'intella.sd15-v1-5',
  'intella.kontext-base': 'intella.flux-kontext-dev',
}

interface V2Doc {
  params?: { triggerWords?: string[]; baseIntellaId?: string }
  [key: string]: unknown
}

/** Exported for the transform test — real per-record shape detection, not assumed. */
export function isV2(doc: V2Doc): boolean {
  return Array.isArray(doc.params?.triggerWords)
}

/** The record's current base pointer, whichever shape it carries. */
export function currentBaseIntellaId(doc: V2Doc): string | undefined {
  return isV2(doc) ? doc.params?.baseIntellaId : (doc as { baseIntellaId?: string }).baseIntellaId
}

export interface Outcome { id: string; from: string; to?: string; familia?: string | null; reason?: string }

export type RepointDecision =
  | { kind: 'skip-no-record'; id: string }
  | { kind: 'repoint'; outcome: Outcome; field: 'baseIntellaId' | 'params.baseIntellaId' }
  | { kind: 'skip-no-target'; outcome: Outcome }
  | { kind: 'skip-familia-conflict'; outcome: Outcome }

/** The pure decision core: given one candidate record and the targets already PROVEN to exist
 *  against the live catalog, decide whether it is safe to repoint. No I/O — every branch is
 *  covered directly by the transform test, independent of a live db. */
export function decideRepoint(
  raw: V2Doc & { _id: unknown; id: unknown; familia?: string | null },
  resolvableTargets: Map<string, string>,
): RepointDecision {
  const from = currentBaseIntellaId(raw)
  const id = String(raw.id ?? raw._id)
  if (!from) return { kind: 'skip-no-record', id }

  const to = resolvableTargets.get(from)
  if (!to) {
    return { kind: 'skip-no-target', outcome: { id, from, reason: 'repoint target not proven to exist' } }
  }

  const newFamilia = isKnownBaseIntellaId(to) ? familiaFromBaseIntellaId(to) : null
  const storedFamilia = raw.familia ?? null
  if (newFamilia !== storedFamilia) {
    return {
      kind: 'skip-familia-conflict',
      outcome: {
        id, from, to, familia: newFamilia,
        reason: `familia would change from '${storedFamilia}' to '${newFamilia ?? 'unresolvable'}'`,
      },
    }
  }

  return { kind: 'repoint', outcome: { id, from, to, familia: newFamilia }, field: isV2(raw) ? 'params.baseIntellaId' : 'baseIntellaId' }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    // Step 1: prove which repoint targets actually exist. Never trust the mapping blind.
    const knownIds = new Set(await col.distinct('id'))
    const resolvableTargets = new Map<string, string>()
    const missingTargets: string[] = []
    for (const [staleId, realId] of Object.entries(STALE_TO_REAL)) {
      if (knownIds.has(realId)) resolvableTargets.set(staleId, realId)
      else missingTargets.push(`${staleId} -> ${realId} (target not found in catalog)`)
    }

    const staleIds = Object.keys(STALE_TO_REAL)
    const candidates = await col
      .find({ genus: 'lora', $or: [{ baseIntellaId: { $in: staleIds } }, { 'params.baseIntellaId': { $in: staleIds } }] })
      .toArray()

    const repointed: Outcome[] = []
    const skippedNoTarget: Outcome[] = []
    const skippedFamiliaConflict: Outcome[] = []

    for (const raw of candidates) {
      const doc = raw as unknown as V2Doc & { _id: unknown; id: unknown; familia?: string | null }
      const decision = decideRepoint(doc, resolvableTargets)
      if (decision.kind === 'skip-no-record') continue
      if (decision.kind === 'skip-no-target') { skippedNoTarget.push(decision.outcome); continue }
      if (decision.kind === 'skip-familia-conflict') { skippedFamiliaConflict.push(decision.outcome); continue }

      repointed.push(decision.outcome)
      if (!DRY_RUN) {
        await col.updateOne({ _id: raw._id }, { $set: { [decision.field]: decision.outcome.to } })
      }
    }

    const noPointer = await col.countDocuments({
      genus: 'lora',
      baseIntellaId: { $exists: false },
      'params.baseIntellaId': { $exists: false },
    })
    const alreadyValid = await col.countDocuments({
      genus: 'lora',
      $or: [
        { baseIntellaId: { $in: [...knownIds] } },
        { 'params.baseIntellaId': { $in: [...knownIds] } },
      ],
    })

    console.log(`${TAG} --- repointed (${repointed.length})${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
    for (const r of repointed) console.log(`${TAG}   ${r.id}: ${r.from} -> ${r.to} (familia unchanged: '${r.familia}')`)
    console.log(`${TAG} --- skipped, target not proven (${skippedNoTarget.length})`)
    for (const s of skippedNoTarget) console.log(`${TAG}   ${s.id}: ${s.from} — ${s.reason}`)
    if (missingTargets.length > 0) {
      console.log(`${TAG} --- repoint groups entirely skipped, target missing from catalog (${missingTargets.length})`)
      for (const m of missingTargets) console.log(`${TAG}   ${m}`)
    }
    console.log(`${TAG} --- skipped, familia conflict (${skippedFamiliaConflict.length})`)
    for (const s of skippedFamiliaConflict) console.log(`${TAG}   ${s.id}: ${s.from} -> ${s.to} — ${s.reason}`)
    console.log(`${TAG} --- left alone, no base pointer at all: ${noPointer}`)
    console.log(`${TAG} --- left alone, already pointing at a real catalog id: ${alreadyValid}`)

    console.log(
      `${TAG} done — repointed=${repointed.length} skipped-no-target=${skippedNoTarget.length} ` +
      `skipped-familia-conflict=${skippedFamiliaConflict.length} no-pointer=${noPointer} already-valid=${alreadyValid}` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Only run when executed directly — importing this module (the transform test does, for
// `decideRepoint`/`isV2`) must never open a db connection or touch argv/process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
