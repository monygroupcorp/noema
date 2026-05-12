import type { Collection, Document } from 'mongodb'
import type { Actum, ActumStatus } from '../types/actum.js'
import type { Actorum } from '../types/cursus.js'

// bigint is not a BSON type — stored as decimal string, converted on read/write
type ActumDoc = Omit<Actum, 'impetus'> & { impetus: string }

function toDoc(a: Omit<Actum, 'inceptum'>): Omit<ActumDoc, 'inceptum'> {
  const { impetus, ...rest } = a
  return { ...rest, impetus: impetus.toString() }
}

function fromDoc(doc: Document): Actum {
  const { _id, impetus, ...rest } = doc as ActumDoc & { _id: unknown }
  return { ...rest, impetus: BigInt(impetus) } as Actum
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
    patch: Partial<Pick<Actum, 'status' | 'exitus' | 'error' | 'completum' | 'duratio' | 'impetus' | 'materiamId' | 'signaConsumed' | 'expirat' | 'externusJobId'>>
  ): Promise<Actum> {
    const { impetus, ...rest } = patch
    const $set: Record<string, unknown> = { ...rest }
    if (impetus !== undefined) $set.impetus = impetus.toString()

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

  async findExpired(): Promise<Actum[]> {
    const docs = await this.col
      .find({ status: 'nascens', expirat: { $lte: new Date() } })
      .toArray()
    return docs.map(fromDoc)
  }
}
