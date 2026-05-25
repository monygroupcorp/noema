import type { Collection, Document } from 'mongodb'
import type { Intella, Intellae, IntellaGenus, Intellarum } from '../types/intelligendi.js'

function fromDoc(doc: Document): Intella {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Document & { _id: unknown }
  return rest as Intella
}

export class MongoIntella implements Intellarum {
  constructor(private readonly col: Collection) {}

  async find(id: string): Promise<Intella | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async list(genus?: IntellaGenus): Promise<Intellae> {
    const query = genus !== undefined ? { genus } : {}
    const docs = await this.col.find(query).toArray()
    return docs.map(fromDoc)
  }

  async canonical(): Promise<Intellae> {
    const docs = await this.col.find({ canonica: true }).toArray()
    return docs.map(fromDoc)
  }

  async findByTrigger(trigger: string, baseIntellaId: string, animaId?: string): Promise<Intellae> {
    const triggerLower = trigger.toLowerCase()
    const query: Record<string, unknown> = {
      genus: 'lora',
      baseIntellaId,
      trigger: { $regex: new RegExp(triggerLower, 'i') },
      $or: [
        { access: 'public' },
        ...(animaId ? [{ ownerAnimaId: animaId }] : []),
      ],
    }
    const docs = await this.col.find(query).toArray()
    return docs.map(fromDoc)
  }

  async triggerMap(baseIntellaId: string, animaId?: string): Promise<Map<string, Intellae>> {
    // One query: every accessible LoRA for this base. We group client-side; the
    // collection is small enough (low thousands) that the network round-trip
    // dominates anyway. If this becomes a hot path, swap to an aggregation that
    // groups on the server.
    const query: Record<string, unknown> = {
      genus: 'lora',
      baseIntellaId,
      trigger: { $exists: true, $ne: '' },
      $or: [
        { access: 'public' },
        ...(animaId ? [{ ownerAnimaId: animaId }] : []),
      ],
    }
    const docs = await this.col.find(query).toArray()
    const map = new Map<string, Intellae>()
    for (const doc of docs) {
      const intella = fromDoc(doc)
      // A single Intella can declare multiple triggers as a comma-separated list
      // (legacy convention from the JS resolver). Split, lower, dedupe — one
      // map entry per token so resolvers can hit by any alias.
      for (const raw of (intella.trigger ?? '').split(',')) {
        const key = raw.trim().toLowerCase()
        if (!key) continue
        const bucket = map.get(key)
        if (bucket) bucket.push(intella)
        else map.set(key, [intella])
      }
    }
    return map
  }

  /** Insert or fully replace an Intella record. Used for seeding canonical models. */
  async upsert(intella: Intella): Promise<void> {
    await this.col.replaceOne({ id: intella.id }, intella, { upsert: true })
  }
}
