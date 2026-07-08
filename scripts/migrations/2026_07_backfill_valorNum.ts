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
// the live app DB `noema` is refused unless you also pass `--prod`.
//
// Run (dev):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_07_backfill_valorNum.ts --db noemaplane --dry-run
//   drop --dry-run to write; add --force to re-derive already-stamped docs.
// Run (prod): …same… --db noema --prod        (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { backfillValorNum } from '../../src/crystal/backfillValorNum.js'

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')

/** Read `--db <name>`; no default — an unset target is an error, not a guess at production. */
function targetDb(): string {
  const i = process.argv.indexOf('--db')
  const name = i >= 0 ? process.argv[i + 1] : undefined
  if (!name) {
    console.error('[backfill-valorNum] refusing to run: pass --db <name> (e.g. --db noemaplane). No default — .env points at the live cluster.')
    process.exit(1)
  }
  if (name === 'noema' && !process.argv.includes('--prod')) {
    console.error('[backfill-valorNum] refusing to target the PRODUCTION db "noema" without --prod. Use --db noemaplane for dev/staging.')
    process.exit(1)
  }
  return name
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const dbName = targetDb()
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
