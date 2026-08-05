import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Corpus, Corpora, Corporum } from '../types/corpus.js'

function fromDoc(doc: Record<string, unknown>): Corpus {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Corpus
}

export class MongoCorpus implements Corporum {
  constructor(private col: Collection) {}

  async create(input: Omit<Corpus, 'id' | 'natum' | 'mutatum'>): Promise<Corpus> {
    const now = new Date()
    const c: Corpus = { ...input, id: uuidv4(), natum: now, mutatum: now }
    await this.col.insertOne({ ...c })
    return c
  }

  async find(id: string): Promise<Corpus | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Corpus, 'auctor' | 'genus' | 'status'>>): Promise<Corpora> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Corpus, 'status' | 'exemplaria' | 'numerus' | 'mutatum'>>): Promise<Corpus> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Corpus not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
