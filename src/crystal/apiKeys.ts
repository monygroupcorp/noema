// =============================================================================
// apiKeys — shared `ms2_<48hex>` API-key primitives
// =============================================================================
//
// Three pieces, each independently reusable:
//
//   1. `generateApiKeyMaterial` — pure key generation (the `ms2_` + 24 random
//      bytes shape, its stored prefix, and its stored hash). No I/O.
//   2. `appendApiKeyRecord` / `verifyApiKeyToAccountId` — the read/write halves
//      of the SAME `users.{_id:accountId}.apiKeys[]` array `src/index.ts` wires
//      as the `validateApiKey` acceptor's backing store. `verifyApiKeyToAccountId`
//      is a MECHANICAL extraction of the closure that used to live inline in
//      `src/index.ts` (same logic, same shape, now importable so a hermetic test
//      can exercise the real lookup against a fake collection instead of a live
//      Mongo).
//   3. `assertMintable` / `mintPartnerApiKey` — provisioning for an EXISTING,
//      already-known `animaId` (the partner-approval path), gated on the three facts
//      a B2B key cannot exist without: an active partner record, a signature on the
//      CURRENT API Customer Agreement, and a billing account. This is DELIBERATELY NOT the same
//      code path `scripts/mint-staging-key.ts` uses to resolve its `ACCOUNT`
//      string to an anima: that script's `resolveOrCreateAnima`-style fallback
//      MINTS A FRESH ANIMA whenever no persona already exists for the given
//      external id. Reusing that resolution logic here — with an arbitrary
//      "account" string derived some other way — would risk minting a *new*
//      soul and silently attaching the key to it instead of to the partner's
//      real, pre-existing `animaId`. `mintPartnerApiKey` instead:
//        - uses the partner's OWN `animaId` as both the `'api'` persona's
//          `externusId` AND the `users` document's `_id` (deterministic,
//          idempotent, no fresh id to get wrong),
//        - links that persona to the EXISTING `animaId` via
//          `personae.findOrCreate('api', animaId, { animaId })` — the same
//          "attach a new persona to an already-known anima" call
//          `authRouter.ts`'s `POST /wallet/link` uses (`personae.findOrCreate('web',
//          address, { animaId })` where `animaId` is the CALLER's existing soul,
//          never a freshly minted one),
//        - and hard-asserts the resulting persona's `activeAnimaId` equals the
//          intended `animaId` before writing the key, refusing (throwing) rather
//          than minting a key that would authenticate as a different account.
// =============================================================================

import { randomBytes, createHash } from 'node:crypto'
import type { PersonaStore } from '../types/persona.js'
import type { PartnerStore } from '../types/partner.js'
import type { PartnerContractStore } from '../types/partnerContract.js'
import { PARTNER_CONTRACT_VERSION } from './partnerContract.js'

// ---------------------------------------------------------------------------
// 1. Pure key generation
// ---------------------------------------------------------------------------

export interface ApiKeyMaterial {
  /** The raw secret — shown to the caller EXACTLY ONCE. Never stored. */
  apiKey: string
  /** First 12 chars of `apiKey` — stored for a cheap indexed lookup. */
  keyPrefix: string
  /** sha256(apiKey) — stored in place of the raw key. */
  keyHash: string
}

/** Generate a fresh `ms2_<48hex>` API key + its stored prefix/hash. Pure, no I/O. */
export function generateApiKeyMaterial(): ApiKeyMaterial {
  const apiKey = 'ms2_' + randomBytes(24).toString('hex')
  const keyPrefix = apiKey.slice(0, 12)
  const keyHash = createHash('sha256').update(apiKey).digest('hex')
  return { apiKey, keyPrefix, keyHash }
}

// ---------------------------------------------------------------------------
// 2. users.apiKeys[] read/write — the exact shape `validateApiKey` reads
// ---------------------------------------------------------------------------

export interface ApiKeyEntry {
  keyPrefix: string
  keyHash: string
  name?: string
  status: 'active' | 'inactive'
  /** Optional per-run spend ceiling minted onto the key itself (used for partner keys) —
   *  a stringified bigint, string so a value beyond Number.MAX_SAFE_INTEGER survives the
   *  round trip. Absent on every key minted before this field existed; unchanged behavior
   *  for those. Parsed and enforced in `apiAcceptors.ts` (`parseKeyImpetusCeiling`), never
   *  here — this module only reads/writes the raw stored value. */
  maxImpetusPerRun?: string
  /** The API Customer Agreement version this key was minted against (`PARTNER_CONTRACT_VERSION`
   *  at mint time). Written on partner keys only. The credential acceptor holds a partner key to
   *  the version stamped here, so revising the agreement retires the keys issued under the old
   *  one — section 5 of the agreement, enforced rather than promised. */
  contractVersion?: string
}

