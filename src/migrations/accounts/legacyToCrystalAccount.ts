// =============================================================================
// legacyToCrystalAccount — pure transform: legacy user + balance → crystal
//                          anima / personae / signum  (noema-130, MONEY CODE)
// =============================================================================
//
// The account-migration's keeper deliverable: a tested, PURE function that turns
// one legacy `userCore` (+ its `userEconomy` row + its `credit_ledger` rows) into
// one crystal identity — an Anima, its Personae (platform masks + wallets + api
// keys), and ONE consolidated Signum carrying the user's spendable balance.
//
// Mirrors `src/migrations/loras/legacyToIntella.ts`: the output types are declared
// LOCAL to this migration directory — they do NOT replace `src/types/anima.ts` /
// `persona.ts` / `significandi.ts`. The transform emits id-LESS *seeds*; the chunk
// script (`scripts/migrate-accounts-chunk.ts`) assigns the fresh anima uuid at
// commit time and wires the Persona.animaIds / Signum.animaId foreign keys.
//
// OPERATOR RULINGS (2026-08-04, locked — see plans/noema-130.md):
//   • Units: 1 legacy point = 1 crystal impetus, 1:1 (both $0.000337). NO ×10.
//   • Authoritative balance = SUM of `credit_ledger.points_remaining` over CONFIRMED
//     entries (>0). This mirrors the legacy spend path exactly
//     (`findActiveDepositsForUser` / `sumPointsRemainingForWalletAddress`): both are
//     TYPE-agnostic and filter on `status:'CONFIRMED', points_remaining:{$gt:0}`.
//     REFERRAL_VAULT rows carry no `points_remaining` and aren't CONFIRMED, so they
//     never enter the sum — no over-credit. `userEconomy.usdCredit` is a secondary
//     drift figure and is IGNORED (double-credit trap).
//   • ObjectId/string `master_account_id` drift: a ledger row is matched to this user
//     by EITHER its `master_account_id` (compared as a string, so ObjectId and string
//     forms both hit) OR its `depositor_address` (∈ the user's wallet addresses).
//     Each row is evaluated ONCE and counted once if it matches either — a set union,
//     never a double count.
//   • Granularity: ONE consolidated Signum per user (`forma:'integer'`, valor = summed
//     balance). Not per-lot. Deposit-history is a separate optional pass, out of scope.
//   • Edge accounts: skip zero (no Signum, identity still migrates); QUARANTINE — do
//     NOT auto-migrate — negatives, fractional points, string-typed `master_account_id`,
//     and accounts with no linkable identity. Quarantined accounts are emitted to a
//     review report by the script; nothing is written for them.
//
// PURE: no DB, no clock, no uuid. Deterministic — same input, same output.
// =============================================================================

import type { PersonaGenus } from '../../types/persona.js'

// ─ Legacy source shapes (from stationthisdeluxebot db services) ─────────────
//   userCoreDb.js       → userCore     (_id = masterAccountId : ObjectId)
//   userEconomyDb.js    → userEconomy  (keyed by masterAccountId)
//   alchemy/creditLedgerDb.js → credit_ledger

/** An ObjectId or anything else Mongo hands us that stringifies to the hex id. */
export type ObjectIdLike = { toString(): string }

export interface LegacyWallet {
  address: string
  isPrimary?: boolean
  verified?: boolean
  addedAt?: Date | string
}

export interface LegacyApiKey {
  keyHash: string
  keyPrefix?: string
  name?: string
  status?: string
}

export interface LegacyUserCore {
  /** masterAccountId — an ObjectId in healthy data; a raw string is drift → quarantine. */
  _id: ObjectIdLike | string
  /** { telegram: '123', discord: '987…', … } — platform → external id. */
  platformIdentities?: Record<string, unknown>
  wallets?: LegacyWallet[]
  apiKeys?: LegacyApiKey[]
  profile?: { displayName?: string; username?: string; [k: string]: unknown }
  status?: string
  [k: string]: unknown
}

export interface LegacyUserEconomy {
  masterAccountId?: ObjectIdLike | string
  /** Decimal128 in legacy; IGNORED for balance (secondary/drift — double-credit trap). */
  usdCredit?: unknown
  exp?: unknown
  [k: string]: unknown
}

export interface LegacyLedgerRow {
  _id?: ObjectIdLike | string
  master_account_id?: ObjectIdLike | string
  depositor_address?: string
  type?: string
  status?: string
  /** Number in legacy. A fractional or negative value quarantines the whole account. */
  points_remaining?: number | { toString(): string }
  [k: string]: unknown
}

// ─ Crystal output seeds (id-less; the chunk script assigns ids + wires FKs) ─

/** Anima seed — the script mints `id`/`natum`/`mutatum`; keeps `legacyMasterAccountId` for
 *  provenance + idempotent upsert (unique index on `animae.legacyMasterAccountId`). */
export interface CrystalAnimaSeed {
  nomen: string
  legacyMasterAccountId: string
}

