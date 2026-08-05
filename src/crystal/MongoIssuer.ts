import { Collection } from 'mongodb'
import type { Issuer, Issuers, IssuerStore } from '../types/issuer.js'

function fromDoc(doc: Record<string, unknown>): Issuer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Issuer
}

/** Mongo-backed trusted-issuer registry (collection default `trusted_issuers`,
 *  matching the legacy JS `IssuerDB` so the seed carries over 1:1). */
export class MongoIssuer implements IssuerStore {
  constructor(private col: Collection) {}

  async findByIssuerId(issuerId: string): Promise<Issuer | null> {
    const doc = await this.col.findOne({ issuerId, status: 'active' })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(): Promise<Issuers> {
    const docs = await this.col.find({}).sort({ natum: -1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async upsert(
    issuer: Pick<Issuer, 'issuerId' | 'name' | 'jwksUrl'> & { status?: Issuer['status'] },
  ): Promise<Issuer> {
    const status = issuer.status ?? 'active'
    await this.col.updateOne(
      { issuerId: issuer.issuerId },
      {
        $set: { name: issuer.name, jwksUrl: issuer.jwksUrl, status },
        $setOnInsert: { issuerId: issuer.issuerId, natum: new Date() },
      },
      { upsert: true },
    )
    const doc = await this.col.findOne({ issuerId: issuer.issuerId })
    return fromDoc(doc as Record<string, unknown>)
  }

  async setStatus(issuerId: string, status: Issuer['status']): Promise<void> {
    await this.col.updateOne({ issuerId }, { $set: { status } })
  }
}
