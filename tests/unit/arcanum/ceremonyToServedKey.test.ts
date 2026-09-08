// The seam the ceremony is actually judged on: a contribution goes in at /v1/ceremony
// and the key that comes out is the one /arcanum/circuit/zkey hands to clients.
//
// Both halves were tested and neither test could see the other. The sequencer suite
// proved a contribution appends to the chain; the router suite proved a zkey is served
// with the right length. Nothing joined them — so the live site could publish a
// transcript ending in `dd9668…` while serving the key its image was built with, and
// every test stayed green. That is what shipped.
//
// This walks the whole path over one custody store and one ceremony record, exactly as
// index.ts wires them: open → download the head → contribute → finalize → download the
// proving key, and insists the bytes at the end are the ones the transcript names. The
// two ways it can go wrong are pinned too, because "serves nothing" and "serves the
// wrong key" are very different failures and only one of them is safe.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createArcanumRouter } from '../../../src/api/arcanum/arcanumRouter.js'
import { createCeremoniaRouter } from '../../../src/api/arcanum/ceremoniaRouter.js'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import { LocalZkeyCustody, sha256Hex } from '../../../src/arcanum/CeremoniaCustody.js'
import { createProvingKeySource } from '../../../src/arcanum/ProvingKeySource.js'
import type { ArcanumIssuer } from '../../../src/ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../../../src/arcanum/ArcanumTree.js'
import { fakeZkey, type FakeLink } from './fakeZkey.js'

// No ptau here, so `verifyContinuation` runs the chain check and skips the snarkjs deep
// verify — the same degraded mode a sequencer without the 1.2GB ptau mounted runs in.
// The chain check is the part that binds an upload to the head, and it is what this
// walk needs; the deep verify has its own coverage.
const R1CS = path.join(tmpdir(), 'no-such-arcanum.r1cs')

interface Rig {
  url: string
  store: MemoryCeremoniaStore
  custody: LocalZkeyCustody
  close: () => Promise<void>
}