/** Persona seed — deduped by (genus, externusId); the script does findOrCreate on that pair. */
export interface CrystalPersonaSeed {
  genus: PersonaGenus
  externusId: string
  nomen?: string
  /** True for the user's primary wallet (informational; single anima so activeAnima is moot). */
  primary?: boolean
}

/** Signum seed — the consolidated spendable-balance coin. `animaId` is wired at commit.
 *  `testis = 'migration:<masterAccountId>'` is the idempotency key (unique partial index,
 *  auctor:'migration:legacy'); a re-run's duplicate issue() hits E11000 and is skipped. */
export interface CrystalSignumSeed {
  forma: 'integer'
  valor: bigint
  auctor: 'migration:legacy'
  testis: string
}

export type QuarantineReason =
  | 'string-typed-master-account-id'
  | 'unlinkable-no-identity'
  | 'negative-points'
  | 'fractional-points'

export interface AccountMigrationLog {
  legacyMasterAccountId: string
  /** Σ CONFIRMED points_remaining>0 attributed to this user — the reconciliation source figure. */
  legacyPointsSum: number
  /** How many distinct ledger rows contributed to the sum. */
  ledgerRowsCounted: number
  /** The real `_id`s (string form) of the DISTINCT CONFIRMED ledger rows summed into this account's
   *  balance. The transform is pure/per-account and cannot see that a *different* account also claims
   *  one of these rows (legacy does not enforce 1:1 wallet→account), so the chunk script uses these ids
   *  to de-dup ledger attribution GLOBALLY across accounts and refuse to double-mint a shared deposit.
   *  Rows with no `_id` are summed but not listed here (nothing global to match on). */
  attributedRowIds: string[]
  warnings: string[]
  /** Fields intentionally discarded (usdCredit, exp, awards, …). */
  drops: string[]
}

export interface AccountMigrationResult {
  anima: CrystalAnimaSeed
  personae: CrystalPersonaSeed[]
  /** null when the balance is zero (skip-zero): identity still migrates, no coin is minted. */
  signum: CrystalSignumSeed | null
  /** When set, the script does NOT write this account — it goes to the review report. */
  quarantine?: QuarantineReason
  log: AccountMigrationLog
}

// ─ Recognized platform → PersonaGenus map (platformIdentities keys) ─────────
const KNOWN_PERSONA_GENUS = new Set<PersonaGenus>([
  'telegram', 'discord', 'web', 'api', 'mcp', 'federated', 'password',
])

// ─ The transform ────────────────────────────────────────────────────────────

export function legacyToCrystalAccount(
  userCore: LegacyUserCore,
  economyRows: LegacyUserEconomy | LegacyUserEconomy[] | null | undefined,
  ledgerRows: LegacyLedgerRow[],
): AccountMigrationResult {
  const warnings: string[] = []
  const drops: string[] = []

  // ─ master account id (provenance + idempotency key) ─────────────────────
  const idIsString = typeof userCore._id === 'string'
  const masterAccountId = toIdString(userCore._id)

  // ─ Personae (platform masks + wallets + api keys), deduped by (genus,externusId) ─
  const personae = buildPersonae(userCore, warnings)

  // ─ nomen (display only; not money) ──────────────────────────────────────
  const nomen = resolveNomen(userCore, personae, masterAccountId)

  // ─ Balance: Σ CONFIRMED points_remaining>0 attributed to this user ──────
  const walletAddrs = new Set(
    (userCore.wallets ?? [])
      .map(w => (typeof w?.address === 'string' ? w.address.toLowerCase() : ''))
      .filter(Boolean),
  )

  let hasNegative = false
  let hasFractional = false
  let pointsSum = 0
  let rowsCounted = 0
  const seenRowIds = new Set<string>()
  const attributedRowIds: string[] = []

  for (const row of ledgerRows ?? []) {
    if (!row || row.status !== 'CONFIRMED') continue

    // Does this CONFIRMED row belong to this user? master_account_id (string-compared, so
    // ObjectId & string drift both hit) OR depositor_address ∈ the user's wallets.
    const rowMaster = row.master_account_id !== undefined ? toIdString(row.master_account_id) : undefined
    const rowDepositor = typeof row.depositor_address === 'string' ? row.depositor_address.toLowerCase() : undefined
    const belongs =
      (rowMaster !== undefined && rowMaster === masterAccountId) ||
      (rowDepositor !== undefined && walletAddrs.has(rowDepositor))
    if (!belongs) continue

    // Evaluate each distinct row exactly once (union semantics — never double count a
    // row that matches BOTH the master id and a wallet address).
    const rowKey = row._id !== undefined ? toIdString(row._id) : `__anon__${rowsCounted}`
    if (seenRowIds.has(rowKey)) continue
    seenRowIds.add(rowKey)

    const pts = toPoints(row.points_remaining)
    if (pts === null) {
      // Non-numeric points on a CONFIRMED row — can't safely sum → treat as fractional/quarantine.
      hasFractional = true
      warnings.push(`ledger row ${rowKey} has non-numeric points_remaining=${String(row.points_remaining)}`)
      continue
    }
    if (pts < 0) { hasNegative = true; continue }
    if (!Number.isInteger(pts)) { hasFractional = true; continue }
    if (pts === 0) continue
    if (!Number.isSafeInteger(pointsSum + pts)) {
      hasFractional = true
      warnings.push('summed points exceed safe-integer range — quarantined for manual review')
      break
    }
    pointsSum += pts
    rowsCounted++
    // Record the DISTINCT real ledger `_id` for the script's GLOBAL (cross-account) de-dup.
    // Anonymous rows (no `_id`) are summed but have nothing another account could match on.
    if (row._id !== undefined && row._id !== null) attributedRowIds.push(rowKey)
  }

  // ─ Ignored legacy fields (explicitly dropped — no crystal target) ───────
  const economyList = Array.isArray(economyRows) ? economyRows : economyRows ? [economyRows] : []
  if (economyList.some(e => e && e.usdCredit !== undefined)) {
    drops.push('userEconomy.usdCredit (secondary/drift — authoritative balance is credit_ledger)')
  }
  if (economyList.some(e => e && e.exp !== undefined)) drops.push('userEconomy.exp (no crystal target)')
  if (Array.isArray((userCore as { awards?: unknown[] }).awards) && (userCore as { awards?: unknown[] }).awards!.length) {
    drops.push('userCore.awards (no crystal target)')
  }

  // ─ Consolidated Signum seed (skip-zero → null) ──────────────────────────
  const signum: CrystalSignumSeed | null =
    pointsSum > 0
      ? { forma: 'integer', valor: BigInt(pointsSum), auctor: 'migration:legacy', testis: `migration:${masterAccountId}` }
      : null

  // ─ Quarantine decision (do NOT auto-migrate; script routes to review report) ─
  let quarantine: QuarantineReason | undefined
  if (idIsString) quarantine = 'string-typed-master-account-id'
  else if (personae.length === 0) quarantine = 'unlinkable-no-identity'
  else if (hasNegative) quarantine = 'negative-points'
  else if (hasFractional) quarantine = 'fractional-points'

  return {
    anima: { nomen, legacyMasterAccountId: masterAccountId },
    personae,
    signum,
    ...(quarantine ? { quarantine } : {}),
    log: { legacyMasterAccountId: masterAccountId, legacyPointsSum: pointsSum, ledgerRowsCounted: rowsCounted, attributedRowIds, warnings, drops },
  }
}

