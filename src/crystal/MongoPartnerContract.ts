import { randomUUID } from 'node:crypto'
import { Collection } from 'mongodb'
import type { PartnerContractSignature, PartnerContractStore } from '../types/partnerContract.js'

function fromDoc(doc: Record<string, unknown>): PartnerContractSignature {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as PartnerContractSignature
}

/** The contract-signature book. Append-only — no update path exists, by design: a superseded
 *  signature is still what governed the runs made under it. */
export class MongoPartnerContract implements PartnerContractStore {
  constructor(private col: Collection) {}

  async sign(
    input: Omit<PartnerContractSignature, 'id' | 'signedAt'> & { signedAt?: Date },
  ): Promise<PartnerContractSignature> {
    const record: PartnerContractSignature = { ...input, id: randomUUID(), signedAt: input.signedAt ?? new Date() }
    await this.col.insertOne({ ...record })
    return record
  }

  async findCurrent(animaId: string, version: string): Promise<PartnerContractSignature | null> {
    const doc = await this.col.find({ animaId, version }).sort({ signedAt: 1 }).limit(1).next()
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(animaId: string): Promise<PartnerContractSignature[]> {
    const docs = await this.col.find({ animaId }).sort({ signedAt: -1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }
}