async function rig(): Promise<Rig> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ceremony-custody-'))
  const store = new MemoryCeremoniaStore()
  const custody = new LocalZkeyCustody(dir)

  const app = express()
  app.use('/v1/ceremony', express.json(), createCeremoniaRouter(store, {
    custody,
    verifier: { r1csPath: R1CS },
  }))
  // Wired the way index.ts wires it: the SAME store and custody the sequencer writes to.
  app.use('/arcanum', express.json(), createArcanumRouter(
    {} as unknown as ArcanumIssuer,
    {} as unknown as ArcanumTreeStore,
    {
      provingKey: createProvingKeySource({
        store,
        custody,
        repoZkeyPath: path.join(tmpdir(), 'no-such-repo.zkey'),
      }),
    },
  ))

  const server: http.Server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}`,
    store,
    custody,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
      rmSync(dir, { recursive: true, force: true })
    }),
  }
}

async function get(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

const json = async (url: string) => {
  const r = await get(url)
  return { status: r.status, body: r.body.length ? JSON.parse(r.body.toString('utf8')) : null }
}

function post(url: string, body: Buffer, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': body.length, ...headers },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** Open the ceremony on a root key the sequencer holds, as `CEREMONY_OPEN=1` does at boot. */
async function open(r: Rig, links: FakeLink[] = []): Promise<string> {
  const root = fakeZkey(links)
  const rootHash = sha256Hex(root)
  await r.custody.put(rootHash, root)
  await r.store.open(rootHash)
  return rootHash
}

test('a contribution lands in the sequencer and the finalized key is the one the site serves', async () => {
  const r = await rig()
  try {
    await open(r)

    // 1 — the contributor downloads the head, exactly as lib/ceremony.ts does.
    const head = await get(`${r.url}/v1/ceremony/current.zkey`)
    assert.equal(head.status, 200)
    const basedOn = String(head.headers['x-zkey-hash'])
    assert.equal(basedOn, sha256Hex(head.body))

    // 2 — they fold their randomness into it. Off-box, in the real flow: the browser.
    const contributed = fakeZkey([{ seed: 'a contributor secret', name: 'freya' }])

    // 3 — upload. The sequencer verifies it continues the head it handed out.
    const up = await post(`${r.url}/v1/ceremony/contributions`, contributed, {
      'x-based-on': basedOn,
      'x-contributor-name': 'freya',
    })
    assert.equal(up.status, 201, JSON.stringify(up.body))
    assert.equal(up.body.chain.length, 1)
    assert.equal(up.body.chain[0].name, 'freya')
    assert.equal(up.body.chain[0].outputHash, sha256Hex(contributed))
    // The new head is the contribution — the next contributor builds on THIS.
    assert.equal(up.body.headHash, sha256Hex(contributed))

    // 4 — the coordinator applies the beacon off-box and publishes the result into
    // custody, which is what CEREMONY_FINAL_ZKEY does at boot.
    const beaconed = fakeZkey([{ seed: 'a contributor secret', name: 'freya' }, { seed: 'beacon' }])
    const finalHash = sha256Hex(beaconed)
    await r.custody.put(finalHash, beaconed)
    await r.store.finalize(finalHash)

    // 5 — the transcript names that key…
    const transcript = await json(`${r.url}/v1/ceremony`)
    assert.equal(transcript.body.phase, 'finalized')
    assert.equal(transcript.body.finalHash, finalHash)

    // …and the site serves it. This is the assertion nothing made before: the bytes a
    // client proves with, hashed, against the hash the public record published.
    const cfg = await json(`${r.url}/arcanum/config`)
    assert.equal(cfg.body.zkeySource, 'ceremony')
    assert.equal(cfg.body.zkeyHash, finalHash)

    const served = await get(`${r.url}/arcanum/circuit/zkey`)
    assert.equal(served.status, 200)
    assert.equal(sha256Hex(served.body), finalHash)
    assert.equal(served.headers['x-zkey-hash'], finalHash)
    assert.deepEqual(served.body, beaconed)
  } finally {
    await r.close()
  }
})

test('a finalized ceremony whose key was never published serves nothing rather than the wrong key', async () => {
  const r = await rig()
  try {
    await open(r)
    // Finalized at a hash custody has never held — the coordinator forgot
    // CEREMONY_FINAL_ZKEY, which is the deploy mistake this guards.
    const finalHash = sha256Hex(fakeZkey([{ seed: 'never published' }]))
    await r.store.finalize(finalHash)

    const cfg = await json(`${r.url}/arcanum/config`)
    assert.equal(cfg.body.zkeySource, 'none')
    assert.equal(cfg.body.zkeyHash, finalHash) // we know which key belongs here
    assert.equal(cfg.body.zkeyUrl, null)
    assert.equal(cfg.body.ready, false)

    // 503, not 404: the artifact exists, this server has not got it. And no bytes —
    // handing over some other key under a finished transcript is the failure itself.
    const served = await get(`${r.url}/arcanum/circuit/zkey`)
    assert.equal(served.status, 503)
    assert.match(JSON.parse(served.body.toString('utf8')).error, /not published on this server/)
  } finally {
    await r.close()
  }
})

test('a contribution built on a stale head is refused, so the chain the transcript shows cannot fork', async () => {
  const r = await rig()
  try {
    const rootHash = await open(r)

    // Two contributors both fetch the root, and one lands first.
    const first = fakeZkey([{ seed: 'first' }])
    const ok = await post(`${r.url}/v1/ceremony/contributions`, first, {
      'x-based-on': rootHash, 'x-contributor-name': 'first',
    })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))

    // The second still holds the root as its head. Its key is a perfectly valid
    // continuation of the ROOT — and taking it would drop `first` from the chain.
    const second = fakeZkey([{ seed: 'second' }])
    const stale = await post(`${r.url}/v1/ceremony/contributions`, second, {
      'x-based-on': rootHash, 'x-contributor-name': 'second',
    })
    assert.equal(stale.status, 409)
    assert.match(stale.body.error, /stale head/)
    assert.equal(stale.body.head, sha256Hex(first))

    const transcript = await json(`${r.url}/v1/ceremony`)
    assert.equal(transcript.body.chain.length, 1)
    assert.equal(transcript.body.chain[0].name, 'first')
  } finally {
    await r.close()
  }
})
