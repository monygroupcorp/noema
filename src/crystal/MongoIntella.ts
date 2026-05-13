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

  /** Insert or fully replace an Intella record. Used for seeding canonical models. */
  async upsert(intella: Intella): Promise<void> {
    await this.col.replaceOne({ id: intella.id }, intella, { upsert: true })
  }
}
