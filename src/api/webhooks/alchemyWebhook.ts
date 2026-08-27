import { AbiCoder } from 'ethers'
import crypto from 'node:crypto'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('alchemy-webhook')
import type { Depositum, Depositorum, Petitionum, Testimoniorum } from '../../types/catena.js'
import type { Signorum } from '../../types/significandi.js'
import type { Redituum, RevenueOrigo } from '../../types/reditus.js'
import type { AssetPricer } from '../../crystal/AssetPricer.js'
import { usdMicroToImpetus } from '../../ledger/rates.js'
import { fundingBps, applyFundingBps } from '../../ledger/depositFunding.js'
import type { ResolveWalletAnima } from '../../crystal/resolveWalletAnima.js'
import type { ArcanumTreeStore } from '../../arcanum/ArcanumTree.js'
import type { SanctionsScreen } from '../../compliance/SanctionsScreen.js'

// ---------------------------------------------------------------------------
// Known CreditVault event topic hashes (pre-computed)
// keccak256 of the canonical event signature
// ---------------------------------------------------------------------------

export const TOPIC_PAYMENT          = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
export const TOPIC_NFT_RECEIVED     = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const TOPIC_ERC1155          = '0x72d4fe4bd1118f3ff78811cc440bf989b6e515157dab466890aaed7c87ffb78c'
// keccak256("AnonymousDeposit(bytes32,address,uint256)")
export const TOPIC_ANON_DEPOSIT     = '0x879aadcc0b21da25bde4bcf799cb142a02d0135f66a1328fef12c8b78636c58d'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AlchemyWebhookDeps {
  deposita: Depositorum
  signorum: Signorum
  /**
   * USD revenue book (ADR-0013 §2). A `Reditus` is recorded here — at USD FMV — as a PEER of
   * the Signum issuance, for every deposit whose funds we recognize (i.e. not OFAC-quarantined),
   * even before the funder's Anima is linked (revenue is recognized at receipt, §4). Idempotent
   * on `depositumId` so a re-delivered webhook cannot double-count. See docs/spec/conditional-license-revenue.md.
   */
  redituum: Redituum
  petitiones: Petitionum
  testimonia: Testimoniorum
  /**
   * The wallet↔account seam for deposit attribution (noema-027). Resolves a payer/sender wallet to
   * the owning animaId via the auth rail's `web` Persona binding (custos fallback), or `null` when
   * no account is linked. Replaces the dead `animae.findByCustos` read that parked every linked
   * deposit `confirmatum`. Used by BOTH the payment path and the NFT-received path.
   */
  resolveWalletAnima: ResolveWalletAnima
  /** Arcanum Merkle tree — receives anonymous deposits (no animaId). */
  arcanumTree: ArcanumTreeStore
  /**
   * OFAC sanctions screen. Every value-bearing deposit's sending wallet is
   * screened here, before any Signum is issued or Arcanum leaf inserted — the
   * deposit boundary is the one moment the funder address is observable.
   */
  sanctions: SanctionsScreen
  /** Per-chainId HMAC signing keys. Key: chainId string, value: secret string. */
  signingKeys: Record<string, string>
  /**
   * Per-chainId vault addresses (lowercase). Used to filter logs that target our vault.
   * Key: chainId string, value: lowercase address.
   */
  vaultAddresses: Record<string, string>
  /**
   * Per-asset USD FMV oracle (ADR-0013 §2) — the ONE pricing fetch that feeds both the revenue
   * book (`Reditus.usdFmv` = gross) and the credit issuance (`Signum.valor` = net, after the
   * funding-rate haircut). Alchemy-backed in production; `nullPricer` when no key is configured
   * (deposits still processed, but revenue/credit skipped with a LOUD warning — never a silent zero).
   */
  pricer: AssetPricer
}

// ---------------------------------------------------------------------------
// USD revenue + credit at the deposit boundary (ADR-0013 §2/§4b) — shared helpers
// ---------------------------------------------------------------------------

/**
 * Price a deposit once → its gross USD FMV in micro-USD (or `null` if unpriceable — the caller
 * then skips both booking and crediting, loudly, never a silent zero).
 */
