// Build #5 (live shell) — SqliteAitkJobStore against a REAL node:sqlite temp DB. Proves the
// seed matches what ai-toolkit's UITrainer expects (a row it can UPDATE) and that read
// projects the row to an AitkJob, including a second connection's writes (UITrainer's UPDATEs
// over the same host-mounted file).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteAitkJobStore } from '../../../src/crystal/AitkJobStore.js'

async function withDb(body: (dbPath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'aitk-store-'))
  try { await body(join(dir, 'aitk_db.db')) }
  finally { await rm(dir, { recursive: true, force: true }) }
}

test('seed creates a queued row; read projects status/step; a second connection (UITrainer) is visible', async () => {
  await withDb(async (dbPath) => {
    const store = new SqliteAitkJobStore(dbPath)
    assert.equal(await store.read('j1'), undefined)            // not seeded yet

    await store.seed('j1')
    assert.deepEqual(await store.read('j1'), { status: 'queued', step: 0, info: 'seeded by crystal' })

    // Simulate ai-toolkit's UITrainer UPDATE over the same file (separate connection).
    const ui = new DatabaseSync(dbPath)
    ui.prepare("UPDATE Job SET status='running', step=?, info=?, speed_string=? WHERE id=?")
      .run(30, 'Training', '2.00 iter/sec', 'j1')
    ui.close()

    assert.deepEqual(await store.read('j1'), {
      status: 'running', step: 30, info: 'Training', speed_string: '2.00 iter/sec',
    })
    store.close()
  })
})

test('re-seeding an existing job resets it to queued (resume-clean)', async () => {
  await withDb(async (dbPath) => {
    const store = new SqliteAitkJobStore(dbPath)
    await store.seed('j1')
    const ui = new DatabaseSync(dbPath)
    ui.prepare("UPDATE Job SET status='error', step=42, stop=1, info='CUDA OOM' WHERE id=?").run('j1')
    ui.close()
    assert.equal((await store.read('j1'))?.status, 'error')

    await store.seed('j1')   // re-run
    const row = await store.read('j1')
    assert.equal(row?.status, 'queued')
    assert.equal(row?.step, 42)         // step preserved (ai-toolkit resumes from the checkpoint)
    assert.equal(row?.info, 're-run')
    store.close()
  })
})

test('empty info / speed_string are omitted (undefined), not surfaced as empty strings', async () => {
  await withDb(async (dbPath) => {
    const store = new SqliteAitkJobStore(dbPath)
    await store.seed('j1')
    const ui = new DatabaseSync(dbPath)
    ui.prepare("UPDATE Job SET status='running', step=5, info='', speed_string='' WHERE id=?").run('j1')
    ui.close()
    const row = await store.read('j1')
    assert.deepEqual(row, { status: 'running', step: 5 })   // no info/speed keys
    store.close()
  })
})