/** The shape `verifyApiKeyToAccountId` resolves to — matches `ApiKeyAccount` in
 *  `apiAcceptors.ts` (not imported from there to avoid a cross-module type dependency for
 *  what is, structurally, the same shape both sides already agree on). */
export interface ApiKeyLookupResult {
  accountId: string
  maxImpetusPerRun?: unknown
  /** The matched key's `name` tag, raw as stored — `PARTNER_KEY_NAME` for a key this program
   *  issued. `apiAcceptors.ts` uses it to decide whether the partner gate applies at all, so a
   *  key minted some other way on the same account is untouched by it. */
  keyName?: unknown
  /** The matched key's `contractVersion`, raw as stored. */
  contractVersion?: unknown
  /** The matched key's stored prefix — the non-secret half of the credential, and what the B2B
   *  meter counts a call against. */
  keyPrefix?: string
}

/** The minimal slice of a Mongo `Collection` these functions need — narrow so a
 *  hermetic test can pass an in-memory fake without a real `mongodb.Collection`. */
export interface ApiKeyUsersCollection {
  findOne(filter: Record<string, unknown>): Promise<{ _id: unknown; apiKeys?: ApiKeyEntry[] } | null>
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean; arrayFilters?: Record<string, unknown>[] },
  ): Promise<unknown>
}

/** Append `entry` to `users.{_id: accountId}.apiKeys[]` (upsert if the doc is
 *  new) — the exact write `scripts/mint-staging-key.ts` always performed inline;
 *  extracted verbatim so both it and the partner-approval path share one write. */
export async function appendApiKeyRecord(
  usersCol: ApiKeyUsersCollection,
  accountId: string,
  entry: ApiKeyEntry,
): Promise<void> {
  await usersCol.updateOne(
    { _id: accountId as unknown as object },
    { $push: { apiKeys: entry } },
    { upsert: true },
  )
}

/**
 * Resolve a raw API key to its account id (the `users` doc's `_id`) plus any per-run
 * ceiling minted onto the matched key, or null. MECHANICAL extraction of the closure
 * `src/index.ts` used to define inline as `verifyApiKeyToAccountId` — same checks, same
 * order, same defensive try/catch, only now importable and widened to carry
 * `maxImpetusPerRun` through raw (parsing/enforcement stays in `apiAcceptors.ts`).
 * `src/index.ts` wires this against the real `users` collection; tests wire it against a
 * fake `ApiKeyUsersCollection`.
 */
