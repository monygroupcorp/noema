import { randomUUID } from 'node:crypto'
import type { Collection } from 'mongodb'
import type { Bursa, Bursarum } from '../types/bursa.js'

export class MongoBursarium implements Bursarum {
  constructor(private readonly col: Collection) {}

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ token: 1 }, { unique: true })
  }

  async create(credits: bigint): Promise<Bursa> {
    const token = randomUUID()
    await this.col.insertOne({ token, credits: credits.toString(), createdAt: new Date() })
    return { id: token, credits, createdAt: new Date() }
  }

  async findByToken(token: string): Promise<Bursa | null> {
    const doc = await this.col.findOne({ token })
    if (!doc) return null
    return { id: doc.token as string, credits: BigInt(doc.credits as string), createdAt: doc.createdAt as Date }
  }

  // OCC debit: read → check → CAS update. Retries on concurrent debit (rare).
  async debit(token: string, amount: bigint): Promise<Bursa> {
    const doc = await this.col.findOne({ token })
    if (!doc) throw new Error('Bursa not found')

    const current = BigInt(doc.credits as string)
    if (current < amount) throw new Error(`Insufficient bursa balance: ${current} credits, need ${amount}`)

    const next = (current - amount).toString()

    const updated = await this.col.findOneAndUpdate(
      { token, credits: current.toString() },
      { $set: { credits: next } },
      { returnDocument: 'after' },
    )

    // If null, a concurrent debit updated credits between our read and write — retry
    if (!updated) return this.debit(token, amount)

    return { id: updated.token as string, credits: BigInt(updated.credits as string), createdAt: updated.createdAt as Date }
  }
}
