// Custody is the sequencer's own disk, and the ceremony record is not.
//
// The transcript lives in the database: it survives a deploy, a restart, a new box. The
// keys it names are files, and until deploy.sh mounted a directory for them they lived
// inside the container — so a routine deploy left the record intact and the keys gone.
// The result is a ceremony that reads "open · accepting contributions" on the page while
// every route it offers answers 503, permanently, with nothing in the product able to
// put it back: the only way to store bytes in custody was to be handed a contribution,
// and no contribution could start without the head that was missing.
//
// These pin the way back. CEREMONY_HEAD_ZKEY restores the head the transcript already
// names, checked against that published hash so the wrong file cannot be installed under
// the right name; and a sequencer that does not hold its head says so in its status
// rather than inviting a contribution it cannot take.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mountCeremony } from '../../../src/api/arcanum/mountCeremony.js'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import { LocalZkeyCustody, sha256Hex } from '../../../src/arcanum/CeremoniaCustody.js'
import { fakeZkey, type FakeLink } from './fakeZkey.js'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'

const ROOT: FakeLink[] = []
const after = (chain: FakeLink[], seed: string) => [...chain, { seed, name: seed }]

/** A ceremony open on `root`, with custody pointed at a directory of our own. */
async function openCeremony(): Promise<{ store: MemoryCeremoniaStore; dir: string; root: Buffer }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ceremony-restore-'))
  const store = new MemoryCeremoniaStore()
  const root = fakeZkey(ROOT)
  await store.open(sha256Hex(root), null)
  return { store, dir, root }
}

/** Boot the sequencer the way index.ts does, under a given environment. */
async function boot(store: MemoryCeremoniaStore, dir: string, env: Record<string, string>) {
  const saved = { ...process.env }
  Object.assign(process.env, { CEREMONY_ZKEY_DIR: dir }, env)
  try {
    const app = express()
    await mountCeremony(app, store)
    return app
  } finally {
    process.env = saved
  }
}

test('a deploy that empties custody strands an open ceremony, and the status says so', async () => {
  const { store, dir } = await openCeremony()
  try {
    // No key was ever written to this directory — the state of a container that came up
    // with a fresh image while the transcript in the database went on naming a head.
    const app = await boot(store, dir, {})
    const status = await request(app).get('/v1/ceremony')
    assert.equal(status.body.phase, 'open')
    assert.equal(status.body.acceptingContributions, false)
    assert.equal((await request(app).get('/v1/ceremony/current.zkey')).status, 503)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CEREMONY_HEAD_ZKEY puts the head back and the ceremony accepts contributions again', async () => {
  const { store, dir, root } = await openCeremony()
  const keyFile = path.join(dir, 'restore.zkey')
  writeFileSync(keyFile, root)
  try {
    const app = await boot(store, dir, { CEREMONY_HEAD_ZKEY: keyFile })

    const status = await request(app).get('/v1/ceremony')
    assert.equal(status.body.acceptingContributions, true)

    // Not just "a file is present": the bytes handed out are the ones the transcript names.
    const head = await request(app).get('/v1/ceremony/current.zkey').buffer()
    assert.equal(head.status, 200)
    assert.equal(sha256Hex(head.body as Buffer), sha256Hex(root))

    // And the flow the strand had broken runs again, end to end.
    const next = fakeZkey(after(ROOT, 'c1'))
    const res = await request(app).post('/v1/ceremony/contributions')
      .set('x-based-on', sha256Hex(root)).set('x-contributor-name', 'c1')
      .set('Content-Type', 'application/octet-stream').send(next)
    assert.equal(res.status, 201)
    assert.equal(res.body.headHash, sha256Hex(next))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CEREMONY_HEAD_ZKEY refuses a file that is not the head the transcript published', async () => {
  const { store, dir } = await openCeremony()
  const keyFile = path.join(dir, 'wrong.zkey')
  // A real zkey, and a valid one — just not this ceremony's head. Installing it would
  // put the chain somewhere the public record does not say it is.
  writeFileSync(keyFile, fakeZkey(after(ROOT, 'somebody-elses')))
  try {
    const app = await boot(store, dir, { CEREMONY_HEAD_ZKEY: keyFile })
    assert.equal((await request(app).get('/v1/ceremony')).body.acceptingContributions, false)
    assert.equal((await request(app).get('/v1/ceremony/current.zkey')).status, 503)
    // Nothing was written under any name: custody is empty, not wrong.
    const custody = new LocalZkeyCustody(dir)
    assert.equal(await custody.has(sha256Hex(fakeZkey(after(ROOT, 'somebody-elses')))), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Restoring a FINALIZED ceremony is a different variable, and the difference is invisible
// until someone reads which hash the server looks up. The head is the last contribution's
// output; the key the site serves is the beacon'd finalHash applied after it. So an
// operator facing a finalized ceremony that serves nothing, reaching for the variable the
// recovery docs name, restores a real key under a real hash and changes nothing.
test('on a finalized ceremony the head is not the key the site serves — CEREMONY_FINAL_ZKEY is', async () => {
  const { store, dir, root } = await openCeremony()
  const contributed = fakeZkey(after(ROOT, 'c1'))
  await store.appendContribution(
    { index: 1, name: 'c1', outputHash: sha256Hex(contributed) }, sha256Hex(root), 'c1-key',
  )
  // The beacon is applied off the sequencer, so the final key is bytes no contribution
  // produced and no hash in the chain names.
  const final = fakeZkey(after(after(ROOT, 'c1'), 'beacon'))
  await store.finalize(sha256Hex(final))

  const headFile = path.join(dir, 'head.zkey')
  const finalFile = path.join(dir, 'final.zkey')
  writeFileSync(headFile, contributed)
  writeFileSync(finalFile, final)
  const custody = new LocalZkeyCustody(dir)
  try {
    // The head goes in — it IS the head, and the record names it — and the site still has
    // nothing to serve, because what it resolves by is finalHash.
    const said: LogEntry[] = []
    const listen = (e: LogEntry) => said.push(e)
    bus.on('log', listen)
    try {
      await boot(store, dir, { CEREMONY_HEAD_ZKEY: headFile })
    } finally {
      bus.off('log', listen)
    }
    assert.equal(await custody.has(sha256Hex(contributed)), true)
    assert.equal(await custody.has(sha256Hex(final)), false)

    // Which is a success the operator must not read as one: the restore is told it did
    // nothing for the 503, and told which variable would.
    const warned = said.find(e => e.level === 'warn' && /FINALIZED/.test(e.msg))
    assert.ok(warned, 'restoring a head on a finalized ceremony said nothing about it')
    assert.match(warned.msg, /CEREMONY_FINAL_ZKEY/)
    assert.equal((warned as unknown as { finalHash: string }).finalHash, sha256Hex(final))

    // The variable that ends the 503.
    await boot(store, dir, { CEREMONY_FINAL_ZKEY: finalFile, CEREMONY_FINALIZE: sha256Hex(final) })
    assert.equal(await custody.has(sha256Hex(final)), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
