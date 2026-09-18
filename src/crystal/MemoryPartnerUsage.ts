import type { PartnerUsage, PartnerUsageRollup, PartnerUsageStore } from '../types/partnerUsage.js'

/** Roll a set of settled meter rows up into the figure an invoice is drawn from. Shared by
 *  both stores so the memory mirror and Mongo cannot disagree about what a period totals —
 *  the aggregation is the same arithmetic either way, and only the fetch differs. */
export function rollup(rows: PartnerUsage[]): PartnerUsageRollup {
  const settled = rows.filter(r => r.settledAt !== undefined)
  const perModus = new Map<string, { modusLabel: string; calls: number; impetus: bigint }>()
  let total = 0n
  for (const row of settled) {
    const impetus = BigInt(row.impetus ?? '0')
    total += impetus
    const line = perModus.get(row.modusId) ?? { modusLabel: row.modusLabel ?? row.modusId, calls: 0, impetus: 0n }
    line.calls += 1
    line.impetus += impetus
    // A label can only improve: a settled row carries one, and the fallback is the id itself.
    if (row.modusLabel) line.modusLabel = row.modusLabel
    perModus.set(row.modusId, line)
  }
  const lines = [...perModus.entries()]
    .map(([modusId, l]) => ({ modusId, modusLabel: l.modusLabel, calls: l.calls, impetus: l.impetus.toString() }))
    // Biggest line first; ties broken by modusId so the order is stable across runs.
    .sort((a, b) => (BigInt(b.impetus) > BigInt(a.impetus) ? 1 : BigInt(b.impetus) < BigInt(a.impetus) ? -1 : a.modusId.localeCompare(b.modusId)))
  return { calls: settled.length, impetus: total.toString(), lines }
}

/** In-memory B2B meter — the hermetic mirror of `MongoPartnerUsage`. Keyed by actumId. */
export class MemoryPartnerUsage implements PartnerUsageStore {
  private readonly store = new Map<string, PartnerUsage>()

  async record(entry: Pick<PartnerUsage, 'actumId' | 'animaId' | 'keyPrefix' | 'modusId' | 'calledAt'>): Promise<void> {
    if (this.store.has(entry.actumId)) return
    this.store.set(entry.actumId, { ...entry })
  }

  async settle(
    actumId: string,
    patch: { settledAt: Date; impetus: string; durationMs?: number; modusLabel: string; models: string[] },
  ): Promise<void> {
    const row = this.store.get(actumId)
    if (!row) return
    this.store.set(actumId, {
      ...row,
      settledAt: patch.settledAt,
      impetus: patch.impetus,
      modusLabel: patch.modusLabel,
      models: patch.models,
      ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
    })
  }

  async void(actumId: string, at: Date): Promise<void> {
    const row = this.store.get(actumId)
    if (!row) return
    this.store.set(actumId, { ...row, voidedAt: at })
  }

  private window(animaId: string, from: Date, to: Date): PartnerUsage[] {
    return [...this.store.values()].filter(
      r => r.animaId === animaId && r.calledAt.getTime() >= from.getTime() && r.calledAt.getTime() < to.getTime(),
    )
  }

  async list(animaId: string, from: Date, to: Date): Promise<PartnerUsage[]> {
    return this.window(animaId, from, to).sort((a, b) => b.calledAt.getTime() - a.calledAt.getTime())
  }

  async sumPeriod(animaId: string, from: Date, to: Date): Promise<PartnerUsageRollup> {
    return rollup(this.window(animaId, from, to))
  }
}
