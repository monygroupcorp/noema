import { AbiCoder } from 'ethers'
import crypto from 'node:crypto'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('alchemy-webhook')
import type { Depositorum, Petitionum, Testimoniorum } from '../../types/catena.js'
import type { Signorum } from '../../types/significandi.js'
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
   * USD price of ETH, used for future conversion to impetus points.
   * Stored but not yet used for valor conversion — valor is stored in wei.
   */
  ethPriceUsd: number
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
        const didProcess = await handleAnonymousDepositLog(entry, deps)
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

  // Create Depositum
  const depositum = await deps.deposita.create({
    chainId,
    transactioHash: txHash,
    ab: payer,
    ad: vaultAddress,
    valor,
    confirmationes: 1,
    status: 'confirmatum',
  })

  // Look up anima by payer wallet
  const anima = await deps.animae.findByCustos(payer)

  if (anima) {
    // Issue Signum
    const signum = await deps.signorum.issue({
      forma: 'eth',
      animaId: anima.id,
      valor,
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

    // Check for open magic-amount Petitio
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
  // If no anima: Depositum stays in 'confirmatum' — credit issued on wallet link

  return true
}

// ---------------------------------------------------------------------------
// Anonymous deposit handler
// ---------------------------------------------------------------------------

async function handleAnonymousDepositLog(
  entry: AlchemyLog,
  deps: AlchemyWebhookDeps,
): Promise<boolean> {
  // topics[1] = commitment (indexed bytes32) — the Poseidon field element
  if (!entry.topics[1]) return false  // malformed log — no indexed commitment
  const commitment = entry.topics[1]  // already 0x-prefixed 32-byte hex

  // Decode non-indexed params: (address token, uint256 amount).
  // NOTE: valor is stored in raw on-chain units (wei for ETH, token-decimals for ERC20).
  // The spend path compares this to reservation in impetus credits — they are not yet
  // on the same scale. This is safe to deploy but anonymous notes cannot be spent until
  // an ETH→credits conversion is wired into this handler (see deps.ethPriceUsd).
  let valor: bigint
  try {
    const [, amount] = AbiCoder.defaultAbiCoder().decode(['address', 'uint256'], entry.data) as unknown as [string, bigint]
    valor = BigInt(amount)
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