// ─ Helpers ────────────────────────────────────────────────────────────────

function toIdString(id: ObjectIdLike | string | undefined): string {
  if (id === undefined || id === null) return ''
  return typeof id === 'string' ? id : id.toString()
}

/** Parse a legacy points value to a JS number, or null if it isn't a finite number. */
function toPoints(v: number | { toString(): string } | undefined): number | null {
  if (v === undefined || v === null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  // Decimal128 / other objects — best-effort parse; null when it isn't a clean number.
  const n = Number((v as { toString(): string }).toString())
  return Number.isFinite(n) ? n : null
}

function buildPersonae(userCore: LegacyUserCore, warnings: string[]): CrystalPersonaSeed[] {
  const out: CrystalPersonaSeed[] = []
  const seen = new Set<string>()
  const add = (genus: PersonaGenus, externusId: string, extra?: { nomen?: string; primary?: boolean }) => {
    const key = `${genus}::${externusId}`
    if (!externusId || seen.has(key)) return
    seen.add(key)
    out.push({ genus, externusId, ...(extra?.nomen ? { nomen: extra.nomen } : {}), ...(extra?.primary ? { primary: true } : {}) })
  }

  // platformIdentities: { telegram, discord, … } → one persona each.
  for (const [platform, rawId] of Object.entries(userCore.platformIdentities ?? {})) {
    if (rawId === undefined || rawId === null || rawId === '') continue
    const externusId = String(rawId)
    if (KNOWN_PERSONA_GENUS.has(platform as PersonaGenus)) {
      add(platform as PersonaGenus, externusId)
    } else {
      warnings.push(`platformIdentities.${platform} has no crystal PersonaGenus — dropped`)
    }
  }

  // wallets[] → genus:'web', externusId = address.toLowerCase(); primary flagged.
  for (const w of userCore.wallets ?? []) {
    if (!w || typeof w.address !== 'string' || !w.address) continue
    add('web', w.address.toLowerCase(), { primary: w.isPrimary === true })
  }

  // apiKeys[] → genus:'api', externusId = keyHash.
  for (const k of userCore.apiKeys ?? []) {
    if (!k || typeof k.keyHash !== 'string' || !k.keyHash) continue
    add('api', k.keyHash, { nomen: k.name })
  }

  return out
}

function resolveNomen(userCore: LegacyUserCore, personae: CrystalPersonaSeed[], masterAccountId: string): string {
  const p = userCore.profile
  const fromProfile =
    (typeof p?.displayName === 'string' && p.displayName.trim()) ||
    (typeof p?.username === 'string' && p.username.trim())
  if (fromProfile) return fromProfile
  // Fall back to the first platform identity's display name, then a stable legacy tag.
  const named = personae.find(x => x.nomen)?.nomen
  if (named) return named
  return `legacy-${masterAccountId.slice(-8) || 'unknown'}`
}
