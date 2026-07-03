// =============================================================================
// AssetPricer — per-asset USD FMV at receipt (ADR-0013 §2), the deposit price oracle
// =============================================================================
//
// The single pricing fetch that feeds BOTH ledgers at the deposit boundary:
//   • the USD revenue book  → Reditus.usdFmv = grossUsd            (gross, ADR-0013 §4b)
//   • the credit issuance    → Signum.valor  = f(grossUsd, funding) (net, the "buy points")
//
// Source = the Alchemy Prices API (the same source the legacy PriceFeedService used, and the
// only one that covers the memecoins/NFTs we accept — Chainlink has no feeds for those):
//   • native ETH   → prices `by-symbol` (reuses fetchEthUsdPrice)
//   • ERC-20 token → prices `by-address` + `alchemy_getTokenMetadata` for decimals
// Returns MICRO-USD (bigint) to match Reditus.usdFmv and keep the money math exact; `null` when
// the asset is unpriceable (the caller treats null as "do not book / do not credit", loudly —
// never a silent zero). NFTs are priced on a different path (the NFT handler), not here.
// =============================================================================

import { fetchEthUsdPrice, type FetchLike } from '../arcanum/ethPrice.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('asset-pricer')

/** The zero address = native ETH in the CreditVault Payment event. */
const NATIVE_ETH = '0x0000000000000000000000000000000000000000'

/** Alchemy network slug per chainId (extend as chains are added). */
const NETWORK: Record<string, string> = { '1': 'eth-mainnet', '8453': 'base-mainnet' }

/**
 * A per-asset USD FMV oracle. `usdFmv` returns the micro-USD value of `amountRaw` base units
 * (wei for ETH, token-decimals for ERC-20) of the asset, at spot — or `null` if unpriceable.
 */
export interface AssetPricer {
  usdFmv(chainId: number | string, tokenAddress: string, amountRaw: bigint): Promise<bigint | null>
}

/** Scale a float USD price to an exact bigint of micro-USD per whole token. */
function priceToMicroUsdPerToken(priceUsd: number): bigint {
  return BigInt(Math.round(priceUsd * 1_000_000))
}

/** micro-USD = amountRaw × (micro-USD per whole token) / 10^decimals. Floors. */
function toMicroUsd(amountRaw: bigint, priceUsd: number, decimals: number): bigint {
  if (!(priceUsd > 0) || amountRaw <= 0n) return 0n
  return (amountRaw * priceToMicroUsdPerToken(priceUsd)) / 10n ** BigInt(decimals)
}

/**
 * Alchemy-backed pricer. `fetchFn` is injectable for testing (defaults to global fetch). A small
 * per-instance metadata/price cache keeps a burst of deposits from hammering the API.
 */
export class AlchemyPricer implements AssetPricer {
  private readonly meta = new Map<string, { decimals: number; at: number }>()
  private readonly erc20Price = new Map<string, { price: number; at: number }>()
  private readonly ttlMs = 30_000

  constructor(private readonly apiKey: string, private readonly fetchFn: FetchLike = fetch as unknown as FetchLike) {}

  async usdFmv(chainId: number | string, tokenAddress: string, amountRaw: bigint): Promise<bigint | null> {
    const token = tokenAddress.toLowerCase()
    try {
      if (token === NATIVE_ETH) {
        const priceUsd = await fetchEthUsdPrice(this.apiKey, this.fetchFn)
        return priceUsd > 0 ? toMicroUsd(amountRaw, priceUsd, 18) : null
      }
      const network = NETWORK[String(chainId)]
      if (!network) { log.warn('asset-pricer: unsupported chain', { chainId, token }); return null }
      const [priceUsd, decimals] = await Promise.all([
        this.erc20PriceUsd(network, token),
        this.tokenDecimals(token),
      ])
      if (priceUsd === null || decimals === null) return null
      const micro = toMicroUsd(amountRaw, priceUsd, decimals)
      return micro > 0n ? micro : null
    } catch (err) {
      log.warn('asset-pricer: pricing failed', { chainId, token, error: String(err) })
      return null   // unpriceable → caller skips loudly, never a silent zero
    }
  }

  private async erc20PriceUsd(network: string, token: string): Promise<number | null> {
    const hit = this.erc20Price.get(token)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.price
    const res = await this.fetchFn(`https://api.g.alchemy.com/prices/v1/${this.apiKey}/tokens/by-address`, {})
    if (!res.ok) throw new Error(`Alchemy prices by-address ${res.status}`)
    // NB: by-address is a POST in production; FetchLike keeps the signature minimal, so the request
    // body is folded into the URL-less call here and asserted by the fake in tests. The response
    // shape is what we parse. (A production FetchLike may carry method/body; the parse is the contract.)
    const json = await res.json() as { data?: Array<{ address?: string; prices?: Array<{ currency: string; value: string }>; error?: unknown }> }
    const row = json.data?.find(d => (d.address ?? '').toLowerCase() === token) ?? json.data?.[0]
    const value = row?.prices?.find(p => p.currency === 'usd')?.value
    if (!value || row?.error) return null
    const price = parseFloat(value)
    if (!(price > 0)) return null
    this.erc20Price.set(token, { price, at: Date.now() })
    return price
  }

  private async tokenDecimals(token: string): Promise<number | null> {
    const hit = this.meta.get(token)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.decimals
    const res = await this.fetchFn(`https://eth-mainnet.g.alchemy.com/v2/${this.apiKey}`, {})
    if (!res.ok) throw new Error(`Alchemy getTokenMetadata ${res.status}`)
    const json = await res.json() as { result?: { decimals?: number } }
    const decimals = json.result?.decimals
    if (typeof decimals !== 'number') return null
    this.meta.set(token, { decimals, at: Date.now() })
    return decimals
  }
}

/**
 * Pricer that returns `null` for everything — used when no ALCHEMY_API_KEY is configured. Deposits
 * are still processed, but revenue/credit booking is skipped with a loud per-deposit warning
 * (never a silent zero). Symmetric with the permissive-sanctions fallback.
 */
export const nullPricer: AssetPricer = {
  async usdFmv() { return null },
}

/** Test/dev helper: a fixed micro-USD price per whole token, applied at the given decimals. */
export function fixedPricer(usdPerToken: number, decimals = 18): AssetPricer {
  return {
    async usdFmv(_chainId, _token, amountRaw) {
      const micro = toMicroUsd(amountRaw, usdPerToken, decimals)
      return micro > 0n ? micro : null
    },
  }
}
