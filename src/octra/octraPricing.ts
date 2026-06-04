// =============================================================================
// octraPricing — µOCT → valor (impetus points)
// =============================================================================
//
// OCT gets NO special treatment. The ONLY OCT-specific step is OCT→USD. The
// USD→valor step is the shared helper (usdToValor / USD_PER_POINT), identical
// to ETH and every ERC-20.
//
//   µOCT ──(÷ 10^OCT_DECIMALS)──> OCT
//        ──(× octUsdRate)────────> grossUsd
//        ──(× OCT_FUNDING_RATE)──> userUsd   (risk haircut, NOT a per-USD discount)
//        ──(shared usdToValor)───> valor (bigint)
//
// v1 SOURCE: admin-set OCT/USD rate. There is no first-party OCT/USD oracle and
// the only real market is a thin Uniswap V4 wOCT/ETH pool. An admin rate is
// auditable and immune to feed manipulation. A DEX-derived TWAP feed is a
// possible v1.x addition (guard-railed) — not built here.
// =============================================================================

import { usdToValor } from '../ledger/rates.js'
import { OCT_DECIMALS } from '../types/octra.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('octra:pricing')

/**
 * Risk haircut applied to OCT deposits. Lower than ETH's because OCT is volatile
 * and illiquid. This is NOT a credit discount — the USD→valor rate is shared and
 * identical across rails. Keep alongside the other token funding rates.
 */
export const OCT_FUNDING_RATE = 0.75

export interface OctraPricingConfig {
  /** Admin-set OCT/USD rate. undefined ⇒ price unavailable (skip-and-retry). */
  octUsdRate?: number
  /** When the admin rate was set (Unix ms). */
  setAtMs?: number
  /** Max age before the rate is considered stale (default 1h). */
  maxStalenessMs?: number
  /** Per-deposit valor ceiling — circuit-breaker against scale/rate errors. */
  maxValorPerDeposit?: bigint
}

export interface OctraPricer {
  /** µOCT → valor. Returns null if no fresh price (caller must skip-and-retry, never guess). */
  priceToValor(amountMicro: bigint, nowMs: number): Promise<{ valor: bigint; octUsdRate: string; fundingRate: string } | null>
}

/** Admin-rate pricer. Built around a single source; no DEX-fetch path in v1. */
export function makeAdminPricer(cfg: OctraPricingConfig): OctraPricer {
  const maxStaleness = cfg.maxStalenessMs ?? 3_600_000

  return {
    async priceToValor(amountMicro, nowMs) {
      if (cfg.octUsdRate == null || cfg.octUsdRate <= 0) {
        log.warn('OCT/USD rate unavailable — skipping (no guess)')
        return null
      }
      if (cfg.setAtMs != null && nowMs - cfg.setAtMs > maxStaleness) {
        log.warn('OCT/USD rate stale — skipping', { ageMs: nowMs - cfg.setAtMs, maxStaleness })
        return null
      }

      // Keep bigint µOCT until the single USD crossing.
      const oct = Number(amountMicro) / 10 ** OCT_DECIMALS
      const grossUsd = oct * cfg.octUsdRate
      const userUsd = grossUsd * OCT_FUNDING_RATE
      const valor = usdToValor(userUsd) // floor(userUsd / USD_PER_POINT), shared

      if (valor < 0n) return null

      if (cfg.maxValorPerDeposit != null && valor > cfg.maxValorPerDeposit) {
        // Circuit-breaker: a single oversized mint is held, not auto-minted.
        log.error('valor exceeds per-deposit ceiling — HELD for operator review', {
          valor: valor.toString(),
          ceiling: cfg.maxValorPerDeposit.toString(),
          amountMicro: amountMicro.toString(),
        })
        return null
      }

      return {
        valor,
        octUsdRate: String(cfg.octUsdRate),
        fundingRate: String(OCT_FUNDING_RATE),
      }
    },
  }
}