export async function verifyApiKeyToAccountId(usersCol: ApiKeyUsersCollection, apiKey: string): Promise<ApiKeyLookupResult | null> {
  try {
    if (!apiKey.startsWith('ms2_') || apiKey.length < 12) return null
    const prefix = apiKey.slice(0, 12)
    const user = await usersCol.findOne({ 'apiKeys.keyPrefix': prefix })
    if (!user) return null
    const hash = createHash('sha256').update(apiKey).digest('hex')
    const keys = user.apiKeys ?? []
    const match = keys.find(k => k.keyPrefix === prefix && k.keyHash === hash && k.status !== 'inactive')
    if (!match) return null
    return {
      accountId: String(user._id),
      keyPrefix: match.keyPrefix,
      ...(match.maxImpetusPerRun !== undefined ? { maxImpetusPerRun: match.maxImpetusPerRun } : {}),
      ...(match.name !== undefined ? { keyName: match.name } : {}),
      ...(match.contractVersion !== undefined ? { contractVersion: match.contractVersion } : {}),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 3. Partner provisioning — mint a key for an EXISTING, known animaId
// ---------------------------------------------------------------------------

export interface MintPartnerApiKeyDeps {
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate'>
  usersCol: ApiKeyUsersCollection
  /** The approved-partner directory + the contract-signature book. Both are REQUIRED to mint:
   *  `assertMintable` below is the "nothing generates without a signed contract and a billing
   *  account" half of the B2B item, and a mint path that could run without them would be a
   *  second way to get a key that skips the gate. */
  partners: Pick<PartnerStore, 'find'>
  contracts: Pick<PartnerContractStore, 'findCurrent'>
}

/** Thrown when a mint is refused because the partner has not met its side of the agreement.
 *  A distinct class so the router can turn it into the right 4xx rather than a 500 — the
 *  caller can fix every one of these themselves. */
export class PartnerNotMintable extends Error {
  constructor(readonly reason: 'not_a_partner' | 'contract_unsigned' | 'no_billing_account', message: string) {
    super(message)
    this.name = 'PartnerNotMintable'
  }
}

/**
 * The gate every partner key passes through. Three facts, all of them current:
 *
 *   1. an active `Partner` record — the platform approved this account, and has not cut it off;
 *   2. a signature on `PARTNER_CONTRACT_VERSION` — the customer is bound by the text we are
 *      running, not by a version we have since replaced;
 *   3. a billing account — there is somewhere to send the invoice this key will run up.
 *
 * Read fresh on every mint. Nothing is cached, because each of the three is exactly the kind of
 * fact that changes between one mint and the next.
 */
export async function assertMintable(deps: MintPartnerApiKeyDeps, animaId: string): Promise<void> {
  const partner = await deps.partners.find(animaId)
  if (!partner || partner.status === 'revoked') {
    throw new PartnerNotMintable('not_a_partner', 'No active partner record for this account')
  }
  const signed = await deps.contracts.findCurrent(animaId, PARTNER_CONTRACT_VERSION)
  if (!signed) {
    throw new PartnerNotMintable(
      'contract_unsigned',
      `The API Customer Agreement (version ${PARTNER_CONTRACT_VERSION}) has not been signed by this account`,
    )
  }
  if (!partner.billing) {
    throw new PartnerNotMintable('no_billing_account', 'No billing account is on file for this account')
  }
}

/** The `name` tag every partner-minted key carries — lets `rotatePartnerApiKey` deactivate
 *  ONLY keys this flow issued, never a key the same account holder minted some other way
 *  (e.g. `mint-staging-key.ts` for their own testing). */
export const PARTNER_KEY_NAME = 'partner'

/**
 * Mint an API key that resolves back to EXACTLY `animaId` through the real
 * `verifyApiKeyToAccountId` -> `makeCredentialAcceptors.validateApiKey` ->
 * `resolveOrCreateAnima` chain. See this module's header for why this does NOT
 * reuse `scripts/mint-staging-key.ts`'s account-resolution logic.
 *
 * Throws (refuses to mint) if an `'api'` persona already exists under this
 * externusId but points at a DIFFERENT anima — this should be unreachable
 * (the externusId IS `animaId`), so hitting it means something upstream is
 * already broken; refusing is safer than minting a misattributed key.
 *
 * Tags the entry `name: PARTNER_KEY_NAME` so `rotatePartnerApiKey` can find and
 * retire it later without touching any other key on the same account, and stamps the
 * agreement version it was minted against so the acceptor can hold it to that text.
 *
 * Gated by `assertMintable` — signed contract, billing account, active partner — which is
 * checked HERE rather than only in the router, so no caller can reach the mint around it.
 */
export async function mintPartnerApiKey(deps: MintPartnerApiKeyDeps, animaId: string): Promise<string> {
  await assertMintable(deps, animaId)
  const persona = await deps.personae.findOrCreate('api', animaId, { animaId })
  if (persona.activeAnimaId !== animaId) {
    throw new Error(
      `mintPartnerApiKey: 'api' persona for externusId ${animaId} resolved to anima ${persona.activeAnimaId}, ` +
      `not ${animaId} — refusing to mint a key that would authenticate as the wrong account`,
    )
  }
  const { apiKey, keyPrefix, keyHash } = generateApiKeyMaterial()
  await appendApiKeyRecord(deps.usersCol, animaId, {
    keyPrefix,
    keyHash,
    status: 'active',
    name: PARTNER_KEY_NAME,
    contractVersion: PARTNER_CONTRACT_VERSION,
  })
  return apiKey
}

/**
 * Self-serve issue/rotate for the partner who OWNS `animaId` — never called from the admin
 * approval path (see `partnerAdminRouter.ts`'s header for why: the admin approving a request
 * is frequently not the partner, so handing the raw key to the admin instead of the partner
 * is the wrong recipient entirely). Deactivates every currently-active `name: PARTNER_KEY_NAME`
 * entry on this account first (a real rotation, not an accumulation of live keys), then mints
 * one fresh key the same way `mintPartnerApiKey` always has. Keys minted some other way on the
 * same account (a different `name`, or none) are never touched.
 */
export async function rotatePartnerApiKey(deps: MintPartnerApiKeyDeps, animaId: string): Promise<string> {
  // Gate BEFORE retiring anything: a refused rotation must leave the partner holding the key it
  // already had, not strand it with none.
  await assertMintable(deps, animaId)
  await deps.usersCol.updateOne(
    { _id: animaId as unknown as object },
    { $set: { 'apiKeys.$[elem].status': 'inactive' } },
    { arrayFilters: [{ 'elem.name': PARTNER_KEY_NAME, 'elem.status': 'active' }] },
  )
  return mintPartnerApiKey(deps, animaId)
}
