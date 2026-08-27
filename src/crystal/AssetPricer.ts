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
//   • a COIN-LISTED asset (`COINGECKO_ASSETS`) → CoinGecko `simple/price`, by coin id
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
 * Assets priced from their COIN listing rather than from a per-address token feed, keyed
 * chainId → lowercase token address.
 *
 * Why a second source exists at all: the Alchemy price and metadata endpoints resolve a token by
 * its contract ADDRESS on a given network. An asset that is bridged onto a chain has an address
 * there that those endpoints do not know, and they answer 400 for it — for the price and for the
 * decimals alike. The coin itself is listed and priced chain-independently, so the mapping from
 * our chain's address to the coin id is ours to state, which is exactly what the earlier
 * implementation's price feed did for this asset. `decimals` is carried here for the same reason:
 * the metadata lookup is unavailable for these addresses, and the value is a fixed property of
 * the deployed contract, not a per-run observation.
 *
 * This is an EXACT-ADDRESS ALLOWLIST, deliberately, not a fallback for anything the token feed
 * cannot price: an unknown token stays unpriceable and its deposit stays parked. Adding a chain
 * or an asset here is a decision, and it is made by editing this map.
 */
export const COINGECKO_ASSETS: Record<string, Record<string, { coinId: string; decimals: number }>> = {
  // Mainnet: the house token, bridged in, listed as `station-this`. Six decimals, read from the
  // deployed contract.
  '1': {
    '0x98ed411b8cf8536657c660db8aa55d9d4baaf820': { coinId: 'station-this', decimals: 6 },
  },
}

const COINGECKO_SIMPLE_PRICE = 'https://api.coingecko.com/api/v3/simple/price'
/** Bounded per-attempt timeout, and at most this many attempts, mirroring the earlier price feed. */
const COINGECKO_TIMEOUT_MS = 10_000
const COINGECKO_ATTEMPTS = 2

/**
 * A per-asset USD FMV oracle. `usdFmv` returns the micro-USD value of `amountRaw` base units
 * (wei for ETH, token-decimals for ERC-20) of the asset, at spot — or `null` if unpriceable.
 */
export interface AssetPricer {
  usdFmv(chainId: number | string, tokenAddress: string, amountRaw: bigint): Promise<bigint | null>
}

/**
 * Scale a float USD price to an exact bigint of PICO-USD (1e-12 USD) per whole token.
 *
 * The intermediate is pico rather than micro because a per-token price can be far below one
 * micro-USD: an asset quoted at $0.00002266 is 22.66 micro-USD per token, and rounding the price
 * itself to whole micro-USD before multiplying by the amount moves the FMV of a large token
 * balance by more than a percent. Carrying six extra digits through the multiply and dividing at
 * the end keeps that error off the deposit basis. Prices at or above a dollar are unaffected —
 * the same product, computed with more digits.
 *
 * `toFixed(12)` rather than `Math.round(price * 1e12)`: the latter pushes a large price past the
 * double's exact-integer range, and this must stay exact for every price the feeds return.
 */
function priceToPicoUsdPerToken(priceUsd: number): bigint {
  const [whole, frac = ''] = priceUsd.toFixed(12).split('.')
  return BigInt(whole + frac.padEnd(12, '0'))
}

/** micro-USD = amountRaw × (pico-USD per whole token) / (10^decimals × 1e6). Floors. */
function toMicroUsd(amountRaw: bigint, priceUsd: number, decimals: number): bigint {
  if (!(priceUsd > 0) || amountRaw <= 0n) return 0n
  return (amountRaw * priceToPicoUsdPerToken(priceUsd)) / (10n ** BigInt(decimals) * 1_000_000n)
}

/**
 * Alchemy-backed pricer. `fetchFn` is injectable for testing (defaults to global fetch). A small
 * per-instance metadata/price cache keeps a burst of deposits from hammering the API.
 */
export class AlchemyPricer implements AssetPricer {
  private readonly meta = new Map<string, { decimals: number; at: number }>()
  private readonly erc20Price = new Map<string, { price: number; at: number }>()
  private readonly coinPrice = new Map<string, { price: number; at: number }>()
  private readonly ttlMs = 30_000

  constructor(private readonly apiKey: string, private readonly fetchFn: FetchLike = fetch as unknown as FetchLike) {}

  async usdFmv(chainId: number | string, tokenAddress: string, amountRaw: bigint): Promise<bigint | null> {
    const token = tokenAddress.toLowerCase()
    try {
      if (token === NATIVE_ETH) {
        const priceUsd = await fetchEthUsdPrice(this.apiKey, this.fetchFn)
        return priceUsd > 0 ? toMicroUsd(amountRaw, priceUsd, 18) : null
      }
      // Coin-listed asset (exact-address allowlist). Priced from the coin's own listing, at the
      // decimals the map states, and NEVER from the per-address token feed that cannot see it.
      const listed = COINGECKO_ASSETS[String(chainId)]?.[token]
      if (listed) {
        const priceUsd = await this.coingeckoPriceUsd(listed.coinId)
        const micro = priceUsd === null ? 0n : toMicroUsd(amountRaw, priceUsd, listed.decimals)
        // NEVER A SILENT ZERO. An unreachable listing, an absent price and a price too small to
        // register against this amount all leave `micro` at zero, and zero is not a valuation —
        // it is the absence of one. Returning it would book zero revenue and mint zero credit
        // against a real deposit; returning null parks the deposit for a later, priced attempt.
        return micro > 0n ? micro : null
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

  /**
   * Spot USD price for one whole unit of a listed coin, or `null` when this run cannot obtain one.
   *
   * Bounded exactly as the earlier price feed was: a per-attempt abort timeout and at most
   * `COINGECKO_ATTEMPTS` attempts, then give up. Successes are cached for the same TTL the token
   * feed uses, so a burst of deposits makes one request.
   *
   * A failure returns `null` and NEVER a stale cached price. A cache entry past its TTL is a price
   * from an earlier moment, and a deposit's basis is its receipt-time value — serving the old
   * number would book revenue and mint credit at a price that was not the price. The caller parks
   * the deposit instead, and the retry sweep prices it once the source answers again.
   */
  private async coingeckoPriceUsd(coinId: string): Promise<number | null> {
    const hit = this.coinPrice.get(coinId)
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.price

    const url = `${COINGECKO_SIMPLE_PRICE}?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`
    for (let attempt = 1; attempt <= COINGECKO_ATTEMPTS; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS)
      try {
        const res = await this.fetchFn(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`CoinGecko simple/price ${res.status}`)
        const json = await res.json() as Record<string, { usd?: unknown } | undefined>
        const price = json[coinId]?.usd
        if (typeof price !== 'number' || !(price > 0)) {
          log.warn('asset-pricer: coin listing carries no usable USD price', { coinId })
          return null
        }
        this.coinPrice.set(coinId, { price, at: Date.now() })
        return price
      } catch (err) {
        if (attempt === COINGECKO_ATTEMPTS) {
          log.warn('asset-pricer: coin price lookup failed', { coinId, attempts: attempt, error: String(err) })
          return null
        }
      } finally {
        clearTimeout(timer)
      }
    }
    return null
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
