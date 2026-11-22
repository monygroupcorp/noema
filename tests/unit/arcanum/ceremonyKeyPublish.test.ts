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
  /** The route a client actually fetches the key from — status and parsed body. */
  zkey: () => Promise<{ status: number; body: Record<string, unknown> | null }>
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
  const fetchJson = (path: string) => new Promise<{ status: number; body: any }>((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        // A served key is 5MB of binary; only the refusal has a body worth reading.
        const json = res.headers['content-type']?.includes('json') ? JSON.parse(raw) : null
        resolve({ status: res.statusCode ?? 0, body: json })
      })
      res.on('error', reject)
    }).on('error', reject)
  })

  return {
    config: async () => (await fetchJson('/arcanum/config')).body,
    zkey: () => fetchJson('/arcanum/circuit/zkey'),
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

test('a finalized ceremony whose key the image does NOT carry serves nothing', async () => {
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

// The deploy step that keeps getting skipped, removed.
//
// Twice now the key has been right and the site has served nothing, because publishing it
// into custody was a separate manual act on the box whose omission is silent to everyone
// but whoever reads the boot log. Once the ceremony's own output is the committed key,
// the image is already carrying the exact bytes the transcript names, and there is
// nothing left for an operator to get wrong: the hash decides.
test('the committed key IS served when it hashes to finalHash — no env, no custody, no deploy step', async () => {
  const rig = await boot({}, TRACKED_HASH)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'ceremony',
      'the image key hashes to the transcript finalHash, so it IS the ceremony key')
    assert.equal(config.zkeyHash, TRACKED_HASH)
    assert.equal(config.ready, true, 'and the site is ready to serve proofs with nothing set')
    assert.ok(config.zkeyUrl, 'clients get a url to fetch it from')
  } finally {
    await rig.close()
  }
})

test('one byte off and it is refused — the hash decides, not the fact that a key is present', async () => {
  // The guard the case above rests on. A committed key that is NOT the transcript's is
  // exactly the situation #593 exists to refuse, and it still refuses it.
  const nearly = TRACKED_HASH.slice(0, -1) + (TRACKED_HASH.endsWith('a') ? 'b' : 'a')
  const rig = await boot({}, nearly)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'none', 'a key that is not the named one is not served')
    assert.equal(config.ready, false)
    assert.equal(config.zkeyHash, nearly, 'and /config still names the key that belongs here')
  } finally {
    await rig.close()
  }
})

// ── Which of the two failures is this box in? ─────────────────────────────────
//
// `zkeySource: 'none'` under a finished transcript is two different boxes wearing one
// answer, and they want opposite work:
//
//   custody emptied by a deploy   — the bytes are gone from this box and nothing else is
//                                   wrong. Publish the key here and it is over.
//   a build older than the key    — this box is not missing a proving key at all. It is
//                                   carrying one, and the ceremony finished after it was
//                                   built, so no act on this box can help: the remedy is
//                                   somewhere else entirely, in what is deployed here.
//
// The hash of the key the build carries is what separates them, and until now it existed
// only in the boot log — the one surface nobody outside the box can read. That is how a
// finished ceremony sat unserved: the site said "not published here yet" for ten days
// while the answer, "you are running a build from before it", was never asked for because
// nothing on any public surface could be asked it.

test('a box holding a key the transcript does not name says which key it is holding', async () => {
  // The live shape: the transcript names a key this build does not carry, and the build is
  // carrying a different one.
  const other = 'cd'.repeat(32)
  const rig = await boot({}, other)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'none', 'still refuses to serve it — that part is right')
    assert.equal(config.zkeyHash, other, 'and still names the key that belongs here')
    assert.equal(config.imageKeyHash, TRACKED_HASH,
      'and now also names the key it IS holding, which is the whole diagnosis')
    assert.notEqual(config.imageKeyHash, config.zkeyHash,
      'two different keys, side by side, is the fact somebody had to go to the box for')
  } finally {
    await rig.close()
  }
})

test('the refusal at /arcanum/circuit/zkey carries both hashes too', async () => {
  // This is the route that fails, so it is where somebody looks first. An error that says
  // only "not published on this server" sends them to publish a key on a box that cannot
  // use one.
  const other = 'cd'.repeat(32)
  const rig = await boot({}, other)
  try {
    const { status, body } = await rig.zkey()
    assert.equal(status, 503, 'a key we know the name of and do not have is a gap, not a 404')
    assert.equal(body?.expectedHash, other)
    assert.equal(body?.imageKeyHash, TRACKED_HASH)
  } finally {
    await rig.close()
  }
})

test('a box that is serving the ceremony key names no image key — there is nothing to tell apart', async () => {
  const rig = await boot({}, TRACKED_HASH)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'ceremony')
    assert.equal(config.imageKeyHash, null,
      'the key it holds IS the key it serves, and zkeyHash already named it')
  } finally {
    await rig.close()
  }
})

test('and neither does one serving it out of custody', async () => {
  const rig = await boot({
    CEREMONY_FINAL_ZKEY: REPO_ZKEY_PATH,
    CEREMONY_FINALIZE: TRACKED_HASH,
  }, TRACKED_HASH)
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'ceremony')
    assert.equal(config.imageKeyHash, null)
  } finally {
    await rig.close()
  }
})

test('an externally hosted key reports no image key either — we are not serving one', async () => {
  // ARCANUM_ZKEY_URL means the bytes are somebody else's to serve. Naming what happens to
  // be lying around in this image would invite a comparison against a key nobody fetches.
  const rig = await boot({ ARCANUM_ZKEY_URL: 'https://example.invalid/arcanum_final.zkey' }, 'cd'.repeat(32))
  try {
    const config = await rig.config()
    assert.equal(config.zkeySource, 'external')
    assert.equal(config.imageKeyHash, null)
  } finally {
    await rig.close()
  }
})
