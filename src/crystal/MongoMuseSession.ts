// =============================================================================
// MongoMuseSession — the Muse session store, one collection of its own
// =============================================================================
//
// The house store shape (`MongoDataset`, `MongoCollectio`): a class over one
// `Collection`, `id`-keyed, `_id` stripped on read, `mutatum` bumped on write.
//
// Two things this file exists to get right:
//
//   THE FLOOR IS AN ENTRY ARRAY. `MuseSession.floor` is a `SteerState` — a Map
//   keyed by `fragmentKey`, i.e. `category:text`. A Map does not survive
//   JSON/BSON at all, and its key is user-derived text that cannot be a BSON
//   field name (a dot or a leading `$` carry Mongo's own meaning). It is stored
//   as an array of `{ key, enabled, weight }` and rebuilt into a Map on read.
//
//   THE MOTHER DATASET IS NEVER WRITTEN. A session is a break-off that copies
//   the fragments it was spawned from; the dataset stays the pure starter. This
//   store holds exactly one collection — the sessions one — so no session write
//   has a path to the dataset's document.
// =============================================================================

import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'

import { floorFromEntries, floorToEntries } from '../types/museSession.js'
import type {
  CreateMuseSessionInput,
  FloorEntry,
  MuseSessions,
  StoredMuseSession,
} from '../types/museSession.js'
import type { MuseSession, Piece } from './muse/session.js'
import type { Fragment } from './muse/taxonomy.js'

/** The persisted form of a session's pure value: the floor flattened to entries. */
interface MuseSessionDoc {
  motherDatasetId: string
  /** The session's own dataset. Absent until the session's first save mints it. */
  sessionDatasetId?: string
  fragments: Fragment[]
  floor: FloorEntry[]
  pieces: Piece[]
}

/**
 * THESE TWO FUNCTIONS ENUMERATE THE SESSION'S FIELDS. A field added to `MuseSession`
 * and not added to both is dropped on every write and every read with nothing failing:
 * the pure module keeps working on the value in memory, and the store quietly returns a
 * session without it. `sessionDatasetId` is the case that shows: dropped on the way
 * through, a session would mint a fresh dataset on every save instead of appending to
 * the one it already has.
 */
function toDoc(session: MuseSession): MuseSessionDoc {
  return {
    motherDatasetId: session.motherDatasetId,
    ...(session.sessionDatasetId ? { sessionDatasetId: session.sessionDatasetId } : {}),
    fragments: [...session.fragments],
    floor: floorToEntries(session.floor),
    pieces: [...session.pieces],
  }
}

function fromDoc(doc: MuseSessionDoc): MuseSession {
  return {
    motherDatasetId: doc.motherDatasetId,
    ...(doc.sessionDatasetId ? { sessionDatasetId: doc.sessionDatasetId } : {}),
    fragments: doc.fragments ?? [],
    floor: floorFromEntries(doc.floor ?? []),
    pieces: doc.pieces ?? [],
  }
}

function fromRecord(raw: Record<string, unknown>): StoredMuseSession {
  const record = raw as Record<string, unknown> & {
    id: string
    owner: string
    session: MuseSessionDoc
    natum: Date
    mutatum: Date
  }
  return {
    id: record.id,
    owner: record.owner,
    session: fromDoc(record.session),
    natum: record.natum,
    mutatum: record.mutatum,
  }
}

export class MongoMuseSession implements MuseSessions {
  constructor(private col: Collection) {}

  async create(input: CreateMuseSessionInput): Promise<StoredMuseSession> {
    const now = new Date()
    const id = uuidv4()
    await this.col.insertOne({
      id,
      owner: input.owner,
      session: toDoc(input.session),
      natum: now,
      mutatum: now,
    })
    return { id, owner: input.owner, session: input.session, natum: now, mutatum: now }
  }

  async find(id: string): Promise<StoredMuseSession | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromRecord(doc as unknown as Record<string, unknown>) : null
  }

  /**
   * One owner's sessions off one mother, most recently changed first.
   *
   * Ordered by `mutatum` rather than `natum` because the question this answers is
   * "which session was I in", and the answer is the one last worked in — a
   * session spawned later but never touched is not the one to come back to.
   *
   * Both the owner and the mother are part of the query, never a post-filter, so
   * there is no point at which a row belonging to another identity is in hand.
   */
  async listByOwner(owner: string, motherDatasetId: string): Promise<StoredMuseSession[]> {
    const docs = await this.col
      .find({ owner, 'session.motherDatasetId': motherDatasetId })
      .sort({ mutatum: -1 })
      .toArray()
    return docs.map((doc) => fromRecord(doc as unknown as Record<string, unknown>))
  }

  /**
   * Replace the stored pure value wholesale and bump `mutatum`.
   *
   * Wholesale rather than field-by-field because the pure module returns a whole
   * new session per mutation and is the only thing allowed to compute one: a
   * partial write would need this file to know which fields a given mutator
   * touched, which is a second copy of the domain rules and the place the two
   * would drift apart. An unknown id returns null — a session is never created
   * by a save.
   */
  async save(id: string, session: MuseSession): Promise<StoredMuseSession | null> {
    const mutatum = new Date()
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { session: toDoc(session), mutatum } },
      { returnDocument: 'after' },
    )
    if (!result) return null
    return fromRecord(result as unknown as Record<string, unknown>)
  }
}
