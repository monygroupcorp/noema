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

function makeServer(config: ArcanumRouterConfig = {}) {
  const router = createArcanumRouter(
    {} as unknown as ArcanumIssuer,
    {} as unknown as ArcanumTreeStore,
    config,
  )
  const app = express()
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
