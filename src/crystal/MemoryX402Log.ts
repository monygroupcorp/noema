import type { X402LogEntry, X402LogStore } from '../types/x402.js'

/** In-memory x402 payment log — the hermetic mirror of `MongoX402Log`. Enforces the
 *  same replay guard: a duplicate `signatureHash` recordVerified returns false. */
export class MemoryX402Log implements X402LogStore {
  private readonly store = new Map<string, X402LogEntry>()

  async recordVerified(entry: Omit<X402LogEntry, 'status' | 'verifiedAt'>): Promise<boolean> {
    if (this.store.has(entry.signatureHash)) return false // replay
    this.store.set(entry.signatureHash, { ...entry, status: 'VERIFIED', verifiedAt: new Date() })
    return true
  }

  async recordSettled(signatureHash: string, txHash: string, runId?: string): Promise<void> {
    const prev = this.store.get(signatureHash)
    if (prev) this.store.set(signatureHash, { ...prev, status: 'SETTLED', txHash, settledAt: new Date(), ...(runId ? { runId } : {}) })
  }

  async recordFailed(signatureHash: string, reason: string): Promise<void> {
    const prev = this.store.get(signatureHash)
    if (prev) this.store.set(signatureHash, { ...prev, status: 'FAILED', failureReason: reason, failedAt: new Date() })
  }

  async find(signatureHash: string): Promise<X402LogEntry | null> {
    return this.store.get(signatureHash) ?? null
  }
}