async function priceDeposit(
  deps: AlchemyWebhookDeps,
  chainId: string,
  token: string,
  amountRaw: bigint,
  ref: string,
): Promise<bigint | null> {
  const usdFmv = await deps.pricer.usdFmv(chainId, token, amountRaw)
  if (usdFmv === null || usdFmv <= 0n) {
    log.warn('deposit NOT priced — revenue + credit skipped (no silent zero)', { ref, chainId, token, amountRaw: amountRaw.toString() })
    return null
  }
  return usdFmv
}

/**
 * Book a priced deposit to the USD revenue ledger at its GROSS FMV. Idempotent on `depositumId`
 * (absent for anon notes, which the arcanum-tree insert dedupes). Store/DB errors propagate — the
 * caller runs this while the deposit is still `confirmatum`, so a 500 → Alchemy retry re-books
 * idempotently rather than losing the row.
 */
async function bookRevenue(
  deps: Pick<AlchemyWebhookDeps, 'redituum'>,
  args: { usdFmv: bigint; origo: RevenueOrigo; depositumId?: string; token: string },
): Promise<void> {
  await deps.redituum.record({
    usdFmv: args.usdFmv,
    fmvSource: `alchemy:${args.token}`,   // TODO(ADR-0013 §5): add block/timestamp once the oracle records it
    origo: args.origo,
    depositumId: args.depositumId,
  })
}

/**
 * The buy-side conversion: gross USD FMV → spendable impetus credits, applying the per-asset
 * funding rate (the haircut) at the CANONICAL $0.000337 rate. The gross/net gap is retained margin
 * (booked as gross revenue via bookRevenue). Returns 0n for a sub-point dust deposit.
 *
 * NO ESTIMATED-GAS DEDUCTION HERE, deliberately. Legacy deducts the user's deposit-tx gas, but only
 * in its PRE-deposit quote. Doing it here (post-deposit) would (a) dock the user a second time for
 * gas they already paid to the network, and (b) zero-out small deposits (mainnet gas can exceed a
 * small deposit's net value) — for funds already received. Gas belongs in the future user-facing
 * buy-QUOTE surface (informational, before the user sends), not this settlement path. See
 * docs/spec/conditional-license-revenue.md + memory project_deposit_pricing_parity.
 */
function creditImpetus(grossUsdFmv: bigint, token: string): bigint {
  return usdMicroToImpetus(applyFundingBps(grossUsdFmv, fundingBps(token)))
}

/** The auctor stamped on every on-chain deposit credit — also the scope of the unique-partial testis index. */
const DEPOSIT_AUCTOR = 'alchemy-webhook'

/**
 * A Mongo duplicate-key (E11000) error, detected structurally so this handler stays decoupled from
 * the driver (the Memory stores never throw it — their single-writer path is deduped by the
 * processatum short-circuit + this sweep only touching `confirmatum` rows).
 */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}

/** The store surface `creditConfirmedDeposit` needs — shared by the webhook payment path and the sweep. */
export type DepositCreditDeps = Pick<AlchemyWebhookDeps, 'deposita' | 'signorum' | 'petitiones'>

/**
 * Convert ONE resolved + priced `confirmatum` deposit into a credit: issue the eth Signum, mark the
 * Depositum `processatum`, and confirm any open magic-amount Petitio. Shared by the webhook payment
 * path (fresh receipt) and the retry sweep (re-attribution after a wallet links).
 *
 * DURABLE, CROSS-INSTANCE IDEMPOTENCY — mirrors the Stripe rail (stripeWebhook.ts). The Signum's
 * `testis` is the deposit txHash and a unique PARTIAL index on (testis where auctor:'alchemy-webhook')
 * makes a SECOND issue for the same deposit throw a dup-key — so a sweep tick racing an Alchemy
 * re-delivery mints impetus EXACTLY ONCE. The loser catches the dup-key, finds the winner's signum,
 * and idempotently completes the processatum transition — never a second signum, never re-credit.
 * (`bookRevenue` is independently idempotent on depositumId, so revenue can't double either.)
 *
 * `usdFmv`/`token` are passed in — and BOTH callers pass the PERSISTED receipt-time basis
 * (`depositum.usdFmv`/`token`): the sweep reads it directly, and the webhook prefers it over the
 * fresh price (`?? freshPrice` only for the never-priced-at-receipt row). This NEVER re-prices an
 * already-booked deposit, so the credit basis always equals the booked revenue.
 */
