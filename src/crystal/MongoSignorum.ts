import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Signum, Signa, Signorum } from '../types/significandi.js'

function toDoc(s: Partial<Signum>): Record<string, unknown> {
  const { valor, ...rest } = s
  return { ...rest, valor: valor !== undefined ? valor.toString() : '0' }
}

function fromDoc(doc: Record<string, unknown>): Signum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, valor, ...rest } = doc as Record<string, unknown> & { _id: unknown; valor: string }
  return { ...rest, valor: BigInt(valor) } as Signum
}

function identityQuery(by: { animaId: string } | { arcanumHash: string }): Record<string, unknown> {
  if ('animaId' in by) return { animaId: by.animaId }
  return { testis: by.arcanumHash, forma: 'arcanum' }
}

export class MongoSignorum implements Signorum {
  constructor(private col: Collection) {}

  async issue(input: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum> {
    if ((input.forma === 'arcanum' || input.forma === 'tessera') && input.animaId !== undefined) {
      throw new Error(`privacy invariant: ${input.forma} forma must not have animaId`)
    }
    const signum: Signum = { ...input, id: uuidv4(), natum: new Date(), status: 'valid' }
    await this.col.insertOne(toDoc(signum))
    return signum
  }

  async balance(by: { animaId: string } | { arcanumHash: string }): Promise<bigint> {
    const docs = await this.col.find({ ...identityQuery(by), status: 'valid' }).toArray()
    return docs.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)
  }

  async lock(signaIds: string[], actumId: string): Promise<void> {
    await this.col.updateMany(
      { id: { $in: signaIds }, status: 'valid' },
      { $set: { status: 'locked', actumId } }
    )
  }

  async release(signaIds: string[]): Promise<void> {
    await this.col.updateMany(
      { id: { $in: signaIds }, status: 'locked' },
      { $set: { status: 'valid' }, $unset: { actumId: '' } }
    )
  }

  async history(by: { animaId: string } | { arcanumHash: string }): Promise<Signa> {
    const docs = await this.col.find(identityQuery(by)).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]> {
    if (signa.length === 0) return []
    const now = new Date()
    const records: Signum[] = signa.map(s => ({ ...s, id: uuidv4(), natum: now, status: 'valid' as const }))
    await this.col.insertMany(records.map(toDoc))
    return records
  }

  async settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void> {
    const docs = await this.col.find({ id: { $in: signaIds } }).toArray()
    const total = docs.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)

    const expensum = new Date()
    await this.col.updateMany(
      { id: { $in: signaIds } },
      { $set: { status: 'spent', expensum, actumId } }
    )

    const delta = total - actualImpetus
    if (delta <= 0n || docs.length === 0) return

    const first = docs[0] as Record<string, unknown>
    if (first.animaId) {
      await this.issue({ forma: 'minted', valor: delta, auctor: 'system:refund', animaId: first.animaId as string })
    } else if (first.forma === 'arcanum' && first.testis) {
      await this.issue({ forma: 'arcanum', valor: delta, auctor: 'system:refund', testis: first.testis as string })
    }
  }
}
