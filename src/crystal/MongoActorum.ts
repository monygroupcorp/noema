import type { Collection, Document } from 'mongodb'
import type { Actum, ActumStatus } from '../types/actum.js'
import type { Actorum } from '../types/cursus.js'

// bigint is not a BSON type — stored as decimal string, converted on read/write.
// Top-level `impetus` is required; `executio.finalImpetus` is an optional nested
// bigint introduced in Phase B for the dispatch-time pricing decision.
type ActumDoc = Omit<Actum, 'impetus'> & { impetus: string }

// bigint fields nested inside ActumExecutio — extend this list rather than
// hand-walking each one; serializer mirror code below stays a single line.
const EXECUTIO_BIGINT_FIELDS = ['baseImpetus', 'finalImpetus'] as const

function executioToDoc(e?: Actum['executio']): Record<string, unknown> | undefined {
  if (!e) return undefined
  const out: Record<string, unknown> = { ...e }
  for (const k of EXECUTIO_BIGINT_FIELDS) {
    const v = (e as Record<string, unknown>)[k]
    if (typeof v === 'bigint') out[k] = v.toString()
  }
  return out
}
function executioFromDoc(e?: Record<string, unknown>): Actum['executio'] | undefined {
  if (!e) return undefined
  const out: Record<string, unknown> = { ...e }
  for (const k of EXECUTIO_BIGINT_FIELDS) {
    if (typeof e[k] === 'string') out[k] = BigInt(e[k] as string)
  }
  return out as Actum['executio']
}

function toDoc(a: Omit<Actum, 'inceptum'>): Omit<ActumDoc, 'inceptum'> {
  const { impetus, executio, ...rest } = a
  return {
    ...rest,
    impetus: impetus.toString(),
    ...(executio !== undefined ? { executio: executioToDoc(executio) as Actum['executio'] } : {}),
  }
}

function fromDoc(doc: Document): Actum {
  const { _id: _omit, impetus, executio, ...rest } = doc as ActumDoc & { _id: unknown; executio?: Record<string, unknown> }
  return {
    ...rest,
    impetus: BigInt(impetus),
    ...(executio !== undefined ? { executio: executioFromDoc(executio) } : {}),
  } as Actum
}

export class MongoActorum implements Actorum {
  constructor(private readonly col: Collection) {}

  async create(actum: Omit<Actum, 'inceptum'>): Promise<Actum> {
    const inceptum = new Date()
    const doc = { ...toDoc(actum), inceptum }
    await this.col.insertOne({ ...doc })
    return fromDoc({ ...doc, inceptum })
  }

  async update(
    id: string,
    patch: Partial<Pick<Actum, 'status' | 'exitus' | 'error' | 'completum' | 'duratio' | 'impetus' | 'materiamId' | 'signaConsumed' | 'expirat' | 'externusJobId' | 'callbackNonce' | 'oneshotPod' | 'resumeCheckpoint' | 'deploymentHash' | 'executio' | 'progressus' | 'phaseDurations' | 'firstHeartbeatDeadlineMs' | 'podLockedAt' | 'firstPodReportAt'>>
  ): Promise<Actum> {
    const { impetus, executio, ...rest } = patch
    const $set: Record<string, unknown> = { ...rest }
    if (impetus !== undefined) $set.impetus = impetus.toString()
    if (executio !== undefined) $set.executio = executioToDoc(executio)

    const result = await this.col.findOneAndUpdate(
      { id },
      { $set },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Actum '${id}' not found`)
    return fromDoc(result)
  }

  async findById(id: string): Promise<Actum | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async findByExternusJobId(externusJobId: string): Promise<Actum | null> {
    const doc = await this.col.findOne({ externusJobId })
    return doc ? fromDoc(doc) : null
  }

  async findByCallbackNonce(callbackNonce: string): Promise<Actum | null> {
    const doc = await this.col.findOne({ callbackNonce })
    return doc ? fromDoc(doc) : null
  }

  async findByNullifier(nullifier: string): Promise<Actum | null> {
    // Exclude FAILED (fractus) acta — a failed run refunds its signa, voiding the arcanum spend, so
    // the commitment can be re-spent. Only a live/completed actum is a real double-spend.
    const doc = await this.col.findOne({ nullifier, status: { $ne: 'fractus' } })
    return doc ? fromDoc(doc) : null
  }

  async findExpired(): Promise<Actum[]> {
    const docs = await this.col
      .find({ status: { $in: ['nascens', 'agens'] }, expirat: { $lte: new Date() } })
      .toArray()
    return docs.map(fromDoc)
  }

  async findInFlight(): Promise<Actum[]> {
    const docs = await this.col
      .find({ status: { $in: ['nascens', 'agens'] }, externusJobId: { $exists: true, $ne: null } })
      .toArray()
    return docs.map(fromDoc)
  }

  async findByCompositum(parentId: string): Promise<Actum[]> {
    const docs = await this.col.find({ 'compositum.parentId': parentId }).toArray()
    return docs.map(fromDoc)
  }

  // One counting query for the whole id set, and no documents come back: the caller wants a
  // number, and its id sets are whole collections (a 10k-piece run is 10k ids). `id` is the
  // lookup key every other read here uses, so the `$in` rides the same index.
  async countByIdsWithStatus(ids: string[], statuses: ActumStatus[]): Promise<number> {
    if (ids.length === 0 || statuses.length === 0) return 0
    return this.col.countDocuments({ id: { $in: ids }, status: { $in: statuses } })
  }
}
