// The boot-time half of "the site serves the ceremony's own key".
//
// Once the ceremony is finalized the server serves the key its transcript names or it
// serves nothing — and the only way the key gets into custody is CEREMONY_FINAL_ZKEY,
// read at boot by mountCeremony. That step had no test, so the deploy it gates was a
// thing you could only find out about by doing it: the live site read `zkeySource: none,
// ready: false` under a finished transcript for two days, which is the refusal working,
// but nothing here said what to set to end it.
//
// So this walks the deploy itself against the tracked key: set the two env lines, boot,
// and ask /arcanum/config what it is serving. The two ways the deploy goes wrong are
// pinned beside it, because a key that disagrees with the hash it is declared under must
// not be published, and a boot with neither must leave the site serving nothing rather
// than fall back to whatever the image was built with.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mountCeremony, ceremonyCustodyDir } from '../../../src/api/arcanum/mountCeremony.js'
import { createArcanumRouter, REPO_ZKEY_PATH } from '../../../src/api/arcanum/arcanumRouter.js'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import { LocalZkeyCustody } from '../../../src/arcanum/CeremoniaCustody.js'
import { createProvingKeySource } from '../../../src/arcanum/ProvingKeySource.js'
import type { ArcanumIssuer } from '../../../src/ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../../../src/arcanum/ArcanumTree.js'

// The tracked proving key is the ceremony's own output, so its sha256 is the finalHash a
// finished transcript names. Read it rather than typing it: the test is about the wiring,
// and it should follow the key the repo actually carries.
const TRACKED = readFileSync(REPO_ZKEY_PATH)
const TRACKED_HASH = createHash('sha256').update(TRACKED).digest('hex')

// Every boot below runs under its own env; nothing leaks into the next test or the suite.
const ENV_KEYS = ['CEREMONY_FINAL_ZKEY', 'CEREMONY_FINALIZE', 'CEREMONY_ZKEY_DIR', 'ARCANUM_ZKEY_URL'] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
const dirs: string[] = []

after(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

interface Boot {
  config: () => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

/**
 * Boot the ceremony exactly as index.ts does — mountCeremony first, then the arcanum
 * router over the same store and the same custody directory — against a finalized
 * transcript naming `finalHash`.
 */
async function boot(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, finalHash: string): Promise<Boot> {
  for (const k of ENV_KEYS) delete process.env[k]
  const dir = mkdtempSync(path.join(tmpdir(), 'ceremony-publish-'))
  dirs.push(dir)
  process.env.CEREMONY_ZKEY_DIR = dir
  for (const [k, v] of Object.entries(env)) process.env[k] = v

  const store = new MemoryCeremoniaStore()
  await store.open('ab'.repeat(32))
  await store.finalize(finalHash)

  const app = express()
  await mountCeremony(app, store)
  app.use('/arcanum', express.json(), createArcanumRouter(
    {} as unknown as ArcanumIssuer,
    {} as unknown as ArcanumTreeStore,
    {
      zkeyUrl: process.env.ARCANUM_ZKEY_URL,
      provingKey: createProvingKeySource({
        store,
        custody: new LocalZkeyCustody(ceremonyCustodyDir()),
        repoZkeyPath: REPO_ZKEY_PATH,
      }),
    },
  ))

  const server: http.Server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })
  const { port } = server.address() as { port: number }
  return {
    config: () => new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/arcanum/config`, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c as Buffer))
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
        res.on('error', reject)
      }).on('error', reject)
    }),
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    }),
  }
}

test('CEREMONY_FINAL_ZKEY publishes the tracked key, and the site then serves what the transcript names', async () => {
  const rig = await boot({
    CEREMONY_FINAL_ZKEY: REPO_ZKEY_PATH,
    CEREMONY_FINALIZE: TRACKED_HASH,
  }, TRACKED_HASH)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'ceremony', 'the key is served out of ceremony custody')
    assert.equal(config.zkeyHash, TRACKED_HASH, 'and it is the key the transcript names')
    assert.equal(config.ready, true)
    assert.ok(config.zkeyUrl, 'a served key gets a url clients can fetch it from')
  } finally {
    await rig.close()
  }
})

test('a final key that does not hash to CEREMONY_FINALIZE is not published', async () => {
  const wrong = 'ff'.repeat(32)
  const rig = await boot({
    CEREMONY_FINAL_ZKEY: REPO_ZKEY_PATH,
    CEREMONY_FINALIZE: wrong,
  }, wrong)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'none', 'the mismatch is refused rather than published')
    assert.equal(config.zkeyUrl, null)
    assert.equal(config.ready, false)
    assert.equal(config.zkeyHash, wrong, 'and /config still names the key that belongs here')
  } finally {
    await rig.close()
  }
})

test('a finalized ceremony with no CEREMONY_FINAL_ZKEY serves nothing — not the image key', async () => {
  // The state the live site was in: the transcript is finished, the deploy published no
  // key, and the committed key is NOT served in its place because it is not the one the
  // transcript names.
  const other = 'cd'.repeat(32)
  const rig = await boot({}, other)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'none')
    assert.equal(config.ready, false)
    assert.notEqual(config.zkeyHash, TRACKED_HASH)
  } finally {
    await rig.close()
  }
})
