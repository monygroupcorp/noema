import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, globSync } from 'node:fs'

// The Mongo-backed suites (test:crystal) run one process per file, in parallel, against whatever
// MONGODB_URI names — an ephemeral mongo:7 in CI, a hosted cluster locally. Two properties keep a
// suite green on both:
//
// 1. Database names fit the strictest server the suite is pointed at. Atlas refuses a database name
//    longer than 38 bytes; a local mongod accepts it, so an over-long name passes CI and fails every
//    test in the file on a hosted cluster.
// 2. No two files share a database + collection. Each file clears its collections between tests,
//    so a shared collection lets one file wipe another's fixtures mid-test. It only shows when the
//    two processes interleave, which a high-latency server makes likely and a local one rare.

const MAX_DB_NAME_BYTES = 38

const files = globSync('tests/**/*.test.ts')

test(`every test database name is at most ${MAX_DB_NAME_BYTES} bytes`, () => {
  const tooLong: string[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    for (const [, name] of src.matchAll(/'(noemaplane[A-Za-z0-9_]*)'/g)) {
      if (Buffer.byteLength(name) > MAX_DB_NAME_BYTES) tooLong.push(`${file}: ${name}`)
    }
  }
  assert.deepEqual(tooLong, [], `database names over ${MAX_DB_NAME_BYTES} bytes: ${tooLong.join(', ')}`)
})

test('no two test files share a database + collection', () => {
  const owners = new Map<string, string[]>()
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const db = /const DB\s*=\s*'(noemaplane[A-Za-z0-9_]*)'/.exec(src)?.[1]
    if (!db) continue
    const collections = new Set<string>()
    for (const [, c] of src.matchAll(/_?COL[A-Z_]*\s*=\s*'([A-Za-z0-9_]+)'/g)) collections.add(c)
    for (const [, c] of src.matchAll(/\.collection\(\s*'([A-Za-z0-9_]+)'/g)) collections.add(c)
    for (const c of collections) {
      const key = `${db}.${c}`
      owners.set(key, [...(owners.get(key) ?? []), file])
    }
  }
  const shared = [...owners].filter(([, fs]) => fs.length > 1).map(([k, fs]) => `${k} (${fs.join(', ')})`)
  assert.deepEqual(shared, [], `collections shared across test files: ${shared.join('; ')}`)
})
