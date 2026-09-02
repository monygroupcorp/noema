import { Collection } from 'mongodb'
import type { Partner, PartnerStore } from '../types/partner.js'

function fromDoc(doc: Record<string, unknown>): Partner {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Partner
}

export class MongoPartner implements PartnerStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Partner, 'natum' | 'status'> & { status?: Partner['status'] }): Promise<Partner> {
    const record: Partner = { ...input, status: input.status ?? 'active', natum: new Date() }
    await this.col.insertOne({ ...record })
    return record
  }

  async find(animaId: string): Promise<Partner | null> {
    const doc = await this.col.findOne({ animaId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: { status?: Partner['status'] }): Promise<Partner[]> {
    const f: Record<string, unknown> = {}
    if (filter?.status !== undefined) f.status = filter.status
    const docs = await this.col.find(f).sort({ natum: -1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async setStatus(animaId: string, status: Partner['status']): Promise<void> {
    await this.col.updateOne({ animaId }, { $set: { status } })
  }
}
