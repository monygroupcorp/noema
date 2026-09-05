// arcanumRouter — GET /config defaults + scheme guard.
//
// The real arcanum.wasm + arcanum_final.zkey are tracked artifacts on disk
// (src/arcanum/circuit/artifacts/), so WASM_READY / ZKEY_ON_DISK are true in
// this test environment — no fixtures needed to exercise the default-wiring
// logic itself.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createArcanumRouter, type ArcanumRouterConfig } from '../../../src/api/arcanum/arcanumRouter.js'
import type { ArcanumIssuer } from '../../../src/ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../../../src/arcanum/ArcanumTree.js'
import type { ArcanumVerifier } from '../../../src/arcanum/ArcanumVerifier.js'
import type { Bursarum } from '../../../src/types/bursa.js'

function makeServer(config: ArcanumRouterConfig = {}) {
  const router = createArcanumRouter(
    {} as unknown as ArcanumIssuer,
    {} as unknown as ArcanumTreeStore,
    config,
  )
  const app = express()
  // The router reads `req.body` on POST, and `src/index.ts` mounts it behind a JSON parser.
  app.use(express.json())
  app.use('/arcanum', router)
  return new Promise<{ server: http.Server; url: string }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}/arcanum` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
}

function getJson(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

test('GET /config defaults zkeyUrl to the circuit/zkey route when the file exists on disk and no env override is set', async () => {
  const { server, url } = await makeServer({ serverUrl: 'https://staging.noema.art' })
  try {
    const { status, body } = await getJson(`${url}/config`)
    assert.equal(status, 200)
    assert.equal(body.zkeyUrl, 'https://staging.noema.art/arcanum/circuit/zkey')
    assert.equal(body.ready, true)
  } finally {
    await closeServer(server)
  }
})

test('GET /config: an explicit zkeyUrl (env override) always wins over the on-disk default', async () => {
  const { server, url } = await makeServer({
    serverUrl: 'https://staging.noema.art',
    zkeyUrl: 'https://cdn.example.com/ceremony/arcanum_final.zkey',
  })
  try {
    const { body } = await getJson(`${url}/config`)
    assert.equal(body.zkeyUrl, 'https://cdn.example.com/ceremony/arcanum_final.zkey')
    assert.equal(body.ready, true)
  } finally {
    await closeServer(server)
  }
})

test('GET /config: scheme-less serverUrl is normalized to https:// so wasmUrl/zkeyUrl are never relative-looking', async () => {
  const { server, url } = await makeServer({ serverUrl: 'staging.noema.art' })
  try {
    const { body } = await getJson(`${url}/config`)
    assert.equal(body.wasmUrl, 'https://staging.noema.art/arcanum/circuit/wasm')
    assert.equal(body.zkeyUrl, 'https://staging.noema.art/arcanum/circuit/zkey')
  } finally {
    await closeServer(server)
  }
})

test('GET /config: no serverUrl configured falls back to relative paths', async () => {
  const { server, url } = await makeServer({})
  try {
    const { body } = await getJson(`${url}/config`)
    assert.equal(body.wasmUrl, '/arcanum/circuit/wasm')
    assert.equal(body.zkeyUrl, '/arcanum/circuit/zkey')
  } finally {
    await closeServer(server)
  }
})

function getRaw(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; length: number }> {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let length = 0
      res.on('data', c => { length += c.length })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, length }))
      res.on('error', reject)
    }).on('error', reject)
  })
}

test('GET /circuit/zkey serves the tracked proving key with correct content-length', async () => {
  const { server, url } = await makeServer({})
  try {
    const { status, headers, length } = await getRaw(`${url}/circuit/zkey`)
    assert.equal(status, 200)
    assert.equal(headers['content-type'], 'application/octet-stream')
    assert.equal(Number(headers['content-length']), length)
    assert.ok(length > 0)
  } finally {
    await closeServer(server)
  }
})

// ── ANON_PURSE gate (noema-131) ──────────────────────────────────────────────
// The arcanum path verifies against a forgeable SOLO DEV proving key (anonymity holds,
// soundness fails). For v1 the anonymous purse is OFF: POST /issue (mint a note from
// balance) and POST /purse (mint a bearer purse) must refuse 503 BEFORE any debit/mint,
// and GET /config reports enabled:false so the UI hides the purse. Flag on = restore.

function postJson(url: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) },
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c as Buffer))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

test('ANON_PURSE off (default): POST /issue refuses 503 before any debit', async () => {
  const { server, url } = await makeServer({
    resolve: async () => ({ animaId: 'a1' }),
  })
  try {
    const { status, body } = await postJson(`${url}/issue`, { valor: '100' })
    assert.equal(status, 503)
    assert.match(String(body.error), /coming soon/i)
  } finally {
    await closeServer(server)
  }
})

test('ANON_PURSE off (default): POST /purse refuses 503 before any mint', async () => {
  const { server, url } = await makeServer({})
  try {
    const { status } = await postJson(`${url}/purse`, { arcanumProof: { a: 1 } })
    assert.equal(status, 503)
  } finally {
    await closeServer(server)
  }
})

test('ANON_PURSE off (default): GET /config reports enabled:false', async () => {
  const { server, url } = await makeServer({ serverUrl: 'https://staging.noema.art' })
  try {
    const { body } = await getJson(`${url}/config`)
    assert.equal(body.enabled, false)
  } finally {
    await closeServer(server)
  }
})

test('ANON_PURSE on: the gate is bypassed (GET /config enabled:true; /issue passes the gate)', async () => {
  const { server, url } = await makeServer({ anonPurseEnabled: true })
  try {
    const cfg = await getJson(`${url}/config`)
    assert.equal(cfg.body.enabled, true)
    // No resolver configured → past the gate the endpoint reports 501, NOT the 503 gate.
    const issue = await postJson(`${url}/issue`, { valor: '100' })
    assert.equal(issue.status, 501)
  } finally {
    await closeServer(server)
  }
})

// ── The note's valor is redeemed as-is ───────────────────────────────────────
// A note's valor is denominated in impetus points at ISSUANCE, whichever path issued it:
// /issue debits an identified impetus balance, and the blind on-chain path prices the deposit
// and converts it before writing the leaf. The number is hashed into the Merkle leaf and the
// spend proof certifies it verbatim, so /purse — the one redemption site that once ran the
// valor through an ETH-price conversion — must mint exactly what the proof certifies.
//
// Every test above stops at the 503 gate, so these run with the purse ON: the gate is what
// hides this arithmetic in v1, not a reason to leave it unpinned when the ceremony flips it.

const CERTIFIED_VALOR = 6231n  // the impetus a $2.10 deposit funds at the canonical rate

function stubVerifier(valor: bigint, spent: string[] = []) {
  return {
    verify: async () => ({ nullifierHash: 'nh-1', valor }),
    markSpent: async (nullifierHash: string) => { spent.push(nullifierHash) },
  } as unknown as ArcanumVerifier
}

function recordingBursarium(minted: bigint[]) {
  return {
    create: async (credits: bigint) => {
      minted.push(credits)
      return { id: 'purse-1', credits, createdAt: new Date() }
    },
  } as unknown as Bursarum
}

test('POST /purse mints the valor the proof certifies, with no second conversion', async () => {
  const minted: bigint[] = []
  const { server, url } = await makeServer({
    anonPurseEnabled: true,
    verifier: stubVerifier(CERTIFIED_VALOR),
    bursarium: recordingBursarium(minted),
  })
  try {
    const { status, body } = await postJson(`${url}/purse`, { arcanumProof: { a: 1 } })
    assert.equal(status, 201)
    assert.deepEqual(minted, [CERTIFIED_VALOR], 'the purse is minted for the certified valor itself')
    assert.equal(body.credits, CERTIFIED_VALOR.toString())
  } finally {
    await closeServer(server)
  }
})

test('POST /purse: a one-point note mints one credit — any re-conversion would floor it to zero', async () => {
  // The sharpest trap for a reintroduced wei→impetus conversion: read as a raw on-chain
  // amount, 1 is dust worth a fraction of a cent, and the note would redeem for nothing.
  const minted: bigint[] = []
  const { server, url } = await makeServer({
    anonPurseEnabled: true,
    verifier: stubVerifier(1n),
    bursarium: recordingBursarium(minted),
  })
  try {
    const { status, body } = await postJson(`${url}/purse`, { arcanumProof: { a: 1 } })
    assert.equal(status, 201)
    assert.deepEqual(minted, [1n])
    assert.equal(body.credits, '1')
  } finally {
    await closeServer(server)
  }
})

test('POST /purse burns the note before minting, so a failed mint cannot leave it spendable', async () => {
  const spent: string[] = []
  const { server, url } = await makeServer({
    anonPurseEnabled: true,
    verifier: stubVerifier(CERTIFIED_VALOR, spent),
    bursarium: { create: async () => { throw new Error('store down') } } as unknown as Bursarum,
  })
  try {
    const { status } = await postJson(`${url}/purse`, { arcanumProof: { a: 1 } })
    assert.equal(status, 500)
    assert.deepEqual(spent, ['nh-1'])
  } finally {
    await closeServer(server)
  }
})
