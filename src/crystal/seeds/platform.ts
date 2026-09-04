// =============================================================================
// PLATFORM seed — the platform's own treasury Anima.
// =============================================================================
//
// `PLATFORM_ANIMA_ID` (env `PLATFORM_ANIMA_ID`, default `'platform'`) is the id
// the codebase already treats as the house account, in two distinct roles:
//
//   * LEDGER DESTINATION — every platform skim, session spend and studio spend
//     credits it (`src/ledger/hooks/{platformSkim,studioSpend,sessionSpend}.ts`),
//     and the TEE spend path credits it directly (`CrystalApi.ts`).
//   * ADMIN IDENTITY — the platform-admin gate is the single comparison
//     `auctor.animaId === PLATFORM_ANIMA_ID` (`CrystalApi._assertPlatformAdmin`,
//     reproduced verbatim in `querelaAdminRouter.ts` and `partnerAdminRouter.ts`).
//     It is what lets a reviewer work the B2B partner intake queue.
//
// Nothing ever created the row. The id was credited and compared against, but
// no `Anima` with it existed, so it was a dangling reference: no `animae` entry
// to look up, and nothing a login (`Persona`) could legitimately point at — a
// wallet bound to it would have named an account that was not there. Seeding it
// is the counterpart of `seedCamel`'s treasury upsert (ADR-0011 §8), which does
// exactly this for the CAMEL treasury (`camelcabal-1`).
//
// This seed creates the ACCOUNT only. It binds no login — see
// `scripts/migrations/2026_09_01_bind_treasury_wallet.ts` for that, which is a
// deliberate, audited, one-address-at-a-time act rather than something boot does.
// =============================================================================

import type { Db } from 'mongodb'

/** The platform's own Anima id — the ledger house account and the admin identity.
 *  Resolved the same way every other declaration of it resolves (env, then `'platform'`). */
export const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'

/** Display name for the seeded row. Only ever written on insert. */
export const PLATFORM_TREASURY_NOMEN = 'Noema Platform Treasury'

export interface SeedPlatformDeps {
  /** Raw Db — `AnimaStore.create` assigns a uuid, and this row's id is fixed. */
  db: Db
  animaeCollection?: string
}

/** Idempotently seed the platform treasury Anima. Upsert-on-insert only: an existing
 *  row (renamed, or carrying `publicatio`/`custos` set by an operator) is never clobbered. */
export async function seedPlatform(deps: SeedPlatformDeps): Promise<void> {
  const now = new Date()
  await deps.db.collection(deps.animaeCollection ?? 'animae').updateOne(
    { id: PLATFORM_ANIMA_ID },
    { $setOnInsert: { id: PLATFORM_ANIMA_ID, nomen: PLATFORM_TREASURY_NOMEN, natum: now, mutatum: now } },
    { upsert: true },
  )
}
