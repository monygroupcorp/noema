import type { Db } from 'mongodb'

export async function ensureWideIndexes(db: Db): Promise<void> {
  const col = db.collection('wide_events')
  await Promise.all([
    col.createIndex({ ts: -1 }),
    col.createIndex({ animaId: 1, ts: -1 }),
    col.createIndex({ modusId: 1, ts: -1 }),
    col.createIndex({ status: 1, ts: -1 }),
    col.createIndex({ actumId: 1 }, { unique: true }),
  ])
}