async function creditConfirmedDeposit(
  deps: DepositCreditDeps,
  args: { depositum: Depositum; usdFmv: bigint; token: string; animaId: string; valor: bigint; txHash: string },
): Promise<void> {
  const { depositum, usdFmv, token, animaId, valor, txHash } = args

  // Credit spendable impetus = the NET buy amount (gross FMV × per-asset funding rate). Sub-point
  // dust → parked (not a zero-value credit); revenue was already booked at receipt.
  const impetus = creditImpetus(usdFmv, token)
  if (impetus <= 0n) {
    log.warn('deposit priced but below one impetus — parked uncredited', { txHash, token, usdFmv: usdFmv.toString() })
    return
  }

  let signumId: string
  try {
    const signum = await deps.signorum.issue({
      forma: 'eth',            // "on-chain CreditVault deposit" — reused across assets; valor is impetus
      animaId,
      valor: impetus,
      auctor: DEPOSIT_AUCTOR,
      testis: txHash,
    })
    signumId = signum.id
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err
    // The durable guard fired: a concurrent sweep/re-delivery already credited this deposit. Replay
    // the winner's signum and idempotently finish the processatum transition it may not have
    // committed yet — never a second mint.
    const history = await deps.signorum.history({ animaId })
    const winner = history.find(s => s.auctor === DEPOSIT_AUCTOR && s.testis === txHash)
    if (!winner) throw err   // dup-key but the winner's row isn't visible — surface (unexpected)
    signumId = winner.id
    log.info('deposit credit lost the race — replaying the concurrent winner', { txHash, animaId, signumId })
  }

  // Mark Depositum processatum (idempotent — a replay just re-asserts the same terminal state).
  await deps.deposita.update(depositum.id, {
    status: 'processatum',
    animaId,
    signumId,
    processatum: new Date(),
  })

  // Check for an open magic-amount Petitio — matched on the on-chain amount (wei), not credits.
  const petitio = await deps.petitiones.findExpectans(animaId)
  if (petitio && petitio.valuta === valor) {
    await deps.petitiones.update(petitio.id, {
      status: 'confirmata',
      depositumId: depositum.id,
      walletAddress: depositum.ab,
      confirmata: new Date(),
    })
  }
}

/** The store surface the retry sweep needs. `redituum` is here so the sweep can RE-BOOK idempotently
 *  before crediting (guards the create-succeeded-but-book-failed row — see sweepConfirmatumDeposita). */
export type DepositSweepDeps = Pick<AlchemyWebhookDeps, 'deposita' | 'signorum' | 'petitiones' | 'resolveWalletAnima' | 'redituum'>

/**
 * Retry sweep (noema-027 decision 3): re-attribute every parked `confirmatum` deposit whose payer
 * NOW resolves to an account, and credit it. Runs on boot + every DEPOSIT_SWEEP_INTERVAL_MS. No new
 * admin surface, no Alchemy dashboard. Revenue was already booked at receipt; this only issues the
 * idempotency-guarded credit from the PERSISTED receipt-time basis — it never re-prices.
 *
 * Legacy parked rows predating the token/usdFmv persistence are SKIPPED with a loud warn naming the
 * missing fields (their heal path is a fresh Alchemy re-delivery whose payload carries the token —
 * NOT a backfill migration). A still-unlinked payer is left parked silently: the loud "unattributed"
 * warn already fired once at receipt, so the sweep must not spam it every tick.
 *
 * RE-BOOK BEFORE CREDIT (review finding): the Depositum's usdFmv is persisted at `create` BEFORE
 * bookRevenue runs (separate write, no transaction). If record() threw transiently and the process
 * restarted, this sweep would see a priced row with NO revenue booked — crediting it then would leave
 * revenue permanently zero (re-delivery short-circuits on `processatum`). So the sweep re-books
 * idempotently (no-op if already booked, on the depositumId partial-unique index) IMMEDIATELY before
 * crediting — the credit basis (persisted receipt-time FMV) always equals the booked Reditus.
 */
