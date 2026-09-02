import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { PartnerRequest, PartnerRequestStore } from '../types/partnerRequest.js'

function fromDoc(doc: Record<string, unknown>): PartnerRequest {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as PartnerRequest
}

export class MongoPartnerRequest implements PartnerRequestStore {
  constructor(private col: Collection) {}

  async create(
    input: Omit<PartnerRequest, 'id' | 'natum' | 'status' | 'decidedAt' | 'decidedBy'> & { status?: PartnerRequest['status'] },
  ): Promise<PartnerRequest> {
    const record: PartnerRequest = { ...input, id: uuidv4(), status: input.status ?? 'pending', natum: new Date() }
    await this.col.insertOne({ ...record })
    return record
  }

  async find(id: string): Promise<PartnerRequest | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: { status?: PartnerRequest['status'] }): Promise<PartnerRequest[]> {
    const f: Record<string, unknown> = {}
    if (filter?.status !== undefined) f.status = filter.status
    const docs = await this.col.find(f).sort({ natum: -1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(
    id: string,
    patch: Partial<Pick<PartnerRequest, 'status' | 'decidedAt' | 'decidedBy'>>,
  ): Promise<PartnerRequest> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch } },
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`PartnerRequest not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async findByEmailKey(emailKey: string): Promise<PartnerRequest[]> {
    const docs = await this.col.find({ emailKey }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }
}
