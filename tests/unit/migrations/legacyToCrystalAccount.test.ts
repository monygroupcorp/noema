// Account-migration transform (noema-130, MONEY CODE). Fixtures cover the mapping,
// the authoritative-balance rule, idempotency, skip-zero, and every quarantine case.
// Mirrors the loras-migration test style (legacyToIntella.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  legacyToCrystalAccount,
  type LegacyUserCore,
  type LegacyLedgerRow,
} from '../../../src/migrations/accounts/legacyToCrystalAccount.js'

/** Simulate a Mongo ObjectId: a non-string value whose toString() is the hex id. */
function oid(hex: string): { toString(): string } {
  return { toString: () => hex }
}

const MID = '507f1f77bcf86cd799439011'

// ── 1. Basic mapping: identities → personae; Σ points → one consolidated signum (1:1) ──
test('maps userCore + ledger → anima/personae/signum; valor == summed points (1:1)', () => {
  const userCore: LegacyUserCore = {
    _id: oid(MID),
    platformIdentities: { telegram: '123456', discord: '987654321' },
    wallets: [{ address: '0xABCdef0000000000000000000000000000000001', isPrimary: true }],
    apiKeys: [{ keyHash: 'hash-abc', keyPrefix: 'stk_ab' }],
    profile: { displayName: 'Alice' },
  }
  const ledger: LegacyLedgerRow[] = [
    { _id: oid('a1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 100, type: 'DEPOSIT' },
    { _id: oid('a2'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 50, type: 'CONTRIBUTOR_REWARD_TALLY' },
  ]
  const r = legacyToCrystalAccount(userCore, { usdCredit: 999 }, ledger)

  assert.equal(r.quarantine, undefined)
  assert.equal(r.anima.nomen, 'Alice')
  assert.equal(r.anima.legacyMasterAccountId, MID)

  // personae: telegram, discord, web (wallet, lowercased), api (keyHash)
  const asPairs = r.personae.map(p => `${p.genus}:${p.externusId}`).sort()
  assert.deepEqual(asPairs, [
    'api:hash-abc',
    'discord:987654321',
    'telegram:123456',
    'web:0xabcdef0000000000000000000000000000000001',
  ])
  assert.equal(r.personae.find(p => p.genus === 'web')?.primary, true)

  // ONE consolidated signum; valor == 150 (100 + 50), 1:1, forma integer, migration provenance
  assert.ok(r.signum)
  assert.equal(r.signum!.valor, 150n)
  assert.equal(r.signum!.forma, 'integer')
  assert.equal(r.signum!.auctor, 'migration:legacy')
  assert.equal(r.signum!.testis, `migration:${MID}`)
  assert.equal(r.log.legacyPointsSum, 150)
})

// ── 2. Only CONFIRMED, >0 points count; PENDING/zero/spend-logs excluded ──
test('balance = Σ CONFIRMED points_remaining>0; non-CONFIRMED and zero excluded', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), platformIdentities: { telegram: '1' } }
  const ledger: LegacyLedgerRow[] = [
    { _id: oid('b1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 200 },
    { _id: oid('b2'), master_account_id: oid(MID), status: 'PENDING_CONFIRMATION', points_remaining: 5000 }, // excluded
    { _id: oid('b3'), master_account_id: oid(MID), status: 'QUOTED', points_remaining: 9999 },               // excluded
    { _id: oid('b4'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 0, type: 'SPEND_DEBIT_LOG' }, // excluded (0)
  ]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(r.signum!.valor, 200n)
  assert.equal(r.log.legacyPointsSum, 200)
  assert.equal(r.log.ledgerRowsCounted, 1)
})

// ── 3. Union of master_account_id AND depositor_address — no double-count ──
test('a row matching BOTH master_account_id and depositor_address is counted once (union)', () => {
  const wallet = '0xWALLET000000000000000000000000000000aaaa'
  const userCore: LegacyUserCore = {
    _id: oid(MID),
    platformIdentities: { telegram: '1' },
    wallets: [{ address: wallet }],
  }
  const ledger: LegacyLedgerRow[] = [
    // matches on BOTH keys — must be summed only once
    { _id: oid('c1'), master_account_id: oid(MID), depositor_address: wallet.toLowerCase(), status: 'CONFIRMED', points_remaining: 300 },
    // matches only on wallet (string master_account_id drift on a different account)
    { _id: oid('c2'), depositor_address: wallet.toLowerCase(), status: 'CONFIRMED', points_remaining: 75 },
    // matches only on master id via STRING drift (master_account_id stored as string)
    { _id: oid('c3'), master_account_id: MID, status: 'CONFIRMED', points_remaining: 25 },
  ]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(r.signum!.valor, 400n, '300 + 75 + 25, the both-match row counted once')
  assert.equal(r.log.ledgerRowsCounted, 3)
})

// ── 4. Idempotency: testis is deterministic (same input → same idempotency key) ──
test('idempotent: testis = migration:<masterAccountId> is stable across runs', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), platformIdentities: { telegram: '1' } }
  const ledger: LegacyLedgerRow[] = [{ _id: oid('d1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 10 }]
  const a = legacyToCrystalAccount(userCore, null, ledger)
  const b = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(a.signum!.testis, b.signum!.testis)
  assert.equal(a.signum!.testis, `migration:${MID}`)
  assert.equal(a.signum!.valor, b.signum!.valor)
})

// ── 5. Skip-zero: zero balance → NO signum, but identity still migrates ──
test('zero balance: signum is null (skip-zero); anima + personae still produced', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), platformIdentities: { telegram: '42' }, profile: { username: 'zed' } }
  const r = legacyToCrystalAccount(userCore, null, [])
  assert.equal(r.signum, null)
  assert.equal(r.quarantine, undefined)
  assert.equal(r.anima.nomen, 'zed')
  assert.deepEqual(r.personae.map(p => `${p.genus}:${p.externusId}`), ['telegram:42'])
  assert.equal(r.log.legacyPointsSum, 0)
})

