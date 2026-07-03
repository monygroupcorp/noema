// =============================================================================
// x402Pricing — crystal impetus quote → x402 USDC PaymentRequirements.
// =============================================================================
//
// A capability's price starts as a crystal quote in impetus points (the same
// `quote()` an internal run uses). Here we convert impetus → USD (the canonical
// IMPETUS_USD_RATE), apply the platform markup, and shape the x402 `accepts`
// requirements + a human-facing quote. USDC has 6 decimals.

import { IMPETUS_USD_RATE } from '../ledger/rates.js'
import type { PaymentRequirements, X402Accept, X402Quote } from '../types/x402.js'

/** Payment-rail config. Defaults target USDC on Base (eip155:8453). */
export interface X402Config {
  /** CAIP-2 network id. */
  network: string
  /** Token contract (USDC). */
  asset: string
  /** Where payments land (the platform receiver). */
  payTo: string
  /** Platform markup in basis points on top of the raw impetus cost (2000 = 20%). */
  markupBps: number
  maxTimeoutSeconds: number
  tokenName: string
  tokenVersion: string
}

export const DEFAULT_X402_CONFIG: Omit<X402Config, 'payTo'> = {
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
  markupBps: 2000,
  maxTimeoutSeconds: 300,
  tokenName: 'USD Coin',
  tokenVersion: '2',
}

/** USD (float) → USDC atomic units (6 decimals), rounded up so we never under-charge. */
export function usdToAtomic(usd: number): string {
  return BigInt(Math.ceil(usd * 1e6)).toString()
}

/** Build the cost breakdown from an impetus quote. */
export function buildQuote(impetus: bigint, cfg: X402Config): X402Quote {
  const baseCostUsd = Number(impetus) * IMPETUS_USD_RATE
  const markupUsd = (baseCostUsd * cfg.markupBps) / 10000
  const totalCostUsd = baseCostUsd + markupUsd
  return {
    baseCostUsd,
    markupUsd,
    totalCostUsd,
    totalCostAtomic: usdToAtomic(totalCostUsd),
    currency: 'USDC',
    network: cfg.network,
    payTo: cfg.payTo,
  }
}

/** The single `exact`-scheme accept derived from a quote. */
export function acceptFor(quote: X402Quote, cfg: X402Config): X402Accept {
  return {
    scheme: 'exact',
    network: cfg.network,
    asset: cfg.asset,
    amount: quote.totalCostAtomic,
    payTo: cfg.payTo,
    maxTimeoutSeconds: cfg.maxTimeoutSeconds,
    extra: { name: cfg.tokenName, version: cfg.tokenVersion },
  }
}

/** The full 402 `paymentRequired` body. */
export function buildPaymentRequirements(
  quote: X402Quote,
  cfg: X402Config,
  resource: { url: string; description: string },
): PaymentRequirements {
  return {
    x402Version: 2,
    resource: { url: resource.url, description: resource.description, mimeType: 'application/json' },
    accepts: [acceptFor(quote, cfg)],
  }
}
