// ETH price feed — Alchemy prices/v1 API with 30s cache.
// Same source as priceFeedService.js in the legacy JS layer.

const CACHE_TTL_MS = 30_000

let cached: { price: number; at: number } | null = null

export async function fetchEthUsdPrice(alchemyApiKey: string): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.price

  const url = `https://api.g.alchemy.com/prices/v1/${alchemyApiKey}/tokens/by-symbol?symbols=ETH&currency=USD`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) throw new Error(`Alchemy price API ${res.status}`)

    const json = await res.json() as { data?: Array<{ symbol: string; prices?: Array<{ currency: string; value: string }> }> }
    const value = json.data?.find(d => d.symbol === 'ETH')?.prices?.find(p => p.currency === 'usd')?.value

    if (!value) throw new Error('ETH price not found in Alchemy response')

    const price = parseFloat(value)
    cached = { price, at: Date.now() }
    return price
  } catch (err) {
    clearTimeout(timeout)
    if (cached) return cached.price  // serve stale on transient failure
    throw err
  }
}

// How many impetus credits equal 1 USD — matches USD_CREDIT_TO_POINTS_RATE in legacy JS.
export const CREDITS_PER_USD = Math.round(1 / 0.00037)  // ≈ 2703

/**
 * Convert a wei amount to impetus credits at the current ETH price.
 * Returns 0n if price is unavailable.
 */
export async function weiToCredits(wei: bigint, alchemyApiKey: string): Promise<bigint> {
  const ethUsd = await fetchEthUsdPrice(alchemyApiKey)
  // credits = wei * ethUsd * CREDITS_PER_USD / 1e18
  // Use integer arithmetic: multiply first to preserve precision
  return (wei * BigInt(Math.round(ethUsd * CREDITS_PER_USD))) / (10n ** 18n)
}
