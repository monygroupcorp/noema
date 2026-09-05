// ETH price feed — Alchemy prices/v1 API with 30s cache.
// Same source as priceFeedService.js in the legacy JS layer.

const CACHE_TTL_MS = 30_000

let cached: { price: number; at: number } | null = null

/** A fetch-shaped fn — injectable so callers/tests can supply a fake without hitting the network. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export async function fetchEthUsdPrice(alchemyApiKey: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.price

  const url = `https://api.g.alchemy.com/prices/v1/${alchemyApiKey}/tokens/by-symbol?symbols=ETH&currency=USD`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetchFn(url, { signal: controller.signal })
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
