import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { RunEventHub } from '../../../../src/allocutio/api/RunEventHub.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { Run } from '../../../../src/allocutio/api/types.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeRun: Run = {
  id: 'r1', status: 'running', modusId: 'flux-schnell',
  aditus: { prompt: 'a cat', seed: 42 },
  pinnedModels: [{ role: 'checkpoint', modelId: 'flux-dev' } as any],
  modusVersion: '1.0.0',
}

// Only the methods the streaming routes reach are provided. `satisfies Partial<ApiFacade>`
// signature-checks each of them against the real facade.
function makeFakeApi() {
  return {
    async invokeFlow(): Promise<Run> { return fakeRun },
    async getRun(_auctor: AuctorKey, id: string): Promise<Run> {
      if (id === 'r1') return fakeRun
      throw Errors.notFoundRun(id)
    },
    async listFlows(): Promise<unknown[]> { return [] },
    async describeFlow(): Promise<unknown> { return {} },
  } satisfies Partial<ApiFacade>
}

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey) return { animaId: 'a1' }
    throw Errors.authMissing()
  },
  // `Identity` also carries `resolveCaller` (identity + the limits the CREDENTIAL imposes, e.g. a
  // partner API key's per-run spend ceiling). These fakes mint no ceiling, so it is `resolve` plus
  // an empty limit set — which is exactly the shape a key with no ceiling resolves to.
  async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
    return { auctor: await this.resolve(creds) }
  },
}

function makeServer(withHub: boolean): Promise<{
  server: http.Server
  url: string
  bus: EventEmitter
}> {
  return new Promise((resolve, reject) => {
    const bus = new EventEmitter()
    const hub = withHub
      ? new RunEventHub({ bus, postWebhook: async () => {} })
      : undefined
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: makeFakeApi() as unknown as ApiFacade, identity: fakeIdentity, hub }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, bus })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
}

/**
 * Open an SSE connection and collect `data:` frames until a frame matching
 * `until` is seen (or the stream ends / `timeoutMs` elapses).
 */
function collectSseFrames(
  url: string,
  headers: Record<string, string>,
  until: (frames: unknown[]) => boolean,
  timeoutMs = 3000,
): Promise<{ frames: unknown[]; status: number; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers }, res => {
      const frames: unknown[] = []
      const contentType = res.headers['content-type'] ?? ''
      let buf = ''

      const timer = setTimeout(() => {
        req.destroy()
        resolve({ frames, status: res.statusCode ?? 0, contentType })
      }, timeoutMs)

      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8')
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              frames.push(JSON.parse(line.slice('data: '.length)))
            } catch { /* ignore malformed */ }
            if (until(frames)) {
              clearTimeout(timer)
              req.destroy()
              resolve({ frames, status: res.statusCode ?? 0, contentType })
              return
            }
          }
        }
      })

      res.on('end', () => {
        clearTimeout(timer)
        resolve({ frames, status: res.statusCode ?? 0, contentType })
      })
    })
    req.on('error', (err: NodeJS.ErrnoException) => {
      // ECONNRESET is expected when we destroy the request
      if (err.code === 'ECONNRESET') return
      reject(err)
    })
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /v1/runs/r1/stream returns 200 text/event-stream with snapshot frame', async () => {
  const { server, url } = await makeServer(true)
  try {
    const { status, contentType, frames } = await collectSseFrames(
      `${url}/v1/runs/r1/stream`,
      { 'x-api-key': 'k' },
      fs => fs.length >= 1,
    )
    assert.equal(status, 200)
    assert.ok(contentType.includes('text/event-stream'), `expected text/event-stream, got ${contentType}`)
    assert.ok(frames.length >= 1, 'should have at least one frame')
    const snap = frames[0] as any
    assert.equal(snap.kind, 'snapshot')
    assert.equal(snap.run.id, 'r1')
  } finally {
    await closeServer(server)
  }
})

