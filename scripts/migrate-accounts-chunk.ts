#!/usr/bin/env -S npx tsx
// =============================================================================
// migrate-accounts-chunk.ts — legacy users + balances → crystal anima/persona/signum
// =============================================================================
//
// Pre-cutover account migration (noema-130, Option B, MONEY + IRREVERSIBLE).
// Reads legacy `userCore` (+ `userEconomy` + `credit_ledger`) from the SOURCE db,
// transforms each account via the pure `legacyToCrystalAccount`, and either:
//
//   - Default (DRY-RUN): prints a per-account summary + the transform output + the
//     ledger-row collision report + the quarantine list. NO writes. (Dry-run does NOT
//     reconcile money — the real reconciliation is a POST-COMMIT re-sum of the actual
//     target ledger; see below.)
//   - `--commit`: ensures + hard-asserts the idempotency guard indexes exist on the
//     target, then writes Anima → Personae → Signum (in that order) into the crystal
//     target db. Idempotent: anima upserts on `legacyMasterAccountId`; the Signum
//     `issue()` hits the unique partial index on `testis` (auctor:'migration:legacy')
//     so a re-run NEVER double-mints — E11000 is caught and skipped. Each attributed
//     legacy ledger row is claimed in `migration_ledger_claims` (unique row `_id`) so
//     the SAME deposit is never minted into two accounts, even across chunks.
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
// THE RECONCILIATION GATE IS POST-COMMIT: after writing, the script re-sums the ACTUAL
// target Signum.valor per migrated anima against Σ of that account's DISTINCT CONFIRMED
// legacy points and hard-fails (exit 1) on any mismatch. The in-memory per-account check
// is only a transform self-consistency tripwire (true by construction — NOT the gate).
// The operator, at cutover: backs up legacy db → dry-run → --commit → the script's
// post-commit reconciliation → then a FULL cross-chunk re-sum of every migration Signum.valor
// vs Σ distinct legacy points. Running --commit against real data is the OPERATOR step.
// =============================================================================

import { MongoClient, type Collection, type Db, type Document } from 'mongodb'
import { MongoSignorum } from '../src/crystal/MongoSignorum.js'
import { MongoPersona } from '../src/crystal/MongoPersona.js'
import { ensureIndexes } from '../src/crystal/ensureIndexes.js'
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

// ─ Idempotency-guard assertion (the "NEVER double-mints" guarantee) ─────────
// The whole no-double-mint guarantee rests on the unique partial indexes existing on the TARGET db.
// ensureIndexes() only runs at crystal app startup, so a fresh/restored/test target (or one whose
// index sync predates this deploy) could be missing them — issue() would then be a plain insertOne,
// no E11000 fires, and a re-run would mint a SECOND consolidated Signum for every account. So we
// ensure them here and then hard-assert their presence before any write.
const REQUIRED_TARGET_INDEXES: { coll: string; name: string; why: string }[] = [
  { coll: 'signa', name: 'testis_migration_legacy', why: 'unique testis (auctor:migration:legacy) — the no-double-mint guard' },
]
async function assertIdempotencyGuards(tgtDb: Db): Promise<void> {
  // Create/refresh all crystal indexes on the target (idempotent) so the guards exist even if the
  // target's index sync predates this deploy.
  await ensureIndexes(tgtDb)
  // Then verify the money-critical guards are actually present — hard-fail if any is missing.
  const missing: string[] = []
  for (const req of REQUIRED_TARGET_INDEXES) {
    const idx = await tgtDb.collection(req.coll).listIndexes().toArray()
    const found = idx.find(i => i.name === req.name)
    const isUnique = found && found.unique === true
    if (!found || !isUnique) missing.push(`${req.coll}.${req.name} (${req.why})${found && !isUnique ? ' — present but NOT unique' : ''}`)
  }
  // The animae idempotency guard is auto-named (legacyMasterAccountId_1); assert by key+unique.
  const animaeIdx = await tgtDb.collection('animae').listIndexes().toArray()
  const animaGuard = animaeIdx.find(i => i.key && i.key.legacyMasterAccountId === 1 && i.unique === true)
  if (!animaGuard) missing.push('animae.<legacyMasterAccountId unique> — the idempotent anima-upsert guard')
  if (missing.length) {
    console.error('[migrate-accounts-chunk] REFUSING to commit — required idempotency indexes missing on target:')
    for (const m of missing) console.error(`  • ${m}`)
    console.error('  Run ensureIndexes against the target (crystal startup) and retry.')
    process.exit(1)
  }
}

