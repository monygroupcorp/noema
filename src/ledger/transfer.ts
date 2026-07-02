import { randomUUID } from 'node:crypto'
import type { Signorum, Transferatio, SignumForma } from '../types/significandi.js'

/**
 * The impl-agnostic body of `Signorum.transfer` — spend `amount` from `from` and reissue it
 * to `to`, expressed purely in terms of `reserve` + `settle` + `issue`. Both `MemorySignorum`
 * and `MongoSignorum` delegate here so the money-movement logic lives in exactly one place;
 * the storage-specific concurrency is entirely inside each impl's `reserve`/`settle`.
 *
 * All-or-nothing: a short sender moves nothing. The sender is debited exactly `amount` (any
 * greedy overshoot is refunded to it by `settle`), then the recipient is credited. Debit
 * precedes credit so an interrupted transfer loses value rather than inventing it (fail-safe).
 */
export async function transferVia(
  ledger: Pick<Signorum, 'reserve' | 'settle' | 'issue'>,
  from: { animaId: string } | { commitment: string },
  to: { animaId: string },
  amount: bigint,
  opts?: { auctor?: string; forma?: SignumForma; testis?: string; contextId?: string },
): Promise<Transferatio> {
  if (amount <= 0n) return { ok: true }
  const actumId = `transfer:${randomUUID()}`
  const reserved = await ledger.reserve(from, amount, actumId)
  if (!reserved.ok) return { ok: false, available: reserved.available }
  await ledger.settle(reserved.signaIds, amount, actumId)
  await ledger.issue({
    animaId: to.animaId,
    forma: opts?.forma ?? 'minted',
    valor: amount,
    auctor: opts?.auctor ?? 'transfer',
    ...(opts?.testis ? { testis: opts.testis } : {}),
    ...(opts?.contextId ? { contextId: opts.contextId } : {}),
  })
  return { ok: true }
}
