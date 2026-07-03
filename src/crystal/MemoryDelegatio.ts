import { randomBytes, randomUUID } from 'node:crypto'
import type { Delegatio, DelegatioDraft, Delegationum } from '../types/delegatio.js'

/** In-memory delegation store — the hermetic mirror of MongoDelegatio. Same cap/active/expiry
 *  guard on `recordSpend` (single-threaded, so no CAS needed to be race-safe). */
export class MemoryDelegatio implements Delegationum {
  private readonly byId = new Map<string, Delegatio>()
  private readonly byToken = new Map<string, string>()

  async create(draft: DelegatioDraft): Promise<Delegatio> {
    const d: Delegatio = {
      id: randomUUID(),
      agentId: draft.agentId,
      token: randomBytes(24).toString('base64url'),
      ...(draft.label !== undefined ? { label: draft.label } : {}),
      ...(draft.spendCapPoints !== undefined ? { spendCapPoints: draft.spendCapPoints } : {}),
      spentPoints: 0n,
      ...(draft.expiresAt !== undefined ? { expiresAt: draft.expiresAt } : {}),
      status: 'active',
      natum: new Date(),
    }
    this.byId.set(d.id, d)
    this.byToken.set(d.token, d.id)
    return d
  }

  async find(id: string): Promise<Delegatio | null> {
    return this.byId.get(id) ?? null
  }

  async findByToken(token: string): Promise<Delegatio | null> {
    const id = this.byToken.get(token)
    return id ? this.byId.get(id) ?? null : null
  }

  async listByAgent(agentId: string): Promise<Delegatio[]> {
    return [...this.byId.values()]
      .filter((d) => d.agentId === agentId)
      .sort((a, b) => b.natum.getTime() - a.natum.getTime())
  }

  async setStatus(id: string, status: Delegatio['status']): Promise<void> {
    const d = this.byId.get(id)
    if (d) this.byId.set(id, { ...d, status })
  }

  async recordSpend(id: string, points: bigint, now: Date): Promise<Delegatio | null> {
    const d = this.byId.get(id)
    if (points <= 0n) return d ?? null
    if (!d || d.status !== 'active') return null
    if (d.expiresAt && d.expiresAt <= now) return null
    const next = d.spentPoints + points
    if (d.spendCapPoints !== undefined && next > d.spendCapPoints) return null
    const updated = { ...d, spentPoints: next }
    this.byId.set(id, updated)
    return updated
  }
}
