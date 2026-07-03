import { AbiCoder } from 'ethers'
import crypto from 'node:crypto'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('alchemy-webhook')
import type { Depositorum, Petitionum, Testimoniorum } from '../../types/catena.js'
import type { Signorum } from '../../types/significandi.js'
import type { Redituum, RevenueOrigo } from '../../types/reditus.js'
import type { AssetPricer } from '../../crystal/AssetPricer.js'
import { usdMicroToImpetus } from '../../ledger/rates.js'
import { fundingBps, applyFundingBps } from '../../ledger/depositFunding.js'
import type { AnimaStore } from '../../types/anima.js'
import type { ArcanumTreeStore } from '../../arcanum/ArcanumTree.js'
import type { SanctionsScreen } from '../../compliance/SanctionsScreen.js'

// ---------------------------------------------------------------------------
// Known CreditVault event topic hashes (pre-computed)
// keccak256 of the canonical event signature
// ---------------------------------------------------------------------------

const TOPIC_PAYMENT          = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_NFT_RECEIVED     = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const TOPIC_ERC1155          = '0x72d4fe4bd1118f3ff78811cc440bf989b6e515157dab466890aaed7c87ffb78c'
// keccak256("AnonymousDeposit(bytes32,address,uint256)")
const TOPIC_ANON_DEPOSIT     = '0x879aadcc0b21da25bde4bcf799cb142a02d0135f66a1328fef12c8b78636c58d'

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
  animae: AnimaStore
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
  deps: AlchemyWebhookDeps,
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

export interface AlchemyWebhookRequest {
  body: unknown
  rawBody: string
  signature?: string
  /** Chain ID from the URL parameter (e.g. '1' for mainnet, '8453' for Base). */
  chainId: string
}

export interface AlchemyWebhookResult {
  status: 200 | 400 | 401 | 500
  body: { success: boolean; processed: number; skipped: number; message?: string }
}

// ---------------------------------------------------------------------------
// Internal payload shapes
// ---------------------------------------------------------------------------

interface AlchemyLog {
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
    // 1. HMAC signature validation — skip if no key configured for this chain (dev mode)
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

    const vaultAddress = deps.vaultAddresses[req.chainId]?.toLowerCase()

    let processed = 0
    let skipped = 0

    log.info('alchemy webhook received', { chainId: req.chainId, logCount: logs.length, vaultAddress })

    // 3. Process each log
    for (const entry of logs as AlchemyLog[]) {
      const logAddress = entry.account?.address?.toLowerCase()

      log.info('alchemy log', { logAddress, vaultAddress, topic0: entry.topics?.[0] })

      // Skip logs not targeting our vault
      if (logAddress !== vaultAddress) {
        skipped++
        continue
      }

      const topic0 = entry.topics?.[0]

      if (topic0 === TOPIC_PAYMENT) {
        const didProcess = await handlePaymentLog(entry, req.chainId, vaultAddress, deps)
        if (didProcess) {
          processed++
        } else {
          skipped++
        }
      } else if (topic0 === TOPIC_NFT_RECEIVED) {
        const didProcess = await handleNftLog(entry, req.chainId, deps)
        if (didProcess) {
          processed++
        } else {
          skipped++
        }
      } else if (topic0 === TOPIC_ANON_DEPOSIT) {
        const didProcess = await handleAnonymousDepositLog(entry, req.chainId, deps)
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

    return { status: 200, body: { success: true, processed, skipped } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 500, body: { success: false, processed: 0, skipped: 0, message } }
  }
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
      confirmationes: 1,
      status: 'fractum',
    })
    return true  // processed (quarantined), not credited
  }

  // Reuse the existing on-chain deposit record if this webhook is a re-delivery of an already-
  // seen (but not-yet-credited) deposit — otherwise a retry would mint a second Depositum (and a
  // second revenue row). `existing` is only 'confirmatum' or 'fractum' here (a 'processatum' one
  // short-circuited above); a stale 'fractum' that now clears OFAC gets a fresh record.
  const depositum = existing?.status === 'confirmatum'
    ? existing
    : await deps.deposita.create({
        chainId,
        transactioHash: txHash,
        ab: payer,
        ad: vaultAddress,
        valor,
        confirmationes: 1,
        status: 'confirmatum',
      })

  // Price the deposit ONCE → gross USD FMV. Feeds both the revenue book (gross) and the credit
  // (net). Unpriceable → skip both, loudly; the deposit is parked confirmatum for a later retry
  // (never credited at a bogus/zero value).
  const usdFmv = await priceDeposit(deps, chainId, token, valor, txHash)

  // Book USD revenue at RECEIPT (ADR-0013 §2/§4) — a peer of the credit, before the processatum
  // transition, so a store failure leaves the deposit retryable. Recognized regardless of whether
  // the funder's Anima is linked yet; idempotent on depositum.id so re-delivery cannot double-count.
  if (usdFmv !== null) {
    await bookRevenue(deps, { usdFmv, origo: 'crypto', depositumId: depositum.id, token })
  }

  // Look up anima by payer wallet
  const anima = await deps.animae.findByCustos(payer)

  if (anima && usdFmv !== null) {
    // Credit spendable impetus = the NET buy amount (gross FMV × per-asset funding rate, at the
    // canonical $0.000337). NOT the raw wei. Sub-point dust → skip (parked, not a zero-value credit).
    const impetus = creditImpetus(usdFmv, token)
    if (impetus <= 0n) {
      log.warn('deposit priced but below one impetus — parked uncredited', { txHash, token, usdFmv: usdFmv.toString() })
    } else {
      const signum = await deps.signorum.issue({
        forma: 'eth',            // "on-chain CreditVault deposit" — reused across assets; valor is impetus
        animaId: anima.id,
        valor: impetus,
        auctor: 'alchemy-webhook',
        testis: txHash,
      })

      // Mark Depositum as processatum
      await deps.deposita.update(depositum.id, {
        status: 'processatum',
        animaId: anima.id,
        signumId: signum.id,
        processatum: new Date(),
      })

      // Check for open magic-amount Petitio — matched on the on-chain amount (wei), not credits
      const petitio = await deps.petitiones.findExpectans(anima.id)
      if (petitio && petitio.valuta === valor) {
        await deps.petitiones.update(petitio.id, {
          status: 'confirmata',
          depositumId: depositum.id,
          walletAddress: payer,
          confirmata: new Date(),
        })
      }
    }
  }
  // If no anima (or unpriced): Depositum stays 'confirmatum' — credit issued on wallet link / retry

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

  // Look up anima by sender wallet
  const anima = await deps.animae.findByCustos(from)
  if (!anima) {
    return false  // no linked identity — skip
  }

  await deps.testimonia.create({
    chainId,
    contractus: token,
    tokenId: tokenId.toString(),
    possessor: from,
    animaId: anima.id,
    genus: 'balanceOf',
    testis: txHash,
    status: 'confirmatum',
  })

  return true
}
