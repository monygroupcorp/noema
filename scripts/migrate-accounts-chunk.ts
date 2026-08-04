#!/usr/bin/env -S npx tsx
// =============================================================================
// migrate-accounts-chunk.ts — legacy users + balances → crystal anima/persona/signum
// =============================================================================
//
// Pre-cutover account migration (noema-130, Option B, MONEY + IRREVERSIBLE).
// Reads legacy `userCore` (+ `userEconomy` + `credit_ledger`) from the SOURCE db,
// transforms each account via the pure `legacyToCrystalAccount`, and either:
//
//   - Default (DRY-RUN): prints a per-account summary + the RECONCILIATION
//     (Σ legacy CONFIRMED points_remaining  vs  Σ migrated Signum.valor, per-account
//     AND grand-total) + the quarantine list. NO writes.
//   - `--commit`: writes Anima → Personae → Signum (in that order) into the crystal
//     target db. Idempotent: anima upserts on `legacyMasterAccountId`; the Signum
//     `issue()` hits the unique partial index on `testis` (auctor:'migration:legacy')
//     so a re-run NEVER double-mints — E11000 is caught and skipped.
//
// Usage:
//     npx tsx scripts/migrate-accounts-chunk.ts             # dry-run, 25 accounts
//     npx tsx scripts/migrate-accounts-chunk.ts --n 100     # bigger chunk
//     npx tsx scripts/migrate-accounts-chunk.ts --commit    # writes to crystal target
//
// Source DB (legacy stationthisdeluxebot):
//     LEGACY_MONGODB_URI ?? MONGO_PASS ?? MONGODB_URI          (URI; one required)
//     LEGACY_DB_NAME     ?? MONGO_DB_NAME                      (db name; one required)
//     LEGACY_USERCORE_COLLECTION      (default 'userCore')
//     LEGACY_USERECONOMY_COLLECTION   (default 'userEconomy')
//     LEGACY_CREDITLEDGER_COLLECTION  (default 'credit_ledger')
// Target DB (crystal — DISTINCT env; NEVER cross-write to the legacy db):
//     MONGODB_URI / DB_NAME           (REQUIRED for --commit)
//
// RECONCILIATION IS THE GATE: the script asserts legacy-sum == migrated-sum for every
// non-quarantined account AND in aggregate; ANY mismatch is a hard failure (exit 1).
// The operator, at cutover: backs up legacy db → dry-run → confirm reconciliation →
// --commit → re-reconcile. Running --commit against real data is the OPERATOR step.
// =============================================================================

import { MongoClient, type Collection, type Document } from 'mongodb'
import { MongoSignorum } from '../src/crystal/MongoSignorum.js'
import { MongoPersona } from '../src/crystal/MongoPersona.js'
import {
  legacyToCrystalAccount,
  type LegacyUserCore,
  type LegacyUserEconomy,
  type LegacyLedgerRow,
  type AccountMigrationResult,
} from '../src/migrations/accounts/legacyToCrystalAccount.js'
import { v4 as uuidv4 } from 'uuid'

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
      console.log('Usage: migrate-accounts-chunk.ts [--n N] [--commit]')
      process.exit(0)
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return a
}

function redact(uri: string | undefined): string {
  return uri ? uri.replace(/\/\/.*@/, '//<redacted>@') : '(none)'
}

// ─ Pretty-print one transformed account ────────────────────────────────────

function summarize(r: AccountMigrationResult): string {
  const lines = [
    `  masterAccountId=${r.log.legacyMasterAccountId}`,
    `  nomen=${r.anima.nomen}`,
    `  personae=[${r.personae.map(p => `${p.genus}:${p.externusId}${p.primary ? '*' : ''}`).join(', ') || '—none—'}]`,
    `  balance=${r.log.legacyPointsSum} points  →  valor=${r.signum ? r.signum.valor.toString() : '0 (skip-zero, no signum)'}`,
    `  ledgerRowsCounted=${r.log.ledgerRowsCounted}`,
  ]
  if (r.quarantine) lines.push(`  QUARANTINE=${r.quarantine} (NOT migrated)`)
  if (r.log.drops.length) lines.push(`  dropped: ${r.log.drops.join(', ')}`)
  if (r.log.warnings.length) { lines.push('  warnings:'); for (const w of r.log.warnings) lines.push(`    • ${w}`) }
  return lines.join('\n')
}

