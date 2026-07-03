// ETH price feed — Alchemy prices/v1 API with 30s cache.
// Same source as priceFeedService.js in the legacy JS layer.

import { usdMicroToImpetus } from '../ledger/rates.js'
import { fundingBps, applyFundingBps } from '../ledger/depositFunding.js'

const CACHE_TTL_MS = 30_000

/** Zero address = native ETH — the asset an anonymous CreditVault note is denominated in. */
const NATIVE_ETH = '0x0000000000000000000000000000000000000000'

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

/**
 * Convert a wei amount (an anonymous ETH note) to spendable impetus credits — the anon
 * counterpart to the identified deposit's `creditImpetus` (alchemyWebhook). It is the NET buy:
 *
 *   grossMicroUsd = wei × ETH/USD                    (the note's gross USD FMV, already booked as
 *                                                      revenue at anon-deposit time — ADR-0013 §7)
 *   net           = grossMicroUsd × fundingBps(ETH)  (the funding-rate haircut, 0.70 default)
 *   credits       = net / MICRO_USD_PER_IMPETUS      (CANONICAL $0.000337 — 337 µUSD/impetus)
 *
 * This replaces the former `CREDITS_PER_USD ≈ 2703` (the legacy 0.00037 typo rate, and with NO
 * funding haircut) so the anon and identified deposit-credit paths agree. Returns 0n for a
 * non-positive amount or sub-point dust; throws (fail-closed) if the price is wholly unavailable,
 * so no note is ever minted at a wrong/zero valuation.
 */
export async function weiToCredits(wei: bigint, alchemyApiKey: string, fetchFn?: FetchLike): Promise<bigint> {
  if (wei <= 0n) return 0n
  const ethUsd = await fetchEthUsdPrice(alchemyApiKey, fetchFn)
  if (!(ethUsd > 0)) return 0n
  // grossMicroUsd = wei × (USD/ETH × 1e6 µUSD/USD) / 1e18 wei/ETH — integer-first for precision.
  const grossMicroUsd = (wei * BigInt(Math.round(ethUsd * 1_000_000))) / (10n ** 18n)
  return usdMicroToImpetus(applyFundingBps(grossMicroUsd, fundingBps(NATIVE_ETH)))
}
