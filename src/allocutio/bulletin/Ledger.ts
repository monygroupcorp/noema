/**
 * Ledger — first-class accounting for a PodSession's gens.
 *
 * Every gen bumps genCount; cost and execution time accumulate WITH THEIR OWN
 * counts, so an average is always total/own-count — never total/genCount. That
 * removes a whole class of "understated average" bugs when a gen happens not to
 * report a metric. The cost-averaging story (spend per gen falling as warm gens
 * pile up) reads straight off `avgCostUsd`.
 */
export interface LedgerSummary {
  genCount: number
  totalCostUsd: number
  avgCostUsd: number
  avgExecMs: number
  hasCost: boolean
  hasExec: boolean
}

export class Ledger {
  private genCount = 0
  private costTotal = 0
  private costCount = 0
  private execTotal = 0
  private execCount = 0

  /** Record one completed gen. Cost/exec are optional — each tallies independently. */
  record(entry: { costUsd?: number; execMs?: number }): void {
    this.genCount += 1
    if (typeof entry.costUsd === 'number') { this.costTotal += entry.costUsd; this.costCount += 1 }
    if (typeof entry.execMs === 'number')  { this.execTotal += entry.execMs;  this.execCount += 1 }
  }

  summary(): LedgerSummary {
    return {
      genCount: this.genCount,
      totalCostUsd: this.costTotal,
      avgCostUsd: this.costCount > 0 ? this.costTotal / this.costCount : 0,
      avgExecMs: this.execCount > 0 ? this.execTotal / this.execCount : 0,
      hasCost: this.costCount > 0,
      hasExec: this.execCount > 0,
    }
  }
}