// ─ Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs()

  const SOURCE_URI = process.env.LEGACY_MONGODB_URI ?? process.env.MONGO_PASS ?? process.env.MONGODB_URI
  const SOURCE_DB = process.env.LEGACY_DB_NAME ?? process.env.MONGO_DB_NAME
  if (!SOURCE_URI) { console.error('source URI required — set LEGACY_MONGODB_URI, MONGO_PASS, or MONGODB_URI'); process.exit(1) }
  if (!SOURCE_DB) { console.error('source DB name required — set LEGACY_DB_NAME or MONGO_DB_NAME'); process.exit(1) }
  const USERCORE_COLL = process.env.LEGACY_USERCORE_COLLECTION ?? 'userCore'
  const USERECONOMY_COLL = process.env.LEGACY_USERECONOMY_COLLECTION ?? 'userEconomy'
  const CREDITLEDGER_COLL = process.env.LEGACY_CREDITLEDGER_COLLECTION ?? 'credit_ledger'

  const TARGET_URI = process.env.MONGODB_URI
  const TARGET_DB = process.env.DB_NAME ?? 'noema_fake'
  if (args.commit && (!TARGET_URI || !TARGET_DB)) { console.error('--commit requires MONGODB_URI and DB_NAME'); process.exit(1) }

  // Guard: NEVER let source and target resolve to the same db (cross-write protection).
  if (args.commit && SOURCE_URI === TARGET_URI && SOURCE_DB === TARGET_DB) {
    console.error('refusing to run: SOURCE and TARGET resolve to the SAME db — legacy and crystal must be distinct')
    process.exit(1)
  }

  const mode = args.commit ? 'COMMIT' : 'DRY-RUN'
  console.log(`[migrate-accounts-chunk] ${mode}  N=${args.n}`)
  console.log(`  source:  ${redact(SOURCE_URI)}  db=${SOURCE_DB}  colls=${USERCORE_COLL}/${USERECONOMY_COLL}/${CREDITLEDGER_COLL}`)
  console.log(`  target:  ${args.commit ? redact(TARGET_URI) : '(none — dry-run)'}  db=${TARGET_DB}`)
  console.log('')

  const sourceClient = new MongoClient(SOURCE_URI)
  let targetClient: MongoClient | null = null
  try {
    await sourceClient.connect()
    const srcDb = sourceClient.db(SOURCE_DB)
    const userCoreColl: Collection<Document> = srcDb.collection(USERCORE_COLL)
    const economyColl: Collection<Document> = srcDb.collection(USERECONOMY_COLL)
    const ledgerColl: Collection<Document> = srcDb.collection(CREDITLEDGER_COLL)

    // Target wiring (commit only). Uses the crystal stores so writes carry the exact on-disk
    // shape the runtime reads — critically the Signum `valorNum` sort-mirror, without which
    // migrated balance would be invisible to `reserve()` (unspendable).
    let animaeColl: Collection<Document> | null = null
    let signorum: MongoSignorum | null = null
    let personae: MongoPersona | null = null
    let alreadyMigrated = new Set<string>()
    if (args.commit) {
      targetClient = new MongoClient(TARGET_URI!)
      await targetClient.connect()
      const tgtDb = targetClient.db(TARGET_DB)
      animaeColl = tgtDb.collection('animae')
      signorum = new MongoSignorum(tgtDb.collection('signa'), targetClient)
      personae = new MongoPersona(tgtDb.collection('personae'))
      // Resumability: skip source accounts already migrated (by legacyMasterAccountId).
      const migratedIds = await animaeColl.distinct('legacyMasterAccountId', { legacyMasterAccountId: { $exists: true } })
      alreadyMigrated = new Set(migratedIds.map(String))
    }

    // Gather N not-yet-migrated source accounts (stable order by _id).
    const cursor = userCoreColl.find({}).sort({ _id: 1 })
    const chunk: LegacyUserCore[] = []
    let skippedMigrated = 0
    for await (const doc of cursor) {
      const mid = doc._id != null ? String(doc._id) : ''
      if (alreadyMigrated.has(mid)) { skippedMigrated++; continue }
      chunk.push(doc as unknown as LegacyUserCore)
      if (chunk.length >= args.n) break
    }

    if (chunk.length === 0) { console.log(`(no un-migrated accounts found; ${skippedMigrated} already migrated)`); return }
    console.log(`[migrate-accounts-chunk] processing ${chunk.length} accounts (${skippedMigrated} skipped as already-migrated)\n`)

    // ─ Transform each: fetch its economy row + ledger rows, run the pure transform ─
    const results: AccountMigrationResult[] = []
    for (const userCore of chunk) {
      const mid = userCore._id
      const midStr = mid != null ? String(mid) : ''
      const walletAddrs = (userCore.wallets ?? [])
        .map(w => (typeof w?.address === 'string' ? w.address.toLowerCase() : ''))
        .filter(Boolean)

      const economyRow = (await economyColl.findOne({ masterAccountId: mid })) as unknown as LegacyUserEconomy | null

      // Match ledger rows by master_account_id (ObjectId OR string drift) OR depositor_address.
      const or: Document[] = [{ master_account_id: { $in: [mid, midStr] } }]
      if (walletAddrs.length) or.push({ depositor_address: { $in: walletAddrs } })
      const ledgerRows = (await ledgerColl
        .find({ $or: or, status: 'CONFIRMED' })
        .toArray()) as unknown as LegacyLedgerRow[]

      results.push(legacyToCrystalAccount(userCore, economyRow, ledgerRows))
    }

    // ─ Print each ─────────────────────────────────────────────────────────
    for (const r of results) {
      console.log(`── ${r.anima.nomen} (${r.log.legacyMasterAccountId}) ─────────────`)
      console.log(summarize(r))
      console.log('')
    }

    // ─ Quarantine report ────────────────────────────────────────────────────
    const quarantined = results.filter(r => r.quarantine)
    console.log('── quarantine (NOT migrated — operator review) ─────────────')
    if (quarantined.length === 0) console.log('  (none)')
    for (const q of quarantined) console.log(`  ${q.log.legacyMasterAccountId}  reason=${q.quarantine}  balance=${q.log.legacyPointsSum}`)
    console.log('')

    // ─ RECONCILIATION (the gate) ────────────────────────────────────────────
    // Per non-quarantined account: legacy points == minted valor. Grand total too.
    const migratable = results.filter(r => !r.quarantine)
    let legacyGrand = 0n
    let valorGrand = 0n
    let mismatches = 0
    console.log('── reconciliation (Σ legacy points  vs  Σ migrated valor) ─────────────')
    for (const r of migratable) {
      const legacyPts = BigInt(r.log.legacyPointsSum)
      const valor = r.signum ? r.signum.valor : 0n
      legacyGrand += legacyPts
      valorGrand += valor
      if (legacyPts !== valor) {
        mismatches++
        console.log(`  MISMATCH ${r.log.legacyMasterAccountId}: legacy=${legacyPts} valor=${valor}`)
      }
    }
    console.log(`  accounts (non-quarantined): ${migratable.length}   quarantined: ${quarantined.length}`)
    console.log(`  Σ legacy points = ${legacyGrand}`)
    console.log(`  Σ migrated valor = ${valorGrand}`)
    if (mismatches > 0 || legacyGrand !== valorGrand) {
      console.error(`[migrate-accounts-chunk] RECONCILIATION FAILED — ${mismatches} per-account mismatch(es); grand ${legacyGrand} vs ${valorGrand}`)
      process.exit(1)
    }
    console.log('  reconciliation OK ✓')
    console.log('')

    // ─ Commit (Anima → Personae → Signum) ──────────────────────────────────
    if (args.commit && animaeColl && signorum && personae) {
      let animaeWritten = 0, personaeWritten = 0, signaMinted = 0, signaSkipped = 0
      for (const r of migratable) {
        // 1. Anima — idempotent upsert on legacyMasterAccountId (unique partial index).
        const now = new Date()
        await animaeColl.updateOne(
          { legacyMasterAccountId: r.anima.legacyMasterAccountId },
          {
            $setOnInsert: {
              id: uuidv4(),
              nomen: r.anima.nomen,
              legacyMasterAccountId: r.anima.legacyMasterAccountId,
              natum: now,
              mutatum: now,
            },
          },
          { upsert: true },
        )
        const animaDoc = await animaeColl.findOne({ legacyMasterAccountId: r.anima.legacyMasterAccountId })
        const animaId = (animaDoc as { id?: string } | null)?.id
        if (!animaId) throw new Error(`anima upsert failed to resolve id for ${r.anima.legacyMasterAccountId}`)
        animaeWritten++

        // 2. Personae — findOrCreate on (genus, externusId) (unique index).
        for (const p of r.personae) {
          await personae.findOrCreate(p.genus, p.externusId, { animaId, nomen: p.nomen })
          personaeWritten++
        }

        // 3. Signum — one consolidated coin; issue() writes valorNum + hits the unique testis
        //    index. A re-run's duplicate throws E11000 → skip (already minted, never doubled).
        if (r.signum) {
          try {
            await signorum.issue({ animaId, forma: r.signum.forma, valor: r.signum.valor, auctor: r.signum.auctor, testis: r.signum.testis })
            signaMinted++
          } catch (err: unknown) {
            if ((err as { code?: number }).code === 11000) { signaSkipped++ }
            else throw err
          }
        }
      }
      console.log(`[migrate-accounts-chunk] committed: animae=${animaeWritten} personae=${personaeWritten} signa minted=${signaMinted} skipped(dup)=${signaSkipped}`)
      console.log('[migrate-accounts-chunk] operator: re-run reconciliation against the target after commit.')
    } else {
      console.log('[migrate-accounts-chunk] dry-run complete. Pass --commit to write.')
    }
  } finally {
    await sourceClient.close().catch(() => {})
    if (targetClient) await targetClient.close().catch(() => {})
  }
}

main().catch(err => {
  console.error('[migrate-accounts-chunk] failed:', err)
  process.exit(1)
})
