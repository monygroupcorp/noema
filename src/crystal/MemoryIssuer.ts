import type { Issuer, Issuers, IssuerStore } from '../types/issuer.js'

/** In-memory trusted-issuer registry — the hermetic mirror of `MongoIssuer`. */
export class MemoryIssuer implements IssuerStore {
  private readonly store = new Map<string, Issuer>()

  async findByIssuerId(issuerId: string): Promise<Issuer | null> {
    const i = this.store.get(issuerId)
    return i && i.status === 'active' ? i : null
  }

  async list(): Promise<Issuers> {
    return Array.from(this.store.values())
  }

  async upsert(
    issuer: Pick<Issuer, 'issuerId' | 'name' | 'jwksUrl'> & { status?: Issuer['status'] },
  ): Promise<Issuer> {
    const prev = this.store.get(issuer.issuerId)
    const record: Issuer = {
      issuerId: issuer.issuerId,
      name: issuer.name,
      jwksUrl: issuer.jwksUrl,
      status: issuer.status ?? 'active',
      natum: prev?.natum ?? new Date(),
    }
    this.store.set(record.issuerId, record)
    return record
  }

  async setStatus(issuerId: string, status: Issuer['status']): Promise<void> {
    const prev = this.store.get(issuerId)
    if (prev) this.store.set(issuerId, { ...prev, status })
  }
}
