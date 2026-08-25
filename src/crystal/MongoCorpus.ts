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

  /**
   * The id-resolving read, with the access predicate IN THE QUERY (see `Corporum.findOwned`).
   * A corpus this caller may not name does not come back, so there is no loaded record for a
   * later comparison to be skipped on.
   *
   * Two `access` shapes are admitted because the tree carries two: the flat `'public'` string
   * `Intella` stores, and the `{ kind }` single-axis Access union the schema spec settles on.
   * `Corpus` carries neither field today, so both arms match nothing — they are here so that
   * the item which gives corpora an access field is a schema change, not a re-derivation of
   * who may read what.
   */
  async findOwned(id: string, auctor: string): Promise<Corpus | null> {
    const doc = await this.col.findOne({
      id,
      $or: [{ auctor }, { access: 'public' }, { 'access.kind': 'public' }],
    })
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
