import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Mandatum, Mandata, Mandatorum, MandatumPatch } from '../types/mandatum.js'

/** Internal-only column: when the current claim on a mandatum lapses. Never projected. */
const LEASE = '_locatum'

function fromDoc(doc: Record<string, unknown>): Mandatum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, _nextFire, _locatum, ...rest } = doc as Record<string, unknown> &
    { _id: unknown; _nextFire: unknown; _locatum: unknown }
  return rest as unknown as Mandatum
}

export class MongoMandatum implements Mandatorum {
  constructor(private col: Collection) {}

  /** Idempotent indexes: the due-query drives every tick, and the attempt lookup is a
   *  point read off `acta`. Call once at wiring. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ id: 1 }, { unique: true })
    await this.col.createIndex({ status: 1, proximum: 1 })
    await this.col.createIndex({ acta: 1 })
  }

  async create(input: Omit<Mandatum, 'id' | 'natum' | 'mutatum' | 'acta' | 'ignitions'>): Promise<Mandatum> {
    const now = new Date()
    const m: Mandatum = { ...input, id: uuidv4(), acta: [], ignitions: 0, natum: now, mutatum: now }
    await this.col.insertOne({ ...m })
    return m
  }

  async find(id: string): Promise<Mandatum | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByActum(actumId: string): Promise<Mandatum | null> {
    const doc = await this.col.findOne({ acta: actumId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Mandatum, 'status' | 'triggerGenus'>>): Promise<Mandata> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: MandatumPatch): Promise<Mandatum> {
    // `pendens: undefined` is an explicit CLEAR, not an absent key — $set would otherwise
    // write a null and the watch/fire discriminant would never flip back.
    const { pendens, ...rest } = patch
    const set: Record<string, unknown> = { ...rest, mutatum: new Date() }
    const unset: Record<string, ''> = {}
    if ('pendens' in patch) {
      if (pendens === undefined) unset.pendens = ''
      else set.pendens = pendens
    }
    const result = await this.col.findOneAndUpdate(
      { id },
      Object.keys(unset).length ? { $set: set, $unset: unset } : { $set: set },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Mandatum not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async due(at: Date): Promise<Mandata> {
    const docs = await this.col.find({ status: 'active', proximum: { $lte: at } }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async claimDue(at: Date, leaseMs: number): Promise<Mandatum | null> {
    const result = await this.col.findOneAndUpdate(
      {
        status: 'active',
        proximum: { $lte: at },
        $or: [{ [LEASE]: { $exists: false } }, { [LEASE]: { $lte: at } }],
      },
      { $set: { [LEASE]: new Date(at.getTime() + leaseMs) } },
      { returnDocument: 'after', sort: { proximum: 1 } }
    )
    return result ? fromDoc(result as Record<string, unknown>) : null
  }

  /** Set when this mandatum is next due to be looked at, and release the current claim —
   *  one write, so a re-scheduled order is claimable again the moment it comes due rather
   *  than waiting out a lease it no longer needs. */
  async setNextFire(id: string, nextFire: Date): Promise<void> {
    await this.col.updateOne(
      { id },
      { $set: { proximum: nextFire, mutatum: new Date() }, $unset: { [LEASE]: '' } },
    )
  }
}
