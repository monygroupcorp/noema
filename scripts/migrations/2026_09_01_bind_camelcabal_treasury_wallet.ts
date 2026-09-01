#!/usr/bin/env -S npx tsx
// =============================================================================
// Bind a wallet address as the login for the camel404 treasury (`camelcabal-1`).
// =============================================================================
//
// WHY. `camelcabal-1` is a real, live `Anima` (seeded by `seedCamel()` on every
// boot — see `src/crystal/seeds/camel.ts`), used today only via the
// `x-internal-secret`-gated `/internal/v1/admin/treasury/*` routes. Nobody can
// log into it through the actual product because no login credential (`Persona`)
// has ever been linked to it. This script links exactly one: a `'web'` persona
// (Ethereum wallet) whose `externusId` is the lowercased address, pointed at
// `activeAnimaId: 'camelcabal-1'`.
//
// This is NOT an auth bypass. Actually logging in still requires the normal
// `/auth/wallet/challenge` -> sign -> `/auth/wallet/register` flow, which proves
// possession of the wallet's private key before this binding is ever consulted
// (`verifyWalletChallenge`, `src/allocutio/api/authRouter.ts`). This script only
// decides which Anima a *successful* login for that address resolves to — the
// same effect as if that wallet had been the very first to sign up and land on
// this account.
//
// SAFETY, matching the rest of scripts/migrations/*:
//   * `--db <name>` required, no default (`.env` points at the live cluster).
//   * `--db noemaplane --prod` required to touch production (`_dbTarget.ts`).
//   * `--dry-run` reports exactly what would happen; no write in dry-run.
//   * Refuses (does not silently move) if the address is ALREADY bound to a
//     DIFFERENT anima — that would be a real account move and needs a human
//     decision, not a migration's guess. Re-run is idempotent if the address is
//     already correctly bound to camelcabal-1 (reports "already bound", no-op).
//   * Refuses if `camelcabal-1` does not exist as an Anima in the target db —
//     this script only LINKS a login, it does not create the treasury.
//
// Run (dry-run, prod):
//   ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_09_01_bind_camelcabal_treasury_wallet.ts \
//     --address 0xD5958561B9D77a4B7A12Ef568B4b70EfA4F9eE4E --db noemaplane --prod --dry-run
// Run (write, prod) — same, minus --dry-run.

import { MongoClient } from 'mongodb'
import { MongoAnima } from '../../src/crystal/MongoAnima.js'
import { MongoPersona } from '../../src/crystal/MongoPersona.js'
import { resolveDbTarget, DbTargetRefusedError } from './_dbTarget.js'

const TAG = '[bind-camelcabal-treasury-wallet]'
const TREASURY_ANIMA_ID = 'camelcabal-1'

function readAddress(argv: string[]): string | null {
  const i = argv.indexOf('--address')
  const v = i >= 0 ? argv[i + 1] : undefined
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) return null
  return v.toLowerCase()
}

async function main(): Promise<void> {
  const address = readAddress(process.argv)
  if (!address) {
    console.error(`${TAG} refusing to run: pass --address 0x... (a valid 20-byte hex Ethereum address)`)
    process.exit(1)
  }

  let target: { db: string; dryRun: boolean }
  try {
    target = resolveDbTarget(process.argv, TAG)
  } catch (err) {
    if (err instanceof DbTargetRefusedError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
  const { db: dbName, dryRun } = target

  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const client = await MongoClient.connect(uri)
  try {
    const db = client.db(dbName)
    const animae = new MongoAnima(db.collection('animae'))
    const personae = new MongoPersona(db.collection('personae'))

    console.log(`${TAG} ${dbName} — checking treasury anima "${TREASURY_ANIMA_ID}" exists`)
    const treasury = await animae.find(TREASURY_ANIMA_ID)
    if (!treasury) {
      console.error(`${TAG} REFUSING: no Anima "${TREASURY_ANIMA_ID}" exists in ${dbName}. This script only links a login to an existing treasury — it does not create one (that's seedCamel's job).`)
      process.exit(1)
    }
    console.log(`${TAG} found treasury anima: nomen="${treasury.nomen}"`)

    console.log(`${TAG} checking whether wallet ${address} already has a 'web' persona`)
    const existing = await personae.findByExternus('web', address)

    if (existing) {
      if (existing.activeAnimaId === TREASURY_ANIMA_ID) {
        console.log(`${TAG} already bound to ${TREASURY_ANIMA_ID} — nothing to do (idempotent no-op).`)
        return
      }
      console.error(
        `${TAG} REFUSING: wallet ${address} is already bound to a DIFFERENT anima ` +
          `(activeAnimaId="${existing.activeAnimaId}", personaId="${existing.id}"). ` +
          `Moving an existing binding is a real account change and this script will not do it ` +
          `silently — resolve manually (see authRouter.ts's /wallet/link "move" branch) if this is intended.`,
      )
      process.exit(1)
    }

    if (dryRun) {
      console.log(
        `${TAG} DRY RUN — would create a new 'web' persona: ` +
          `{ genus: 'web', externusId: '${address}', activeAnimaId: '${TREASURY_ANIMA_ID}' }. No write performed.`,
      )
      return
    }

    const created = await personae.findOrCreate('web', address, { animaId: TREASURY_ANIMA_ID })
    console.log(`${TAG} bound. persona id=${created.id}, activeAnimaId=${created.activeAnimaId}`)
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(`${TAG} failed:`, err)
  process.exit(1)
})