export async function sweepConfirmatumDeposita(deps: DepositSweepDeps): Promise<{ swept: number; skipped: number }> {
  const parked = await deps.deposita.list({ status: 'confirmatum' })
  let swept = 0
  let skipped = 0
  for (const depositum of parked) {
    if (depositum.token === undefined || depositum.usdFmv === undefined) {
      log.warn('deposit sweep: skipping legacy parked deposit missing receipt-time basis — heal via Alchemy re-delivery', {
        depositumId: depositum.id,
        txHash: depositum.transactioHash,
        missing: [
          depositum.token === undefined ? 'token' : null,
          depositum.usdFmv === undefined ? 'usdFmv' : null,
        ].filter((f): f is string => f !== null),
      })
      skipped++
      continue
    }
    const animaId = await deps.resolveWalletAnima(depositum.ab)
    if (!animaId) { skipped++; continue }   // still unlinked — stay parked, no warn spam
    // Re-book idempotently before crediting: heals a create-succeeded-but-book-failed row so we never
    // credit a deposit whose revenue was never recognized. No-op if already booked (depositumId guard).
    await bookRevenue(deps, { usdFmv: depositum.usdFmv, origo: 'crypto', depositumId: depositum.id, token: depositum.token })
    await creditConfirmedDeposit(deps, {
      depositum,
      usdFmv: depositum.usdFmv,
      token: depositum.token,
      animaId,
      valor: depositum.valor,
      txHash: depositum.transactioHash,
    })
    swept++
  }
  if (swept > 0 || skipped > 0) log.info('deposit sweep complete', { swept, skipped, scanned: parked.length })
  return { swept, skipped }
}

export interface AlchemyWebhookRequest {
  body: unknown
  rawBody: string
  signature?: string
  /** Chain ID from the URL parameter (e.g. '1' for mainnet, '8453' for Base). */
  chainId: string
}

export interface AlchemyWebhookResult {
  status: 200 | 400 | 401 | 403 | 500
  body: { success: boolean; processed: number; skipped: number; message?: string }
}

/**
 * Is `chainId` a chain this deployment serves?
 *
 * Authoritative source is `vaultAddresses`, not `signingKeys`: `vaultAddresses` is built
 * unconditionally from the CreditVault constant, so its keys are exactly the chains the
 * deployment is wired for, whatever the environment carries. `signingKeys` is env-conditional —
 * an entry exists only when the chain's `ALCHEMY_SIGNING_KEY_*` resolves — so deriving the
 * served set from it would make a chain we serve stop being served the moment its key went
 * missing, which is a different condition with a different answer.
 *
 * Own-property + non-empty-string, so an inherited key (`constructor`, `toString`) cannot be
 * passed off as a served chain by a caller who controls the `:chainId` path parameter.
 */
function servesChain(vaultAddresses: Record<string, string>, chainId: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(vaultAddresses, chainId)) return false
  const vault = vaultAddresses[chainId]
  return typeof vault === 'string' && vault.trim() !== ''
}

// ---------------------------------------------------------------------------
// Internal payload shapes
// ---------------------------------------------------------------------------

/**
 * One CreditVault log, in the shape the Alchemy GraphQL webhook delivers it.
 *
 * Exported because it is also the INPUT CONTRACT of `processVaultLogs`: the RPC reconciler
 * (`src/crystal/DepositReconciler.ts`) synthesises this same shape from `eth_getLogs` output so
 * both entry points feed one processing core — there is no second crediting path.
 */
export interface AlchemyLog {
  account: { address: string }  // GraphQL: logs { account { address } }
  topics: string[]
  data: string
  // GraphQL must select `transaction { hash from }`. `from` is the funding wallet,
  // required to OFAC-screen anonymous deposits (whose sender is not in the event
  // topics, only on the enclosing tx). Optional here so a not-yet-updated Alchemy
  // query degrades to fail-closed screening rather than a crash.
  transaction: { hash: string; from?: string }
}

interface AlchemyBlock {
  number: number
  logs: AlchemyLog[]
}

