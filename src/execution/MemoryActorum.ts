import type { Actum, ActumStatus } from '../types/actum.js'
import type { Actorum } from '../types/cursus.js'

export class MemoryActorum implements Actorum {
  private readonly store = new Map<string, Actum>()

  async create(actum: Omit<Actum, 'inceptum'>): Promise<Actum> {
    const record: Actum = { ...actum, inceptum: new Date() }
    this.store.set(record.id, record)
    return record
  }

  async update(id: string, patch: Partial<Pick<Actum, 'status' | 'exitus' | 'error' | 'completum' | 'duratio' | 'impetus' | 'materiamId' | 'signaConsumed' | 'expirat' | 'externusJobId' | 'callbackNonce' | 'oneshotPod' | 'resumeCheckpoint' | 'deploymentHash' | 'executio' | 'progressus' | 'phaseDurations' | 'firstHeartbeatDeadlineMs' | 'podLockedAt' | 'firstPodReportAt'>>): Promise<Actum> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`Actum '${id}' not found`)
    const updated = { ...existing, ...patch }
    this.store.set(id, updated)
    return updated
  }

  async findById(id: string): Promise<Actum | null> {
    return this.store.get(id) ?? null
  }

  async findByExternusJobId(externusJobId: string): Promise<Actum | null> {
    for (const actum of this.store.values()) {
      if (actum.externusJobId === externusJobId) return actum
    }
    return null
  }

  async findByCallbackNonce(callbackNonce: string): Promise<Actum | null> {
    for (const actum of this.store.values()) {
      if (actum.callbackNonce === callbackNonce) return actum
    }
    return null
  }

  async findByNullifier(nullifier: string): Promise<Actum | null> {
    // Ignore FAILED (fractus) acta: a failed run refunds its signa (ActumCompletor.fail), so its
    // arcanum spend is void and the commitment is free to re-spend. Only a live/completed actum
    // holding the nullifier is a real double-spend.
    for (const actum of this.store.values()) {
      if (actum.nullifier === nullifier && actum.status !== 'fractus') return actum
    }
    return null
  }

  async findExpired(): Promise<Actum[]> {
    const now = new Date()
    return Array.from(this.store.values()).filter(
      a => (a.status === 'nascens' || a.status === 'agens') && a.expirat < now
    )
  }

  async findInFlight(): Promise<Actum[]> {
    return Array.from(this.store.values()).filter(
      a => (a.status === 'nascens' || a.status === 'agens') && a.externusJobId != null
    )
  }

  async findByCompositum(parentId: string): Promise<Actum[]> {
    return Array.from(this.store.values()).filter(a => a.compositum?.parentId === parentId)
  }

  async countByIdsWithStatus(ids: string[], statuses: ActumStatus[]): Promise<number> {
    const wanted = new Set<string>(statuses)
    let n = 0
    for (const id of ids) {
      const a = this.store.get(id)
      if (a && wanted.has(a.status)) n++
    }
    return n
  }
}
