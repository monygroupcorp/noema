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
      | 'drainOnly' | 'drainUntil'
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
    const now = new Date()
    const filter: Record<string, unknown> = {
      status: 'idle',
      $or: [{ warmUntil: { $exists: false } }, { warmUntil: { $gt: now } }],
    }
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

  async hasBusy(imageRef: string): Promise<boolean> {
    const doc = await this.col.findOne({ imageRef, status: { $nin: ['idle', 'terminated'] } })
    return doc !== null
  }

  async findActive(): Promise<Materia[]> {
    const docs = await this.col.find({ status: { $ne: 'terminated' } }).toArray()
    return docs.map(fromDoc)
  }

  async reapIdle(now: Date, hasLiveActum?: (materiaId: string) => Promise<boolean>): Promise<Materia[]> {
    const reaped: Materia[] = []
    // One atomic claim per pod, matching either of two unconditional arms. A
    // concurrent findWarm (idle→active) wins the race and neither arm matches it
    // any more.
    //
    // Idle-expired arm: an idle pod past its plain warm deadline — unrelated to
    // draining, no liveness check needed (warmUntil itself is the grace).
    //
    // Drain-deadline arm: a draining pod of ANY status past its `drainUntil` hard
    // deadline. That bounds the pod whose release path never ran — process died
    // mid-job, runner gone, completion webhook lost — and which would otherwise
    // stay `active` forever, still billed by Census. Past the deadline it is
    // reaped whatever its status; the grace window is the whole point of matching
    // on the deadline rather than on `drainOnly` alone — a real in-flight gen gets
    // it all to finish in.
    const stranded = { drainOnly: true, drainUntil: { $lte: now }, status: { $ne: 'terminated' } }
    const idleExpired = { status: 'idle', warmUntil: { $lte: now } }
    for (;;) {
      const doc = await this.col.findOneAndUpdate(
        { $or: [idleExpired, stranded] },
        { $set: { status: 'terminated', terminatum: now } },
        { returnDocument: 'after' },
      )
      if (!doc) break
      reaped.push(fromDoc(doc))
    }

    // Idle + draining, no deadline passed yet: `maxImpetus` makes draining a HARD
    // cap, so this is reaped on sight rather than left billing on to `warmUntil` —
    // but "idle" is NOT reliable proof the actum it was running settled. A warm
    // pod's release path (WarmPodClient) flips Materia to 'idle' the moment its
    // runner reports the job done, which is BEFORE the completion webhook has
    // reached ActumCompletor — WarmPodClient has no actum/webhook dependency, only
    // Materia. Reaping on sight there races that webhook and strands the result
    // (noema stuck-actum-drain-reaper-race): the terminated pod can never deliver
    // it. `hasLiveActum` closes that race — a pod with a still-live (nascens/agens)
    // actum is left for the `stranded` arm's grace instead of reaped here; one with
    // none, or no dependency wired at all, is reaped immediately as before.
    const idleDraining = await this.col.find({ status: 'idle', drainOnly: true }).toArray()
    for (const doc of idleDraining) {
      const m = fromDoc(doc)
      if (hasLiveActum && await hasLiveActum(m.id).catch(() => true)) continue
      const claimed = await this.col.findOneAndUpdate(
        { id: m.id, status: 'idle', drainOnly: true },
        { $set: { status: 'terminated', terminatum: now } },
        { returnDocument: 'after' },
      )
      if (claimed) reaped.push(fromDoc(claimed))
    }
    return reaped
  }
}
