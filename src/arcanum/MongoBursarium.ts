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
    const createdAt = new Date()
    await this.col.insertOne({ token, credits: credits.toString(), createdAt })
    return { id: token, credits, createdAt }
  }

  async findByToken(token: string): Promise<Bursa | null> {
    const doc = await this.col.findOne({ token })
    if (!doc) return null
    return { id: doc.token as string, credits: BigInt(doc.credits as string), createdAt: doc.createdAt as Date }
  }

  // OCC debit: read → check → CAS update. Retries on concurrent debit (rare).
  async debit(token: string, amount: bigint): Promise<Bursa> {
    const MAX_RETRIES = 10
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const doc = await this.col.findOne({ token })
      if (!doc) throw new Error('Bursa not found')

      const current = BigInt(doc.credits as string)
      if (current < amount) throw new Error(`Insufficient bursa balance: ${current} credits, need ${amount}`)

      const updated = await this.col.findOneAndUpdate(
        { token, credits: current.toString() },
        { $set: { credits: (current - amount).toString() } },
        { returnDocument: 'after' },
      )

      if (updated) {
        return { id: updated.token as string, credits: BigInt(updated.credits as string), createdAt: updated.createdAt as Date }
      }
      // CAS miss — concurrent debit won the race; retry
    }
    throw new Error('Bursa debit failed after max retries (concurrent contention)')
  }

  async credit(token: string, amount: bigint): Promise<void> {
    const doc = await this.col.findOne({ token })
    if (!doc) return  // purse vanished — nothing to restore to
    const restored = (BigInt(doc.credits as string) + amount).toString()
    await this.col.updateOne({ token }, { $set: { credits: restored } })
  }
}