test('SSE snapshot stays lean/progress-only: no aditus/pinnedModels/modusVersion even though getRun returns them', async () => {
  const { server, url } = await makeServer(true)
  try {
    const { frames } = await collectSseFrames(
      `${url}/v1/runs/r1/stream`,
      { 'x-api-key': 'k' },
      fs => fs.length >= 1,
    )
    const snap = frames[0] as any
    assert.equal(snap.kind, 'snapshot')
    assert.equal(snap.run.aditus, undefined)
    assert.equal(snap.run.pinnedModels, undefined)
    assert.equal(snap.run.modusVersion, undefined)
  } finally {
    await closeServer(server)
  }
})

test('progressus bus event arrives as a typed progress frame in the SSE stream (#6c/#6e)', async () => {
  const { server, url, bus } = await makeServer(true)
  try {
    // Start listening, then emit after a short delay
    let emitted = false
    const framePromise = collectSseFrames(
      `${url}/v1/runs/r1/stream`,
      { 'x-api-key': 'k' },
      fs => fs.length >= 2,
      3000,
    )

    // Give the connection time to establish before emitting
    await new Promise(r => setTimeout(r, 50))
    if (!emitted) {
      emitted = true
      bus.emit('actum.progressus', { actumId: 'r1', progressus: { phase: 'provisioning', message: 'acquiring GPU', at: new Date(0) } })
    }

    const { frames } = await framePromise
    const frame = frames.find((f: any) => f.kind === 'progress') as any
    assert.ok(frame, 'expected a progress frame')
    assert.equal(frame.progressus.phase, 'provisioning')
    assert.equal(frame.progressus.message, 'acquiring GPU')
  } finally {
    await closeServer(server)
  }
})

test('actum.complete terminates the SSE stream', async () => {
  const { server, url, bus } = await makeServer(true)
  try {
    const framePromise = collectSseFrames(
      `${url}/v1/runs/r1/stream`,
      { 'x-api-key': 'k' },
      // wait for a terminal frame
      fs => (fs as any[]).some((f: any) => f.terminal === true),
      3000,
    )

    await new Promise(r => setTimeout(r, 50))
    bus.emit('actum.complete', { actumId: 'r1', status: 'completed' })

    const { frames } = await framePromise
    const terminalFrame = frames.find((f: any) => f.terminal === true) as any
    assert.ok(terminalFrame, 'expected a terminal frame')
    assert.equal(terminalFrame.kind, 'complete')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/runs/ghost/stream returns 404 not_found.run (JSON)', async () => {
  const { server, url } = await makeServer(true)
  try {
    const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        `${url}/v1/runs/ghost/stream`,
        { method: 'GET', headers: { 'x-api-key': 'k' } },
        res => {
          const chunks: Buffer[] = []
          res.on('data', c => chunks.push(c as Buffer))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(result.status, 404)
    assert.equal(result.body.error.code, 'not_found.run')
  } finally {
    await closeServer(server)
  }
})

test('GET /v1/runs/r1/stream without auth returns 401 (JSON)', async () => {
  const { server, url } = await makeServer(true)
  try {
    const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        `${url}/v1/runs/r1/stream`,
        { method: 'GET' },
        res => {
          const chunks: Buffer[] = []
          res.on('data', c => chunks.push(c as Buffer))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(result.status, 401)
    assert.equal(result.body.error.code, 'auth.missing')
  } finally {
    await closeServer(server)
  }
})

test('router without a hub returns 501 on the stream route', async () => {
  const { server, url } = await makeServer(false)
  try {
    const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        `${url}/v1/runs/r1/stream`,
        { method: 'GET', headers: { 'x-api-key': 'k' } },
        res => {
          const chunks: Buffer[] = []
          res.on('data', c => chunks.push(c as Buffer))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
    assert.equal(result.status, 501)
    assert.equal(result.body.error.code, 'internal.error')
  } finally {
    await closeServer(server)
  }
})
