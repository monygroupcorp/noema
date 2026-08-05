import type { Collection, Document } from 'mongodb'
import type { Materia, MateriaStore, PodPolicy } from '../types/materia.js'

// bigint is not a BSON type — every bigint field is stored as a decimal string and
// converted on read/write. The list below is the complete set of bigint fields on
// Materia; any new bigint must be added here OR Mongo will throw on insert.
const BIGINT_FIELDS = ['impetusPerSecond', 'bootCostImpetus', 'bootRecovered'] as const

type MateriaDoc = Omit<Materia, typeof BIGINT_FIELDS[number]> & {
  impetusPerSecond: string
  bootCostImpetus?: string
  bootRecovered?: string
}

function toDoc(m: Partial<Materia>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...m }
  for (const f of BIGINT_FIELDS) {
    const v = (m as Record<string, unknown>)[f]
    if (typeof v === 'bigint') out[f] = v.toString()
  }
  return out
}

function fromDoc(doc: Document): Materia {
  const { _id: _omit, ...rest } = doc as MateriaDoc & { _id: unknown }
  const out: Record<string, unknown> = { ...rest }
  for (const f of BIGINT_FIELDS) {
    const v = (rest as Record<string, unknown>)[f]
    if (typeof v === 'string') out[f] = BigInt(v)
  }
  return out as unknown as Materia
}

export class MongoMateria implements MateriaStore {
  constructor(private readonly col: Collection) {}

  async create(input: Omit<Materia, 'id'>): Promise<Materia> {
    const { v4: uuidv4 } = await import('uuid')
    const materia: Materia = { ...input, id: uuidv4() }
    await this.col.insertOne(toDoc(materia))
    return materia
  }

  async findById(id: string): Promise<Materia | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async update(
    id: string,
    patch: Partial<Pick<Materia,
      | 'status' | 'sshHost' | 'sshPort' | 'imageRef' | 'terminatum'
      | 'podPolicy' | 'shareToken' | 'warmUntil'
      | 'groupChatId' | 'openToNonAdmins'
      | 'bootCostImpetus' | 'bootRecovered'
      | 'drainOnly'
      | 'installedModels' | 'volumeUsedGb' | 'volumeCapGb'
    >>
  ): Promise<Materia> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: toDoc(patch) },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Materia ${id} not found`)
    return fromDoc(result)
  }

  async findWarm(spec: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string; materiaId?: string }): Promise<Materia | null> {
    const filter: Record<string, unknown> = { status: 'idle' }
    if (spec.materiaId) filter.id = spec.materiaId
    if (spec.imageRef) filter.imageRef = spec.imageRef
    if (spec.podPolicy) filter.podPolicy = spec.podPolicy
    if (spec.shareToken) filter.shareToken = spec.shareToken
    // Atomic claim: only matches idle pods and transitions to active in one operation.
    // Prevents two concurrent requests from dispatching to the same warm pod.
    const doc = await this.col.findOneAndUpdate(
      filter,
      { $set: { status: 'active' } },
      { returnDocument: 'after' }
    )
    return doc ? fromDoc(doc) : null
  }

  async findActive(): Promise<Materia[]> {
    const docs = await this.col.find({ status: { $ne: 'terminated' } }).toArray()
    return docs.map(fromDoc)
  }

  async reapIdle(now: Date): Promise<Materia[]> {
    const reaped: Materia[] = []
    // One atomic claim per pod: reap an idle pod when EITHER it's past its warm
    // deadline OR it's been drained (`drainOnly` — budget/balance exhausted, see
    // Census). Draining makes `maxImpetus` a HARD cap: a budget-exhausted idle
    // studio dies on the next sweep instead of billing on to `warmUntil`. A pod
    // running a gen is `status:'active'` so it's never reaped mid-job — it drains,
    // finishes, goes idle, then this matches. A concurrent findWarm (idle→active)
    // wins the race and this filter no longer matches it.
    for (;;) {
      const doc = await this.col.findOneAndUpdate(
        { status: 'idle', $or: [{ warmUntil: { $lte: now } }, { drainOnly: true }] },
        { $set: { status: 'terminated', terminatum: now } },
        { returnDocument: 'after' },
      )
      if (!doc) break
      reaped.push(fromDoc(doc))
    }
    return reaped
  }
}
