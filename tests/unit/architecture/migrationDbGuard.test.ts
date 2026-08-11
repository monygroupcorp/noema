import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveDbTarget, DbTargetRefusedError, LIVE_DB, LEGACY_DB } from '../../../scripts/migrations/_dbTarget.js'

// Every migration under scripts/migrations/ must resolve its --db target through the
// single shared resolver in _dbTarget.ts, not a local reimplementation. A per-script
// copy is how the live/legacy db names silently drifted apart in the first place: the
// guard named `noema` as production, but the running prod container sets
// `DB_NAME=noemaplane` — so the guard protected a dead db and left the live one
// unguarded. See scripts/migrations/_dbTarget.ts for the measured fact.

const MIGRATIONS_DIR = path.join(process.cwd(), 'scripts/migrations')
const FALSE_SENTENCE = 'Use --db noemaplane for dev/test'

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.ts') && f !== '_dbTarget.ts')
    .sort()
}

test('every migration imports resolveDbTarget from ./_dbTarget', () => {
  const files = migrationFiles()
  assert.ok(files.length > 0, 'no migration files found under scripts/migrations/')

  const missing = files.filter(f => {
    const src = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    return !/import\s*\{[^}]*resolveDbTarget[^}]*\}\s*from\s*['"]\.\/_dbTarget(\.js)?['"]/.test(src)
  })

  assert.deepEqual(
    missing,
    [],
    `migration(s) not importing resolveDbTarget from ./_dbTarget: ${missing.join(', ')} — ` +
      `the prod container's measured DB_NAME is noemaplane, not noema; every migration must ` +
      `resolve its --db target through the shared resolver, never a local reimplementation`,
  )
})

test('no migration re-implements its own literal db-name comparison', () => {
  const files = migrationFiles()

  const offenders = files.filter(f => {
    const src = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    return /===\s*'noema'/.test(src) || /'noema'\s*===/.test(src)
  })

  assert.deepEqual(
    offenders,
    [],
    `migration(s) with a local literal 'noema' comparison: ${offenders.join(', ')} — this is exactly ` +
      `the per-script drift that inverted the guard; compare against LIVE_DB/LEGACY_DB from ./_dbTarget ` +
      `only, never a fresh string literal`,
  )
})

test('no migration carries the stale false guard sentence', () => {
  const files = migrationFiles()

  const offenders = files.filter(f => {
    const src = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    return src.includes(FALSE_SENTENCE)
  })

  assert.deepEqual(
    offenders,
    [],
    `migration(s) still carrying the false guard sentence "${FALSE_SENTENCE}": ${offenders.join(', ')} — ` +
      `noemaplane IS the live db (prod container's measured DB_NAME); this is the exact copy-pasted ` +
      `header line that misled operators`,
  )
})

// resolveDbTarget behaviour — every REFUSAL is decided before any Mongo connection, so
// these are exercised as a pure function with synthetic argv, no spawn, no Mongo, no .env.
// Covers all six rows of the amendment's contract table.

test('resolveDbTarget: no --db -> refuse', () => {
  assert.throws(() => resolveDbTarget([], 'tag'), DbTargetRefusedError)
})

test(`resolveDbTarget: --db ${LEGACY_DB} (legacy) -> refuse`, () => {
  assert.throws(() => resolveDbTarget(['--db', LEGACY_DB], 'tag'), DbTargetRefusedError)
})

test(`resolveDbTarget: --db ${LEGACY_DB} --prod (legacy) -> refuse even with --prod`, () => {
  assert.throws(() => resolveDbTarget(['--db', LEGACY_DB, '--prod'], 'tag'), DbTargetRefusedError)
})

test(`resolveDbTarget: --db ${LIVE_DB} (live), no --prod -> refuse`, () => {
  assert.throws(() => resolveDbTarget(['--db', LIVE_DB], 'tag'), DbTargetRefusedError)
})

test(`resolveDbTarget: --db ${LIVE_DB} --prod (live) -> accepted`, () => {
  const target = resolveDbTarget(['--db', LIVE_DB, '--prod'], 'tag')
  assert.deepEqual(target, { db: LIVE_DB, dryRun: false })
})

test('resolveDbTarget: --db <unknown>, no --allow-unknown-db -> refuse', () => {
  assert.throws(() => resolveDbTarget(['--db', 'definitely-not-a-db'], 'tag'), DbTargetRefusedError)
})

test('resolveDbTarget: --db <unknown> --allow-unknown-db -> accepted', () => {
  const target = resolveDbTarget(['--db', 'definitely-not-a-db', '--allow-unknown-db'], 'tag')
  assert.deepEqual(target, { db: 'definitely-not-a-db', dryRun: false })
})