// ── 6. Quarantine: negative points → not migrated ──
test('negative points_remaining: quarantined (negative-points), not migrated', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), platformIdentities: { telegram: '1' } }
  const ledger: LegacyLedgerRow[] = [
    { _id: oid('e1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 100 },
    { _id: oid('e2'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: -5 },
  ]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(r.quarantine, 'negative-points')
})

// ── 7. Quarantine: fractional points → not migrated ──
test('fractional points_remaining: quarantined (fractional-points), not migrated', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), platformIdentities: { telegram: '1' } }
  const ledger: LegacyLedgerRow[] = [
    { _id: oid('f1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 10.5 },
  ]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(r.quarantine, 'fractional-points')
})

// ── 8. Quarantine: string-typed master_account_id (userCore._id is a raw string) ──
test('string-typed _id: quarantined (string-typed-master-account-id)', () => {
  const userCore: LegacyUserCore = { _id: MID, platformIdentities: { telegram: '1' } } // raw string, not ObjectId
  const ledger: LegacyLedgerRow[] = [{ _id: oid('g1'), master_account_id: MID, status: 'CONFIRMED', points_remaining: 10 }]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(r.quarantine, 'string-typed-master-account-id')
})

// ── 9. Quarantine: no linkable identity (no platform ids, wallets, or api keys) ──
test('no linkable identity: quarantined (unlinkable-no-identity)', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), profile: { displayName: 'ghost' } }
  const r = legacyToCrystalAccount(userCore, null, [])
  assert.equal(r.personae.length, 0)
  assert.equal(r.quarantine, 'unlinkable-no-identity')
})

// ── 10. usdCredit is IGNORED — never affects valor (double-credit trap) ──
test('userEconomy.usdCredit is ignored; balance comes only from credit_ledger', () => {
  const userCore: LegacyUserCore = { _id: oid(MID), platformIdentities: { telegram: '1' } }
  const ledger: LegacyLedgerRow[] = [{ _id: oid('h1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 42 }]
  const r = legacyToCrystalAccount(userCore, { usdCredit: 1_000_000, exp: 500 }, ledger)
  assert.equal(r.signum!.valor, 42n, 'valor tracks ledger points, not usdCredit')
  assert.ok(r.log.drops.some(d => d.includes('usdCredit')), 'usdCredit noted as dropped')
})

// ── 11. Reconciliation invariant: legacyPointsSum == Number(valor) exactly ──
test('reconciliation: legacyPointsSum equals the minted valor', () => {
  const userCore: LegacyUserCore = {
    _id: oid(MID),
    platformIdentities: { telegram: '1' },
    wallets: [{ address: '0xdead00000000000000000000000000000000beef' }],
  }
  const ledger: LegacyLedgerRow[] = [
    { _id: oid('i1'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 1234 },
    { _id: oid('i2'), depositor_address: '0xdead00000000000000000000000000000000beef', status: 'CONFIRMED', points_remaining: 766 },
  ]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.equal(BigInt(r.log.legacyPointsSum), r.signum!.valor)
  assert.equal(r.signum!.valor, 2000n)
})

// ── 12. attributedRowIds: the DISTINCT real ledger _ids the script de-dups on globally ──
test('log.attributedRowIds lists the distinct counted ledger _ids (for cross-account de-dup)', () => {
  const wallet = '0xWALLET000000000000000000000000000000aaaa'
  const userCore: LegacyUserCore = {
    _id: oid(MID),
    platformIdentities: { telegram: '1' },
    wallets: [{ address: wallet }],
  }
  const ledger: LegacyLedgerRow[] = [
    // matches on BOTH keys → counted once → listed once
    { _id: oid('row-1'), master_account_id: oid(MID), depositor_address: wallet.toLowerCase(), status: 'CONFIRMED', points_remaining: 300 },
    { _id: oid('row-2'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 25 },
    { _id: oid('row-3'), master_account_id: oid(MID), status: 'PENDING_CONFIRMATION', points_remaining: 9 }, // excluded → not listed
    { _id: oid('row-4'), master_account_id: oid(MID), status: 'CONFIRMED', points_remaining: 0 },             // zero → not listed
  ]
  const r = legacyToCrystalAccount(userCore, null, ledger)
  assert.deepEqual(r.log.attributedRowIds.sort(), ['row-1', 'row-2'])
  // one entry per DISTINCT counted row (no double-listing the both-match row)
  assert.equal(r.log.attributedRowIds.length, r.log.ledgerRowsCounted)
})
