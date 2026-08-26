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

import { floorFromEntries, floorToEntries, MuseSessionVersionConflict } from '../types/museSession.js'
import type {
  CreateMuseSessionInput,
  FloorEntry,
  MuseSessions,
  StoredMuseSession,
} from '../types/museSession.js'
import type { KeptRoll, MuseSession, MuseSetup, Piece } from './muse/session.js'
import type { Fragment } from './muse/taxonomy.js'

/** The persisted form of a session's pure value: the floor flattened to entries. */
interface MuseSessionDoc {
  motherDatasetId: string
  /** The session's own dataset. Absent until the session's first save mints it. */
  sessionDatasetId?: string
  fragments: Fragment[]
  floor: FloorEntry[]
  pieces: Piece[]
  /**
   * What the session fires its draw through — the flow, the run shape, the model
   * stack, the standing affix. Absent until a setup is committed, and stored as the
   * pure module normalized it: no acknowledgement and no view state can be in here,
   * because `normalizeSetup` gives neither a field to land in.
   */
  setup?: MuseSetup
  /**
   * The rolls the user kept, in the order they kept them. Absent on a document
   * written before the field existed, and absent when the list is empty — the two
   * read identically, which is what "absent means empty" buys: no backfill.
   */
  keptRolls?: KeptRoll[]
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
    ...(session.setup ? { setup: session.setup } : {}),
    ...(session.keptRolls?.length ? { keptRolls: session.keptRolls.map((r) => ({ ...r })) } : {}),
  }
}

function fromDoc(doc: MuseSessionDoc): MuseSession {
  return {
    motherDatasetId: doc.motherDatasetId,
    ...(doc.sessionDatasetId ? { sessionDatasetId: doc.sessionDatasetId } : {}),
    fragments: doc.fragments ?? [],
    floor: floorFromEntries(doc.floor ?? []),
    pieces: doc.pieces ?? [],
    ...(doc.setup ? { setup: doc.setup } : {}),
    ...(doc.keptRolls?.length ? { keptRolls: doc.keptRolls.map((r) => ({ ...r })) } : {}),
  }
}

function fromRecord(raw: Record<string, unknown>): StoredMuseSession {
  const record = raw as Record<string, unknown> & {
    id: string
    owner: string
    session: MuseSessionDoc
    natum: Date
    mutatum: Date
    versio?: unknown
  }
  return {
    id: record.id,
    owner: record.owner,
    session: fromDoc(record.session),
    natum: record.natum,
    mutatum: record.mutatum,
    versio: typeof record.versio === 'number' ? record.versio : 0,
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
      versio: 0,
    })
    return { id, owner: input.owner, session: input.session, natum: now, mutatum: now, versio: 0 }
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
   * Replace the stored pure value wholesale, under a compare-and-swap on `versio`.
   *
   * Wholesale rather than field-by-field because the pure module returns a whole
   * new session per mutation and is the only thing allowed to compute one: a
   * partial write would need this file to know which fields a given mutator
   * touched, which is a second copy of the domain rules and the place the two
   * would drift apart. An unknown id returns null — a session is never created
   * by a save.
   *
   * BECAUSE THE REPLACE IS WHOLESALE, THE VERSION MATCH IS WHAT MAKES IT SAFE.
   * Every mutation is read → pure-mutate → replace. Two of them overlapping means
   * two whole sessions computed from two reads of the same document, and the
   * second to land would carry no trace of the first — a piece recorded by one
   * and a floor change made by the other cannot both survive a bare replace. The
   * update therefore matches on the version the caller read and stamps the next
   * one; a mismatch throws `MuseSessionVersionConflict` and writes nothing, which
   * is what lets the caller re-read and re-apply instead of losing a write.
   *
   * VERSION 0 ALSO MATCHES A DOCUMENT WITH NO `versio` AT ALL. Records written
   * before the field existed carry none, and absent reads as 0 (`fromRecord`), so
   * they save on their first attempt and are versioned from then on. No backfill
   * and no migration.
   */
  async save(id: string, session: MuseSession, expectedVersio: number): Promise<StoredMuseSession | null> {
    const mutatum = new Date()
    const versionMatch =
      expectedVersio === 0
        ? { $or: [{ versio: 0 }, { versio: { $exists: false } }] }
        : { versio: expectedVersio }
    const result = await this.col.findOneAndUpdate(
      { id, ...versionMatch },
      { $set: { session: toDoc(session), mutatum, versio: expectedVersio + 1 } },
      { returnDocument: 'after' },
    )
    if (result) return fromRecord(result as unknown as Record<string, unknown>)

    // No match: either the id names no session, or the version moved under us.
    // The two are different answers — null is "there is nothing here", a conflict
    // is "there is something here and it is newer than what you read".
    const present = await this.col.findOne({ id }, { projection: { _id: 1 } })
    if (!present) return null
    throw new MuseSessionVersionConflict(id, expectedVersio)
  }
}
