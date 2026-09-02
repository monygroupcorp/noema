// Feed publish volume-cap (noema-119): held-review only stays humanly clearable if PUBLIC
// (feed/marketplace) publish inflow is bounded. Covers: exceed → 429, private/unlisted
// uncapped, per-owner isolation, and the injected limiter's window reset.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import rateLimit from 'express-rate-limit'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { Edition } from '../../../../src/allocutio/api/types.js'
import type { PublishOpts } from '../../../../src/allocutio/api/CrystalApi.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const publishCalls: Array<{ auctor: AuctorKey; opts: PublishOpts }> = []

function makeFakeApi(): ApiFacade {
  return {
    async publish(auctor: AuctorKey, opts: PublishOpts): Promise<Edition> {
      publishCalls.push({ auctor, opts })
      return {
        id: `edition-${publishCalls.length}`,
        artifact: opts.artifact,
        destination: opts.destination ?? 'feed',
        visibility: (opts.visibility as Edition['visibility']) ?? 'feed',
        custody: 'ours',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    },
  } as unknown as ApiFacade
}

// Two identified callers, keyed off `x-api-key`.
const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'owner-a') return { animaId: 'anima-a' }
    if (creds.apiKey === 'owner-b') return { animaId: 'anima-b' }
    throw Errors.authMissing()
  },
  // `Identity` also carries `resolveCaller` (identity + the limits the CREDENTIAL imposes, e.g. a
  // partner API key's per-run spend ceiling). These fakes mint no ceiling, so it is `resolve` plus
  // an empty limit set — which is exactly the shape a key with no ceiling resolves to.
  async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
    return { auctor: await this.resolve(creds) }
  },
}

/** A deterministic counting limiter (no wall-clock windows) — exercises apiRouter's
 *  conditional-invoke + owner-keying wiring without depending on real timers. */
function makeCountingLimiter(max: number): { mw: express.RequestHandler; hits: number } {
  const counts = new Map<string, number>()
  const state = { mw: (() => {}) as express.RequestHandler, hits: 0 }
  state.mw = (req, res, next) => {
    state.hits++
    const key = (req as unknown as { publishOwnerKey?: string }).publishOwnerKey ?? 'unknown'
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    if (n > max) {
      res.status(429).json({ error: { code: 'rate.limited', message: 'public publishing is rate-limited during review — try again shortly' } })
      return
    }
    next()
  }
  return state
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function createServer(opts: { rateLimiters?: { publish?: express.RequestHandler } } = {}): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: makeFakeApi(), identity: fakeIdentity, ...(opts.rateLimiters ? { rateLimiters: opts.rateLimiters } : {}) }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()))
  })
}

interface HttpResult {
  status: number
  body: any
}

function publish(url: string, apiKey: string, body: unknown): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      `${url}/v1/editiones`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
          'x-api-key': apiKey,
        },
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c as Buffer))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body: any
          try {
            body = text ? JSON.parse(text) : undefined
          } catch {
            body = text
          }
          resolve({ status: res.statusCode ?? 0, body })
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('public publish (feed): N succeed, N+1 → 429 with a clear message', async () => {
  const limiter = makeCountingLimiter(2)
  const { server, url } = await createServer({ rateLimiters: { publish: limiter.mw } })
  try {
    const artifact = { kind: 'actum', id: 'a1' }
    const r1 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    const r2 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    const r3 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 200)
    assert.equal(r3.status, 429)
    assert.match(r3.body.error.message, /rate-limited/)
  } finally {
    await closeServer(server)
  }
})

test('marketplace destination is treated as public (same cap as feed)', async () => {
  const limiter = makeCountingLimiter(1)
  const { server, url } = await createServer({ rateLimiters: { publish: limiter.mw } })
  try {
    const artifact = { kind: 'collectio', id: 'c1' }
    const r1 = await publish(url, 'owner-a', { artifact, destination: 'marketplace' })
    const r2 = await publish(url, 'owner-a', { artifact, destination: 'marketplace' })
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 429)
  } finally {
    await closeServer(server)
  }
})

test('private/unlisted publishes are NOT capped — unaffected by the public quota', async () => {
  const limiter = makeCountingLimiter(1)
  const { server, url } = await createServer({ rateLimiters: { publish: limiter.mw } })
  try {
    const artifact = { kind: 'actum', id: 'a1' }
    for (let i = 0; i < 5; i++) {
      const r = await publish(url, 'owner-a', { artifact, destination: 'r2', visibility: 'private' })
      assert.equal(r.status, 200, `private publish #${i + 1} should succeed`)
    }
    // Explicit 'unlisted' visibility on an otherwise-public-leaning destination is also uncapped.
    const r = await publish(url, 'owner-a', { artifact, destination: 'feed', visibility: 'unlisted' })
    assert.equal(r.status, 200)
    assert.equal(limiter.hits, 0, 'the limiter middleware is never invoked for private/unlisted targets')
  } finally {
    await closeServer(server)
  }
})

test('omitted destination/visibility defaults to public feed (mirrors CrystalApi.publish) and is capped', async () => {
  const limiter = makeCountingLimiter(1)
  const { server, url } = await createServer({ rateLimiters: { publish: limiter.mw } })
  try {
    const artifact = { kind: 'actum', id: 'a1' }
    const r1 = await publish(url, 'owner-a', { artifact })
    const r2 = await publish(url, 'owner-a', { artifact })
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 429)
  } finally {
    await closeServer(server)
  }
})

test('the cap is per-owner — owner A exhausting their quota does not affect owner B', async () => {
  const limiter = makeCountingLimiter(1)
  const { server, url } = await createServer({ rateLimiters: { publish: limiter.mw } })
  try {
    const artifact = { kind: 'actum', id: 'a1' }
    const a1 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    const a2 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    const b1 = await publish(url, 'owner-b', { artifact, destination: 'feed' })
    assert.equal(a1.status, 200)
    assert.equal(a2.status, 429, 'owner A is capped')
    assert.equal(b1.status, 200, 'owner B has an independent quota')
  } finally {
    await closeServer(server)
  }
})

test('no rateLimiters dep configured → publish is unaffected (router stays usable without it)', async () => {
  const { server, url } = await createServer()
  try {
    const artifact = { kind: 'actum', id: 'a1' }
    for (let i = 0; i < 3; i++) {
      const r = await publish(url, 'owner-a', { artifact, destination: 'feed' })
      assert.equal(r.status, 200)
    }
  } finally {
    await closeServer(server)
  }
})

test('window reset: a real express-rate-limit window clears after it elapses', async () => {
  const limiter = rateLimit({
    windowMs: 50,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as unknown as { publishOwnerKey?: string }).publishOwnerKey ?? 'unknown',
  })
  const { server, url } = await createServer({ rateLimiters: { publish: limiter } })
  try {
    const artifact = { kind: 'actum', id: 'a1' }
    const r1 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    const r2 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 429)
    await new Promise(resolve => setTimeout(resolve, 90))
    const r3 = await publish(url, 'owner-a', { artifact, destination: 'feed' })
    assert.equal(r3.status, 200, 'the window reset, so the quota is fresh')
  } finally {
    await closeServer(server)
  }
})
