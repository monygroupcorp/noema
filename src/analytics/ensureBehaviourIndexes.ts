import type { Db } from 'mongodb'

export async function ensureBehaviourIndexes(db: Db): Promise<void> {
  const col = db.collection('behaviour_events')
  await Promise.all([
    col.createIndex({ ts: -1 }),
    col.createIndex({ kind: 1, ts: -1 }),
    col.createIndex({ ownerKey: 1, ts: -1 }),
  ])
}
