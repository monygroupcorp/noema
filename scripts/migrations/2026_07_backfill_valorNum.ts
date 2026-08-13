#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill `signa.valorNum` — the reserve sort-mirror (ledger-hardening Debt #1).
// =============================================================================
//
// `MongoSignorum.reserve` now selects coins smallest-first with an index-backed
// `.sort({ valorNum: 1 })` instead of full-loading the pool and sorting in JS.
// `valorNum` is a lossless numeric mirror of the authoritative bigint `valor`,
// written by `toDoc` for every NEW signum. Any signum that predates the field —
// earlier prod/staging writes, direct-insert seeds — has NO valorNum.
//
// In an ASCENDING Mongo sort a missing field ranks as `null`, BELOW all numbers.
// So an un-backfilled legacy coin sorts FIRST and is picked ahead of genuinely
// smaller coins: a large legacy coin gets split when a small one should have been
// taken whole. It self-corrects at settle (the overshoot is refunded, so it never
// under-covers), but it is a silent SELECTION regression that fresh-seeded tests
// miss. This sweep stamps valorNum on every pre-existing doc so no valid signum
// reaches reserve without it. (A partial index / `$exists` filter does NOT fix
// this — it would hide the legacy coin from the query and could under-cover.)
//
// valorNum = Number(BigInt(valor)) — identical to what toDoc writes; valor is
// always impetus-scale (well under 2^53) so the mirror is exact.
//
// Idempotent: only docs MISSING valorNum are touched. Pass `--force` to re-derive
// every doc (safe — a pure function of the authoritative valor).
//
// SAFETY: the target DB MUST be named via `--db <name>` (there is NO default —
// `.env` MONGODB_URI points at the live cluster). Dev/staging use `noemaplane`;
// `noemaplane` IS the live app db and is refused unless you also pass `--prod`.
// `noema` is the pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_07_backfill_valorNum.ts --db noemaplane --prod --dry-run
//   --prod clears the live-db gate; --dry-run suppresses every write. BOTH are required to read prod.
//   Add --force to re-derive already-stamped docs.
// Run (WRITE, prod): …same, minus --dry-run…   (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { backfillValorNum } from '../../src/crystal/backfillValorNum.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[backfill-valorNum]'
const FORCE = process.argv.includes('--force')

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('signa')
    const res = await backfillValorNum(col, { force: FORCE, dryRun: DRY_RUN })
    console.log(
      `[backfill-valorNum] ${dbName}.signa — ${res.scanned} doc(s) ${FORCE ? '(--force: all)' : 'missing valorNum'}` +
      `, ${res.updated} stamped${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error('[backfill-valorNum] failed:', err); process.exit(1) })
