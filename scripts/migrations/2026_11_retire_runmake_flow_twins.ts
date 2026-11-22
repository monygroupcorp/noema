#!/usr/bin/env -S npx tsx
// =============================================================================
// Retire legacy `runmake.*` flow registrations that twin a modern canonical id.
// =============================================================================
//
// GET /v1/flows (`CrystalApi.listFlows` -> `modorum.list({ canonica: true })`)
// lists every canonica:true doc in `modi` with no fold by name, so a flow kept
// under two ids shows up twice. `runmake.flux-schnell` is one such twin: an
// older registration (no `descriptio`) left behind when the flow was
// re-registered under the bare id `flux-schnell` — same name, same schema,
// same fundament, both still `canonica: true`.
//
// This is a REPAIR of stale registry data, not a code fix: `register()` has
// always upserted by `{id, versio}`, so nothing stops two ids from describing
// the same flow — the registry just never had a reason to notice until a
// second registration under a new id left the old one live.
//
//     A RUNMAKE TWIN IS RETIRED ONLY WHEN ITS GROUP (same `nomen`, every
//     canonica:true doc) ALSO CONTAINS A NON-`runmake.`-PREFIXED TWIN TO
//     FAVOUR. A lone `runmake.*` registration with no modern twin is left
//     alone — there is nothing named here to retire it "in favour of."
//
// "Retired" means `canonica: false`, not deleted: `listFlows()` filters on
// `canonica: true`, so this alone drops it from GET /v1/flows and every
// screen that reads that list (the catalogue, the canvas palette). The doc
// stays resolvable by `modorum.find(id)` (no canonica filter), so a past
// `Actum.modusId` pointing at the retired id still describes correctly.
//
// Idempotent: the discovery query selects only `canonica: true` docs, so a
// twin already retired by an earlier run is not selected again.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is
// NO default — `.env` points `MONGODB_URI` at the live cluster). `noemaplane`
// IS the live app db and is refused unless you also pass `--prod`. `noema` is
// the pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_11_retire_runmake_flow_twins.ts --db noemaplane --prod --dry-run
//   --prod clears the live-db gate; --dry-run suppresses every write. BOTH are required to read prod.
// Run (WRITE, prod): …same, minus --dry-run…   (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[retire-runmake-flow-twins]'

/** The legacy id prefix this script retires twins of. Fixed structural knowledge — the modistae
 *  renaming off this prefix is historical fact, not data discovered per run. */
export const LEGACY_PREFIX = 'runmake.'

interface Doc {
  id: string
  nomen?: string
  versio?: string
  descriptio?: string
  canonica?: boolean
}

export interface RetireOutcome { id: string; nomen: string; favoring: string }

export type RetireDecision =
  | { kind: 'retire'; outcome: RetireOutcome }
  | { kind: 'skip-not-runmake' }
  | { kind: 'skip-no-modern-twin' }

/** Dotted numeric versions ("1.0.0" < "1.2" < "2.0.0"); a missing version sorts lowest. */
function compareVersio(a?: string, b?: string): number {
  const parse = (v?: string) => (v ?? '').split('.').map((p) => parseInt(p, 10) || 0)
  const pa = parse(a), pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Among a nomen-group's non-`runmake.`-prefixed docs, the one a `runmake.*` twin is retired in
 *  favour of: newest version, else (equal version) the one that describes itself. */
function pickModernTwin(group: Doc[]): Doc | undefined {
  const modern = group.filter((d) => !d.id.startsWith(LEGACY_PREFIX))
  return modern.sort((a, b) => {
    const byVersion = compareVersio(b.versio, a.versio)
    if (byVersion !== 0) return byVersion
    return (b.descriptio ? 1 : 0) - (a.descriptio ? 1 : 0)
  })[0]
}

/** The pure decision core: given one candidate doc and every canonica:true doc sharing its
 *  `nomen` (itself included), decide whether it is a `runmake.*` twin safe to retire. No I/O —
 *  every branch is covered directly by the transform test, independent of a live db. */
export function decideRetirement(doc: Doc, group: Doc[]): RetireDecision {
  if (!doc.id.startsWith(LEGACY_PREFIX)) return { kind: 'skip-not-runmake' }
  const modern = pickModernTwin(group)
  if (!modern) return { kind: 'skip-no-modern-twin' }
  return { kind: 'retire', outcome: { id: doc.id, nomen: doc.nomen ?? doc.id, favoring: modern.id } }
}

function groupByNomen(docs: Doc[]): Map<string, Doc[]> {
  const byNomen = new Map<string, Doc[]>()
  for (const d of docs) {
    const key = (typeof d.nomen === 'string' && d.nomen.trim()) || d.id
    byNomen.set(key, [...(byNomen.get(key) ?? []), d])
  }
  return byNomen
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('modi')

    const docs = (await col.find({ canonica: true }).toArray()) as unknown as Doc[]
    const groups = groupByNomen(docs)

    const retired: RetireOutcome[] = []
    const skippedNoTwin: string[] = []

    for (const doc of docs) {
      const group = groups.get((typeof doc.nomen === 'string' && doc.nomen.trim()) || doc.id) ?? [doc]
      const decision = decideRetirement(doc, group)
      if (decision.kind === 'skip-not-runmake') continue
      if (decision.kind === 'skip-no-modern-twin') { skippedNoTwin.push(doc.id); continue }

      retired.push(decision.outcome)
      if (!DRY_RUN) {
        await col.updateMany(
          { id: doc.id, canonica: true },
          { $set: { canonica: false, mutatum: new Date() } },
        )
      }
    }

    console.log(`${TAG} ${dbName}.modi — ${docs.length} canonica:true flow(s) across ${groups.size} name(s)`)
    console.log(`${TAG} --- retired (${retired.length})${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
    for (const r of retired) console.log(`${TAG}   ${r.id} -> retired, favouring ${r.favoring}`)
    console.log(`${TAG} --- left alone, runmake.* with no modern twin (${skippedNoTwin.length})`)
    for (const id of skippedNoTwin) console.log(`${TAG}   ${id}`)

    console.log(
      `${TAG} done — retired=${retired.length} runmake-no-twin=${skippedNoTwin.length}` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Only run when executed directly — importing this module (the transform test does, for
// `decideRetirement`) must never open a db connection or touch argv/process.exit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
