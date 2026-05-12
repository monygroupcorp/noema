import { AbiCoder } from 'ethers'
import crypto from 'node:crypto'
import type { Depositorum, Petitionum, Testimoniorum } from '../../types/catena.js'
import type { Signorum } from '../../types/significandi.js'
import type { AnimaStore } from '../../types/anima.js'

// ---------------------------------------------------------------------------
// Known CreditVault event topic hashes (pre-computed)
// ---------------------------------------------------------------------------

const TOPIC_PAYMENT      = '0x1266483a1ee1398eb3bf0eb2a3ccbce80bffd031a593fa1b9dad6272b40e3121'
const TOPIC_NFT_RECEIVED = '0x5302f22244b41ec8834e043efcb52482aa21c2a460a047422c4ae3df50bd44a9'
const TOPIC_ERC1155      = '0x72d4fe4bd1118f3ff78811cc440bf989b6e515157dab466890aaed7c87ffb78c'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface AlchemyWebhookDeps {
  deposita: Depositorum
  signorum: Signorum
  petitiones: Petitionum
  testimonia: Testimoniorum
  animae: AnimaStore
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
  address: string
  topics: string[]
  data: string
  transaction: { hash: string }
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

    // 3. Process each log
    for (const log of logs as AlchemyLog[]) {
      const logAddress = log.address?.toLowerCase()

      // Skip logs not targeting our vault
      if (logAddress !== vaultAddress) {
        skipped++
        continue
      }

      const topic0 = log.topics?.[0]

      if (topic0 === TOPIC_PAYMENT) {
        const didProcess = await handlePaymentLog(log, req.chainId, vaultAddress, deps)
        if (didProcess) {
          processed++
        } else {
          skipped++
        }
      } else if (topic0 === TOPIC_NFT_RECEIVED) {
        const didProcess = await handleNftLog(log, req.chainId, deps)
        if (didProcess) {
          processed++
        } else {
          skipped++
        }
      } else if (topic0 === TOPIC_ERC1155) {
        // ERC1155 — log and skip for now
        skipped++
      } else {
        // Unknown topic
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
  log: AlchemyLog,
  chainId: string,
  vaultAddress: string,
  deps: AlchemyWebhookDeps,
): Promise<boolean> {
  const txHash = log.transaction.hash

  // Extract indexed params from topics
  // topics[1] = payer address (32-byte padded, last 20 bytes = address)
  const payer = ('0x' + log.topics[1].slice(-40)).toLowerCase()

  // Decode non-indexed params from data
  const coder = AbiCoder.defaultAbiCoder()
  const [token, amount] = coder.decode(
    ['address', 'uint256', 'uint256', 'uint256'],
    log.data,
  ) as [string, bigint, bigint, bigint]

  const valor = BigInt(amount)

  // Idempotency check
  const existing = await deps.deposita.findByHash(txHash, chainId)
  if (existing?.status === 'processatum') {
    return false  // already fully processed — skip
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
// NFT received event handler
// ---------------------------------------------------------------------------

async function handleNftLog(
  log: AlchemyLog,
  chainId: string,
  deps: AlchemyWebhookDeps,
): Promise<boolean> {
  const txHash = log.transaction.hash

  // topics[1] = operator (32-byte padded address)
  // topics[2] = from (previous owner / sender)
  const from = ('0x' + log.topics[2].slice(-40)).toLowerCase()

  // Decode data: (address token, uint256 tokenId)
  const coder = AbiCoder.defaultAbiCoder()
  const [token, tokenId] = coder.decode(
    ['address', 'uint256'],
    log.data,
  ) as [string, bigint]

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