/** The persistent, cross-chunk ledger-row claim ledger (global de-dup — finding 3). */
const CLAIMS_COLLECTION = 'migration_ledger_claims'

/** The persistent, cross-chunk done-marker ledger — one doc per account whose migration reached a
 *  TERMINAL disposition this run (migrated, skip-zero, quarantined, or row-collision-excluded), even
 *  when NO Signum was minted. Building the resume-skip set from minted signa ALONE (finding: major)
 *  strands every signum-less account (zero-balance skip-zero, quarantined) permanently in the front
 *  chunk slots: the cursor re-collects them every run, so once ≥N of them accumulate ahead of the
 *  remaining work (typical for a bot DB dominated by free/zero users) the window saturates and
 *  un-migrated PAYING accounts beyond that frontier are never reached (silent fleet-level credit
 *  loss). This marker lets the window advance past them while preserving the no-money-loss guarantee:
 *  for a paying account the marker is written LAST (after the Signum mint), so a crash before the mint
 *  leaves no marker and the account is reprocessed. `_id` = masterAccountId string (matches the skip
 *  set's key derived from `testis`='migration:<mid>' and from `String(userCore._id)`). */
const DONE_COLLECTION = 'migration_accounts_done'

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
    let signaColl: Collection<Document> | null = null
    let claimsColl: Collection<Document> | null = null
    let doneColl: Collection<Document> | null = null
    let signorum: MongoSignorum | null = null
    let personae: MongoPersona | null = null
    let alreadyMigrated = new Set<string>()
    if (args.commit) {
      targetClient = new MongoClient(TARGET_URI!)
      await targetClient.connect()
      const tgtDb = targetClient.db(TARGET_DB)
      // Finding 1: the no-double-mint guarantee rests on the unique guard indexes existing on the
      // TARGET. Ensure + hard-assert them BEFORE any issue() — never trust the target was synced.
      await assertIdempotencyGuards(tgtDb)
      animaeColl = tgtDb.collection('animae')
      signaColl = tgtDb.collection('signa')
      claimsColl = tgtDb.collection(CLAIMS_COLLECTION)
      doneColl = tgtDb.collection(DONE_COLLECTION)
      signorum = new MongoSignorum(tgtDb.collection('signa'), targetClient)
      personae = new MongoPersona(tgtDb.collection('personae'))
      // Resumability: skip source accounts already brought to a TERMINAL disposition. The skip set is
      // the UNION of two truths:
      //   (a) minted migration SIGNA — testis='migration:<mid>', auctor:'migration:legacy'. Gating on
      //       the signum (NOT the anima) is the no-money-loss invariant (review finding): the commit
      //       writes Anima BEFORE the balance Signum, so a crash between them leaves an anima with NO
      //       balance; an anima-derived skip set would strand that balance forever, but a signum-derived
      //       one REPROCESSES it (anima upsert / row-claim / persona findOrCreate / issue() are all
      //       idempotent, so the second pass mints only the missing balance and no-ops the rest).
      //   (b) done-markers (DONE_COLLECTION) — every account that terminated WITHOUT a signum:
      //       zero-balance skip-zero, quarantined, and row-collision-excluded. Without these, signum-less
      //       accounts never enter the skip set, re-fill the front chunk slots every run, and once ≥N of
      //       them stack ahead of the remaining work the window saturates and paying accounts beyond that
      //       frontier are NEVER reached (finding: major — silent credit loss). The marker is written
      //       LAST for paying accounts (after the mint), so it never masks an unminted balance.
      const [migratedTestes, doneMarkers] = await Promise.all([
        tgtDb.collection('signa').distinct('testis', { auctor: 'migration:legacy' }),
        tgtDb.collection(DONE_COLLECTION).distinct('_id'),
      ])
      alreadyMigrated = new Set<string>([
        ...migratedTestes
          .map(t => String(t))
          .filter(t => t.startsWith('migration:'))
          .map(t => t.slice('migration:'.length)),
        ...doneMarkers.map(d => String(d)),
      ])
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

    // ─ GLOBAL ledger-row de-dup across the processed set (finding 3) ─────────
    // The transform is PURE + per-account: it cannot see that a *different* account also claims one
    // of its ledger rows (legacy does not enforce 1:1 wallet→account, so a wallet on two accounts,
    // or a stray master_account_id, would let the same CONFIRMED deposit be minted into BOTH consolid-
    // ated Signa). Here we intersect every non-quarantined account's `attributedRowIds`: any real
    // ledger `_id` claimed by >1 account is a collision — ALL involved accounts are pulled from the
    // commit set and routed to the review report (never auto-migrated on ambiguous balance).
    const migratable = results.filter(r => !r.quarantine)
    const rowToAccounts = new Map<string, string[]>()
    for (const r of migratable) {
      for (const rid of r.log.attributedRowIds) {
        const arr = rowToAccounts.get(rid) ?? []
        if (!arr.includes(r.log.legacyMasterAccountId)) arr.push(r.log.legacyMasterAccountId)
        rowToAccounts.set(rid, arr)
      }
    }
    const collidingAccounts = new Set<string>()
    const inSetCollisions: { rowId: string; accounts: string[] }[] = []
    for (const [rowId, accounts] of rowToAccounts) {
      if (accounts.length > 1) {
        inSetCollisions.push({ rowId, accounts })
        for (const a of accounts) collidingAccounts.add(a)
      }
    }
    console.log('── ledger-row collisions within this batch (shared deposit → NOT migrated) ─────────────')
    if (inSetCollisions.length === 0) console.log('  (none)')
    for (const c of inSetCollisions) console.log(`  ledgerRow=${c.rowId} claimed by ${c.accounts.length} accounts: ${c.accounts.join(', ')}`)
    console.log('')

    // Committable = non-quarantined AND not implicated in an in-set row collision.
    const committable = migratable.filter(r => !collidingAccounts.has(r.log.legacyMasterAccountId))

    // ─ Transform self-consistency tripwire (NOT the reconciliation gate) ─────
    // Per account, the emitted seed's valor must equal the summed legacy points. This is TRUE BY
    // CONSTRUCTION (signum.valor = BigInt(legacyPointsSum)); it is only a cheap tripwire for a
    // transform bug, NOT a reconciliation of the real money. The REAL gate is the POST-COMMIT re-sum
    // of the actual target Signum.valor against Σ distinct legacy points (below, --commit), plus the
    // operator's full re-sum across all chunks after cutover.
    let selfInconsistencies = 0
    for (const r of committable) {
      const seedValor = r.signum ? r.signum.valor : 0n
      if (BigInt(r.log.legacyPointsSum) !== seedValor) {
        selfInconsistencies++
        console.error(`  TRANSFORM BUG ${r.log.legacyMasterAccountId}: legacyPointsSum=${r.log.legacyPointsSum} seedValor=${seedValor}`)
      }
    }
    if (selfInconsistencies > 0) {
      console.error(`[migrate-accounts-chunk] transform self-consistency FAILED (${selfInconsistencies}) — aborting`)
      process.exit(1)
    }
    const seedGrand = committable.reduce((s, r) => s + (r.signum ? r.signum.valor : 0n), 0n)
    console.log('── commit set (post-dedup) ─────────────')
    console.log(`  committable accounts: ${committable.length}   quarantined: ${quarantined.length}   row-collision-excluded: ${collidingAccounts.size}`)
    console.log(`  Σ seed valor (to mint): ${seedGrand}`)
    console.log('')

    // ─ Commit (Anima → Personae → Signum), with cross-chunk row-claim de-dup ─
    if (args.commit && animaeColl && signaColl && claimsColl && doneColl && signorum && personae) {
      let animaeWritten = 0, personaeWritten = 0, signaMinted = 0, signaSkipped = 0, doneMarked = 0
      const committed: { r: AccountMigrationResult; animaId: string }[] = []
      const crossChunkCollisions: { account: string; rowId: string; owner: string }[] = []

      // Terminal-disposition marker (finding: major). Idempotent upsert keyed by masterAccountId; a
      // re-run of the same account is a no-op ($setOnInsert). For a PAYING account this is written LAST
      // (after the Signum mint), so a crash before the mint leaves no marker and the account reprocesses
      // — the no-money-loss invariant holds. For signum-less accounts (skip-zero / quarantine /
      // collision) it is the ONLY skip signal, letting the chunk window advance past them.
      const markDone = async (m: string, disposition: string, animaId?: string): Promise<void> => {
        await doneColl!.updateOne(
          { _id: m as unknown as Document['_id'] },
          { $setOnInsert: { disposition, ...(animaId ? { animaId } : {}), natum: new Date() } },
          { upsert: true },
        )
        doneMarked++
      }

      // Signum-less terminals decided BEFORE the commit loop: quarantined + in-set row-collision
      // accounts are never in `committable`, so mark them done here or they re-saturate the front slots
      // every run (same stall as zero-balance). Deterministic from the static source, so a permanent
      // skip is correct; the operator reviews them via the printed reports / the done collection.
      for (const q of quarantined) await markDone(q.log.legacyMasterAccountId, `quarantine:${q.quarantine}`)
      for (const a of collidingAccounts) await markDone(a, 'row-collision:in-set')

      for (const r of committable) {
        const mid = r.anima.legacyMasterAccountId

        // 0. Cross-chunk row-claim guard (finding 3): a row already claimed by a DIFFERENT account in
        //    a prior chunk means this account's balance double-counts a deposit — DO NOT migrate it.
        let claimConflict: { rowId: string; owner: string } | null = null
        for (const rid of r.log.attributedRowIds) {
          const existing = await claimsColl.findOne({ _id: rid as unknown as Document['_id'] })
          const owner = existing ? String((existing as { masterAccountId?: unknown }).masterAccountId) : null
          if (owner && owner !== mid) { claimConflict = { rowId: rid, owner }; break }
        }
        if (claimConflict) {
          crossChunkCollisions.push({ account: mid, rowId: claimConflict.rowId, owner: claimConflict.owner })
          console.error(`  ROW-COLLISION (cross-chunk) ${mid}: ledgerRow=${claimConflict.rowId} already claimed by ${claimConflict.owner} — NOT migrating this account`)
          // Mark done so this excluded account stops re-saturating the chunk window (no money to lose —
          // its balance double-counts a deposit already owned by another account; operator reviews it).
          await markDone(mid, `row-collision:cross-chunk:${claimConflict.owner}`)
          continue
        }

        // 1. Anima — idempotent upsert on legacyMasterAccountId (unique partial index).
        const now = new Date()
        await animaeColl.updateOne(
          { legacyMasterAccountId: mid },
          {
            $setOnInsert: {
              id: uuidv4(),
              nomen: r.anima.nomen,
              legacyMasterAccountId: mid,
              natum: now,
              mutatum: now,
            },
          },
          { upsert: true },
        )
        const animaDoc = await animaeColl.findOne({ legacyMasterAccountId: mid })
        const animaId = (animaDoc as { id?: string } | null)?.id
        if (!animaId) throw new Error(`anima upsert failed to resolve id for ${mid}`)
        animaeWritten++

        // 2. Persist this account's ledger-row claims (unique `_id` = row id) BEFORE minting, so a
        //    later chunk that re-attributes the same deposit sees the conflict. $setOnInsert keeps a
        //    re-run of THIS account (same owner) a no-op instead of a false self-collision.
        for (const rid of r.log.attributedRowIds) {
          await claimsColl.updateOne(
            { _id: rid as unknown as Document['_id'] },
            { $setOnInsert: { masterAccountId: mid, animaId, natum: now } },
            { upsert: true },
          )
        }

        // 3. Personae — findOrCreate on (genus, externusId) (unique index).
        for (const p of r.personae) {
          await personae.findOrCreate(p.genus, p.externusId, { animaId, nomen: p.nomen })
          personaeWritten++
        }

        // 4. Signum — one consolidated coin; issue() writes valorNum + hits the unique testis
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
        committed.push({ r, animaId })

        // 5. Done-marker — written LAST (after the Signum mint) so the no-money-loss invariant holds: a
        //    crash before step 4 leaves no marker AND no signum, and the account reprocesses next run.
        //    Covers skip-zero accounts too (r.signum === null), letting the window advance past them.
        await markDone(mid, r.signum ? 'migrated' : 'migrated:zero', animaId)
      }
      console.log(`[migrate-accounts-chunk] committed: animae=${animaeWritten} personae=${personaeWritten} signa minted=${signaMinted} skipped(dup)=${signaSkipped} cross-chunk-collisions=${crossChunkCollisions.length} done-marked=${doneMarked}`)
      console.log('')

      // ─ POST-COMMIT RECONCILIATION — THE REAL GATE (findings 2 + 3) ─────────
      // Re-sum the ACTUAL target Signum.valor now on disk per migrated anima and compare it to the
      // Σ of that account's DISTINCT CONFIRMED legacy points. This reads the truth source (the target
      // ledger), not the transform's own output, so a partial/aborted commit, a spuriously-skipped
      // issue(), or a mis-attributed row shows up as a hard mismatch here.
      console.log('── POST-COMMIT reconciliation (Σ target Signum.valor  vs  Σ distinct legacy points) ─────────────')
      let tgtGrand = 0n
      let expectedGrand = 0n
      let recMismatches = 0
      for (const { r, animaId } of committed) {
        const migrationSigna = await signaColl
          .find({ animaId, auctor: 'migration:legacy', status: 'valid' })
          .toArray()
        const tgtValor = migrationSigna.reduce((s, d) => s + BigInt(String((d as { valor?: unknown }).valor ?? '0')), 0n)
        const expected = BigInt(r.log.legacyPointsSum)
        tgtGrand += tgtValor
        expectedGrand += expected
        if (tgtValor !== expected) {
          recMismatches++
          console.error(`  MISMATCH ${r.log.legacyMasterAccountId}: target valor=${tgtValor} expected(distinct legacy points)=${expected}`)
        }
      }
      console.log(`  reconciled animae: ${committed.length}`)
      console.log(`  Σ target Signum.valor  = ${tgtGrand}`)
      console.log(`  Σ distinct legacy pts  = ${expectedGrand}`)
      if (recMismatches > 0 || tgtGrand !== expectedGrand) {
        console.error(`[migrate-accounts-chunk] POST-COMMIT RECONCILIATION FAILED — ${recMismatches} per-account mismatch(es); grand ${tgtGrand} vs ${expectedGrand}. INVESTIGATE before continuing (money already written).`)
        process.exit(1)
      }
      console.log('  reconciliation OK ✓')
      if (crossChunkCollisions.length) {
        console.log('')
        console.log('── cross-chunk row collisions (NOT migrated — operator review) ─────────────')
        for (const c of crossChunkCollisions) console.log(`  account=${c.account} ledgerRow=${c.rowId} first-claimed-by=${c.owner}`)
      }
      console.log('[migrate-accounts-chunk] operator: after ALL chunks, re-sum every target migration Signum.valor against Σ DISTINCT legacy CONFIRMED points_remaining>0 rows — the full cross-chunk gate.')
    } else {
      console.log('[migrate-accounts-chunk] dry-run complete. Pass --commit to write.')
      console.log('[migrate-accounts-chunk] NOTE: the real reconciliation runs POST-COMMIT (re-sum of actual target')
      console.log('  Signum.valor vs Σ distinct legacy points). Dry-run only shows the transform output + collisions.')
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