interface AlchemyPayload {
  type: string
  event?: {
    data?: {
      block?: AlchemyBlock
    }
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleAlchemyWebhook(
  req: AlchemyWebhookRequest,
  deps: AlchemyWebhookDeps,
): Promise<AlchemyWebhookResult> {
  try {
    // 0. Served-chain gate. `:chainId` is a caller-controlled path parameter, and every guard
    // below is keyed on it: the signing key is looked up per chain, and so is the vault address
    // the log filter compares against. A chainId this deployment does not serve resolves neither,
    // so it must be refused here — before any log is inspected — rather than falling through to
    // handlers with no key to check against and no vault to match. Non-specific body: the caller
    // learns the request was refused, not which chains are configured.
    if (!servesChain(deps.vaultAddresses, req.chainId)) {
      log.warn('alchemy webhook refused: unserved chainId', { chainId: req.chainId })
      return { status: 403, body: { success: false, processed: 0, skipped: 0, message: 'Forbidden' } }
    }

    // 1. HMAC signature validation. The served-chain gate above has already established that this
    // deployment is wired for `req.chainId`; a chain we serve must therefore carry a signing key,
    // and its absence is refused rather than treated as an exemption. Every payload reaching this
    // endpoint credits balances, books revenue and inserts arcanum leaves purely on what the body
    // claims, so an unauthenticated request must never reach the processing paths — including when
    // `ALCHEMY_SIGNING_KEY_<chain>` is missing from the environment. Non-specific body, matching
    // the served-chain refusal: the caller learns the request was refused, not why.
    const signingKey = deps.signingKeys[req.chainId]
    if (signingKey) {
      const expected = crypto
        .createHmac('sha256', signingKey)
        .update(req.rawBody)
        .digest('hex')

      const provided = req.signature ?? ''
      const expectedBuf = Buffer.from(expected, 'utf8')
      const providedBuf = Buffer.from(provided, 'utf8')

      const match =
        expectedBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, providedBuf)

      if (!match) {
        return { status: 401, body: { success: false, processed: 0, skipped: 0, message: 'Invalid signature' } }
      }
    } else {
      log.warn('alchemy webhook refused: no signing key configured for served chain', { chainId: req.chainId })
      return { status: 403, body: { success: false, processed: 0, skipped: 0, message: 'Forbidden' } }
    }

    // 2. Payload validation
    const payload = req.body as Partial<AlchemyPayload>
    if (payload.type !== 'GRAPHQL') {
      return { status: 400, body: { success: false, processed: 0, skipped: 0, message: 'Expected type GRAPHQL' } }
    }

    const logs = payload.event?.data?.block?.logs
    if (!Array.isArray(logs)) {
      return { status: 400, body: { success: false, processed: 0, skipped: 0, message: 'Missing event.data.block.logs' } }
    }

    log.info('alchemy webhook received', { chainId: req.chainId, logCount: logs.length })

    // 3. Process each log through the shared core (also used by the RPC reconciler).
    const { processed, skipped } = await processVaultLogs(logs as AlchemyLog[], req.chainId, deps)

    return { status: 200, body: { success: true, processed, skipped } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 500, body: { success: false, processed: 0, skipped: 0, message } }
  }
}

// ---------------------------------------------------------------------------
// Shared processing core
// ---------------------------------------------------------------------------

/**
 * Process a batch of CreditVault logs for one chain — the SINGLE crediting path.
 *
 * Both entry points run through here and share every downstream rule: the vault-address filter,
 * the topic dispatch, pricing, OFAC screening, attribution via `resolveWalletAnima`, `confirmatum`
 * parking for unlinked wallets, revenue booking, and the tx-hash idempotency short-circuit.
 *
 *   • `handleAlchemyWebhook` — logs delivered by Alchemy, admitted by the chain + HMAC gates.
 *   • `reconcileVaultDeposits` (`src/crystal/DepositReconciler.ts`) — logs read back from the
 *     chain over a block window. No HMAC applies there: the evidence is fetched from the RPC by
 *     us rather than posted to us, so the admission gates are the caller's, and everything from
 *     this function down is identical.
 *
 * Callers must pass a chain this deployment serves; the vault-address filter below is the
 * backstop that makes an unserved chain process nothing regardless.
 */
export async function processVaultLogs(
  logs: AlchemyLog[],
  chainId: string,
  deps: AlchemyWebhookDeps,
): Promise<{ processed: number; skipped: number }> {
  const vaultAddress = deps.vaultAddresses[chainId]?.toLowerCase()

  let processed = 0
  let skipped = 0

  for (const entry of logs) {
    const logAddress = entry.account?.address?.toLowerCase()

    log.info('alchemy log', { logAddress, vaultAddress, topic0: entry.topics?.[0] })

    // Skip logs not targeting our vault. Absence on EITHER side is a skip, never a match:
    // a log with no `account.address` and a chain with no vault address are both `undefined`,
    // and `undefined !== undefined` is false — so an equality test alone treats "we know
    // neither address" as "the addresses agree" and admits the log. Require both to be
    // present, then require them to be equal.
    if (!vaultAddress || !logAddress || logAddress !== vaultAddress) {
      skipped++
      continue
    }

    const topic0 = entry.topics?.[0]

    if (topic0 === TOPIC_PAYMENT) {
      const didProcess = await handlePaymentLog(entry, chainId, vaultAddress, deps)
      if (didProcess) {
        processed++
      } else {
        skipped++
      }
    } else if (topic0 === TOPIC_NFT_RECEIVED) {
      const didProcess = await handleNftLog(entry, chainId, deps)
      if (didProcess) {
        processed++
      } else {
        skipped++
      }
    } else if (topic0 === TOPIC_ANON_DEPOSIT) {
      const didProcess = await handleAnonymousDepositLog(entry, chainId, deps)
      if (didProcess) {
        processed++
      } else {
        skipped++
      }
    } else if (topic0 === TOPIC_ERC1155) {
      skipped++
    } else {
      skipped++
    }
  }

  return { processed, skipped }
}

// ---------------------------------------------------------------------------
// Payment event handler
// ---------------------------------------------------------------------------

async function handlePaymentLog(
  entry: AlchemyLog,
  chainId: string,
  vaultAddress: string,
  deps: AlchemyWebhookDeps,
): Promise<boolean> {
  const txHash = entry.transaction.hash

  // Extract indexed params from topics
  // topics[1] = payer address (32-byte padded, last 20 bytes = address)
  const payer = ('0x' + entry.topics[1].slice(-40)).toLowerCase()

  // Decode non-indexed params from data
  const coder = AbiCoder.defaultAbiCoder()
  const [token, amount] = coder.decode(
    ['address', 'uint256', 'uint256', 'uint256'],
    entry.data,
  ) as unknown as [string, bigint, bigint, bigint]

  const valor = BigInt(amount)

  // Idempotency check
  const existing = await deps.deposita.findByHash(txHash, chainId)
  if (existing?.status === 'processatum') {
    return false  // already fully processed — skip
  }

  // OFAC screen the funding wallet BEFORE any credit is issued. A blocked payer's
  // deposit is recorded as `fractum` (no Signum) and quarantined — the funds are
  // detected and auditable, but no credit/value is extended to a sanctioned address.
  const payerVerdict = await deps.sanctions.screen(payer)
  if (!payerVerdict.ok) {
    log.warn('OFAC: payment deposit blocked', { txHash, chainId, payer, reason: payerVerdict.reason })
    await deps.deposita.create({
      chainId,
      transactioHash: txHash,
      ab: payer,
      ad: vaultAddress,
      valor,
      token,        // persist the asset for audit; no usdFmv — quarantined funds recognize no FMV
      confirmationes: 1,
      status: 'fractum',
    })
    return true  // processed (quarantined), not credited
  }

  // Price the deposit ONCE → gross USD FMV. Feeds both the revenue book (gross) and the credit
  // (net). Priced BEFORE the create so the receipt-time basis (token + usdFmv) can be FROZEN onto
  // the Depositum — the retry sweep credits from that persisted basis and never re-prices.
  // Unpriceable → skip both, loudly; the deposit is parked confirmatum for a later retry.
  const usdFmv = await priceDeposit(deps, chainId, token, valor, txHash)

  // Reuse the existing on-chain deposit record if this webhook is a re-delivery of an already-
  // seen (but not-yet-credited) deposit — otherwise a retry would mint a second Depositum (and a
  // second revenue row). `existing` is only 'confirmatum' or 'fractum' here (a 'processatum' one
  // short-circuited above); a stale 'fractum' that now clears OFAC gets a fresh record. A freshly
  // created record freezes the receipt-time basis (token always; usdFmv when priced).
  const depositum = existing?.status === 'confirmatum'
    ? existing
    : await deps.deposita.create({
        chainId,
        transactioHash: txHash,
        ab: payer,
        ad: vaultAddress,
        valor,
        token,
        ...(usdFmv !== null ? { usdFmv } : {}),
        confirmationes: 1,
        status: 'confirmatum',
      })

  // Unpriceable → parked confirmatum (no revenue, no credit — already warned in priceDeposit).
  if (usdFmv === null) return true

  // FREEZE-ON-FIRST-PRICE (review finding). A row first parked UNpriceable (created with
  // `token` but no `usdFmv`) that prices on THIS re-delivery must PERSIST that basis now — exactly as
  // the create path freezes it — so book, credit, and every later delivery share ONE basis. Without it
  // the reuse branch re-prices at fresh spot on each delivery: if this delivery books revenue (locked
  // permanently on depositumId) but its credit then throws, a later re-delivery would credit at a
  // DIFFERENT spot than the booked revenue — minted impetus diverging from recognized revenue
  // (value-conservation break; review amendment). It also lets the sweep heal the row (it skips
  // usdFmv===undefined rows as legacy). Only a reused, never-priced-at-receipt row reaches here with
  // usdFmv undefined: a fresh create was priced (usdFmv set on the row) or returned above (unpriceable).
  if (depositum.usdFmv === undefined) {
    await deps.deposita.update(depositum.id, { usdFmv, token })
    depositum.usdFmv = usdFmv
    depositum.token = token
  }

  // Book USD revenue at RECEIPT (ADR-0013 §2/§4) — a peer of the credit, before the processatum
  // transition, so a store failure leaves the deposit retryable. Recognized regardless of whether
  // the funder's Anima is linked yet; idempotent on depositum.id so re-delivery cannot double-count.
  // Book from the SAME persisted receipt-time basis the credit uses (`depositum.usdFmv ?? usdFmv`),
  // never the fresh spot price: AssetPricer.usdFmv prices at SPOT, so on a re-delivery of the
  // create-succeeded-but-book-failed row (Depositum exists at X1 but no Reditus — record() threw
  // transiently), re-pricing here would insert a fresh Reditus at the drifted spot X2 while the
  // credit mints impetus from the persisted X1 — recognized revenue diverging from the credit basis
  // by the spot drift over the retry window (value-conservation break; review amendment). Booking
  // from the persisted basis is a no-op for fresh rows (depositum.usdFmv was just set to usdFmv) and
  // for already-booked rows (dup-key on depositumId), and heals the book-failed row at X1 to match
  // the credit — mirroring the sweep's re-book (which books from depositum.usdFmv).
  await bookRevenue(deps, { usdFmv: depositum.usdFmv ?? usdFmv, origo: 'crypto', depositumId: depositum.id, token: depositum.token ?? token })

  // Resolve the payer wallet to its account via the auth rail's Persona seam (custos fallback).
  const animaId = await deps.resolveWalletAnima(payer)
  if (!animaId) {
    // NEVER SILENT (noema-027 Fix 2): the deposit is confirmed + revenue-booked but no account owns
    // this wallet yet. Park it loudly — the sweep credits it once the wallet links.
    log.warn('deposit confirmed but unattributed — no account linked to payer wallet', { payer, txHash, valor: valor.toString() })
    return true
  }

  // Linked payer → credit now (idempotency-guarded; the shared helper the sweep also calls).
  // Credit from the PERSISTED receipt-time basis, never the fresh price: revenue was booked at that
  // basis and bookRevenue is idempotent on depositumId, so re-pricing here would mint impetus against a
  // basis that diverges from the booked revenue whenever ETH moved since receipt (value-conservation
  // break; review amendment). `depositum.usdFmv` is ALWAYS set by now — a fresh create priced it, a
  // reused priced-at-receipt row carries it, and a reused unpriceable-at-receipt row was just frozen
  // above (FREEZE-ON-FIRST-PRICE) before this same delivery's book — so `?? usdFmv` is an unreachable
  // type-level fallback, never the live basis. (Same for `depositum.token ?? token`.)
  await creditConfirmedDeposit(deps, {
    depositum,
    usdFmv: depositum.usdFmv ?? usdFmv,
    token: depositum.token ?? token,
    animaId,
    valor,
    txHash,
  })

  return true
}

// ---------------------------------------------------------------------------
// Anonymous deposit handler
// ---------------------------------------------------------------------------

async function handleAnonymousDepositLog(
  entry: AlchemyLog,
  chainId: string,
  deps: AlchemyWebhookDeps,
): Promise<boolean> {
  // topics[1] = commitment (indexed bytes32) — the Poseidon field element
  if (!entry.topics[1]) return false  // malformed log — no indexed commitment
  const commitment = entry.topics[1]  // already 0x-prefixed 32-byte hex

  // Decode non-indexed params: (address token, uint256 amount).
  // NOTE: the arcanum-tree leaf still stores `valor` in raw on-chain units (wei / token-decimals);
  // the anon note's SPEND-side credit conversion is a separate concern (arcanum path). Here we only
  // (a) admit the leaf and (b) book the deposit's USD FMV to the revenue book via the AssetPricer.
  let valor: bigint
  let token: string
  try {
    const [tokenAddr, amount] = AbiCoder.defaultAbiCoder().decode(['address', 'uint256'], entry.data) as unknown as [string, bigint]
    valor = BigInt(amount)
    token = tokenAddr
  } catch {
    return false  // malformed log data — skip rather than 500ing the whole webhook
  }

  // OFAC screen the depositing wallet BEFORE the note is admitted to the tree.
  // The funder address lives on the enclosing transaction (the commitment in the
  // event topics is unlinkable by design); screening here is the only moment it
  // is observable. Fail-CLOSED: if the Alchemy query did not provide `from`, we
  // cannot screen, so we refuse the leaf rather than admit an unscreened note.
  // (Safe: anonymous notes are not yet spendable — see valor-scale note above —
  // so refusing here cannot break a live spend path.)
  const funder = entry.transaction?.from?.toLowerCase()
  if (!funder) {
    log.warn('OFAC: anonymous deposit has no tx.from — cannot screen, refusing leaf', { commitment, txHash: entry.transaction?.hash })
    return false
  }
  const funderVerdict = await deps.sanctions.screen(funder)
  if (!funderVerdict.ok) {
    log.warn('OFAC: anonymous deposit blocked', { commitment, funder, reason: funderVerdict.reason })
    return false
  }

  // Idempotency: commitment is unique per note — skip if already in tree
  const existing = await deps.arcanumTree.findLeaf(commitment)
  if (existing) {
    log.info('arcanum deposit already in tree', { commitment })
    return false
  }

  // Insert into Merkle tree — no animaId, no signum, no ledger entry
  await deps.arcanumTree.insert(commitment, valor)
  log.info('arcanum deposit inserted', { commitment, valor: valor.toString() })

  // Book USD revenue in aggregate (ADR-0013 §7: no anon deposit bypasses the FMV stamp). No
  // depositumId — anon notes have no Depositum; the findLeaf guard above is the re-delivery
  // dedupe, so this runs once per commitment. Anonymity limits per-user reporting, not the top line.
  // (No credit is issued here — the note is spent later via the arcanum path, not a Signum now.)
  const usdFmv = await priceDeposit(deps, chainId, token, valor, `anon:${commitment}`)
  if (usdFmv !== null) {
    await bookRevenue(deps, { usdFmv, origo: 'crypto', token })
  }

  return true
}

// ---------------------------------------------------------------------------
// NFT received event handler
// ---------------------------------------------------------------------------

async function handleNftLog(
  entry: AlchemyLog,
  chainId: string,
  deps: AlchemyWebhookDeps,
): Promise<boolean> {
  const txHash = entry.transaction.hash

  // topics[1] = operator (32-byte padded address)
  // topics[2] = from (previous owner / sender)
  const from = ('0x' + entry.topics[2].slice(-40)).toLowerCase()

  // Decode data: (address token, uint256 tokenId)
  const coder = AbiCoder.defaultAbiCoder()
  const [token, tokenId] = coder.decode(
    ['address', 'uint256'],
    entry.data,
  ) as unknown as [string, bigint]

  // OFAC screen the sender before recording an ownership proof — a Testimonium
  // can confer access, so do not process one from a sanctioned wallet.
  const fromVerdict = await deps.sanctions.screen(from)
  if (!fromVerdict.ok) {
    log.warn('OFAC: NFT-received blocked', { txHash, from, reason: fromVerdict.reason })
    return false
  }

  // Resolve the sender wallet to its account via the same Persona seam the payment path uses
  // (custos fallback). Nothing writes animae.custos for users anymore, so the old findByCustos read
  // skipped every NFT from a linked wallet (noema-027).
  const animaId = await deps.resolveWalletAnima(from)
  if (!animaId) {
    return false  // no linked identity — skip
  }

  await deps.testimonia.create({
    chainId,
    contractus: token,
    tokenId: tokenId.toString(),
    possessor: from,
    animaId,
    genus: 'balanceOf',
    testis: txHash,
    status: 'confirmatum',
  })

  return true
}
