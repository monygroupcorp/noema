// =============================================================================
// ScanFeeCharger — forward the per-publish safety-scan cost to the publisher (spec §7)
// =============================================================================
//
// The authoritative CSAM classifier (Thorn) bills us PER SCAN, and only on PUBLIC
// publishes of router-flagged items (spec §7 — a small fraction of publishes). We
// forward that cost to the publisher as a per-publish scan fee. The gate reports a
// scan as `billable` only when it actually invoked the paid classifier, so:
//   - pre-Thorn (no classifier wired) → nothing is billable → no fee (correct: we paid
//     nothing);
//   - post-Thorn → only router-sexual public items reach the classifier → only those bill.
// A cache hit (identical bytes, spec §7 verdict cache) never bills — no scan ran.
//
// The amount is a CONFIG KNOB (env) until Thorn quotes. This is a seam: the ledger-
// backed impl below issues a debit signum against the publisher; the container wires
// it with the configured amount. Unset/zero amount ⇒ no charge.
// =============================================================================

import type { Editio } from '../types/editio.js'
import type { Signorum, SignumForma } from '../types/significandi.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('publish:scanfee')

/** Charges the configured per-scan fee to a publisher for one billable scan. */
export interface ScanFeeCharger {
  charge(by: Editio['by'], editioId: string): Promise<void>
}

/**
 * Ledger-backed charger: issues a negative-valor signum against the publisher (an
 * `integer` debit for an identified anima; an `arcanum` debit keyed by commitment for
 * the anonymous side — the same forma split the spend path uses). Amount ≤ 0 ⇒ no-op.
 *
 * LIVE-UNVERIFIED (like the other ledger seams): the charge shape is real but has not
 * been exercised on staging. A charge failure MUST NOT block the publish decision —
 * callers treat it best-effort (a missed fee is recoverable; a blocked safe publish is not).
 */
export function ledgerScanFeeCharger(deps: { signorum: Pick<Signorum, 'issue'>; amount: bigint }): ScanFeeCharger {
  return {
    async charge(by: Editio['by'], editioId: string): Promise<void> {
      if (deps.amount <= 0n) return
      const forma: SignumForma = 'animaId' in by ? 'integer' : 'arcanum'
      const base = { forma, valor: -deps.amount, auctor: 'publish:scanFee', testis: editioId }
      const signum = 'animaId' in by
        ? { ...base, animaId: by.animaId }
        : { ...base, testis: by.commitment, commitment: by.commitment }
      await deps.signorum.issue(signum)
      log.info('publish scan fee charged', { amount: String(deps.amount), editioId })
    },
  }
}
