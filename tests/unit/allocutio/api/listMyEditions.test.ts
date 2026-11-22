// GET /v1/editiones?artifact=<kind>:<id> — the caller's own publications of one artifact.
//
// The review queue (`/editiones/review`) carries `reviewOutcome:'pending'` and nothing else,
// so a publish surface that reopens could recover a HOLD and no terminal outcome: a gate
// refusal and an already-live publication both read as "never put forth". This route is the
// record such a surface reads instead of the memory of the tab that pressed the button.
//
// Covered here: the `artifact` token is parsed into the pair the facade is called with, a
// missing or malformed one is refused as `input.malformed` rather than silently answering a
// different (unfiltered) question, and the route sits BEFORE `/editiones/:id` so the literal
// path is not captured as an edition id.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, parseArtifactQuery, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { ApiError, Errors } from '../../../../src/allocutio/api/errors.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { Edition } from '../../../../src/allocutio/api/types.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const calls: Array<{ auctor: AuctorKey; ref: { kind: string; id: string } }> = []

const REFUSED: Edition = {
  id: 'edition-1',
  artifact: { kind: 'collectio', id: 'coll-7' },
  destination: 'gallery',
  visibility: 'marketplace',
  custody: 'ours',
  status: 'rejected',
  moderationNote: 'Public publishing is closed right now, so this was never checked. Nothing was found in your content.',
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
}

function makeFakeApi(): ApiFacade {
  return {
    async listMyEditions(auctor: AuctorKey, ref: { kind: string; id: string }): Promise<Edition[]> {
      calls.push({ auctor, ref })
      return ref.id === 'coll-7' ? [REFUSED] : []
    },
  } as unknown as ApiFacade
}

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'owner-a') return { animaId: 'anima-a' }
    throw Errors.authMissing()
  },
  async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
    return { auctor: await this.resolve(creds) }
  },
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function createServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: makeFakeApi(), identity: fakeIdentity }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

function get(url: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}${path}`, { method: 'GET', headers: { 'x-api-key': 'owner-a' } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body: any
        try { body = text ? JSON.parse(text) : undefined } catch { body = text }
        resolve({ status: res.statusCode ?? 0, body })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

test('GET /v1/editiones returns the caller\'s own publications of the named artifact', async (t) => {
  const { server, url } = await createServer()
  t.after(() => closeServer(server))
  calls.length = 0

  const res = await get(url, '/v1/editiones?artifact=collectio%3Acoll-7')
  assert.equal(res.status, 200)
  assert.equal(res.body.editions.length, 1)
  assert.equal(res.body.editions[0].id, 'edition-1')
  assert.equal(
    res.body.editions[0].moderationNote,
    'Public publishing is closed right now, so this was never checked. Nothing was found in your content.',
    'the author-safe reason travels with a terminal refusal — the whole point of the read',
  )
  assert.deepEqual(calls, [{ auctor: { animaId: 'anima-a' }, ref: { kind: 'collectio', id: 'coll-7' } }])
})

test('GET /v1/editiones is not captured by the /editiones/:id route', async (t) => {
  // `/editiones/review` needs the same ordering and says so; this pins that the bare
  // collection path reaches its own handler rather than being read as an edition id.
  const { server, url } = await createServer()
  t.after(() => closeServer(server))
  calls.length = 0

  const res = await get(url, '/v1/editiones?artifact=collectio%3Aunknown')
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { editions: [] })
  assert.equal(calls.length, 1, 'the list handler ran, not the by-id one')
})

test('GET /v1/editiones refuses a missing or malformed artifact rather than listing everything', async (t) => {
  const { server, url } = await createServer()
  t.after(() => closeServer(server))
  calls.length = 0

  for (const path of [
    '/v1/editiones',
    '/v1/editiones?artifact=',
    '/v1/editiones?artifact=collectio',
    '/v1/editiones?artifact=collectio%3A',
    '/v1/editiones?artifact=widget%3Aw1',
  ]) {
    const res = await get(url, path)
    assert.equal(res.status, 400, `${path} must be refused`)
    assert.equal(res.body.error.code, 'input.malformed', `${path} must read as malformed input`)
  }
  assert.equal(calls.length, 0, 'a refused request never reaches the facade')
})

// ---------------------------------------------------------------------------
// The parser, directly
// ---------------------------------------------------------------------------

test('parseArtifactQuery: the kind is closed and the id is the whole remainder', () => {
  assert.deepEqual(parseArtifactQuery('collectio:coll-7'), { kind: 'collectio', id: 'coll-7' })
  assert.deepEqual(parseArtifactQuery('actum:act-1'), { kind: 'actum', id: 'act-1' })
  assert.deepEqual(parseArtifactQuery('intella:lora-1'), { kind: 'intella', id: 'lora-1' })
  // An id may itself contain a colon; only the FIRST separates kind from id.
  assert.deepEqual(parseArtifactQuery('collectio:ns:coll-7'), { kind: 'collectio', id: 'ns:coll-7' })
})

test('parseArtifactQuery: refuses what it cannot read, as input.malformed', () => {
  for (const raw of [undefined, '', 'coll-7', 'collectio', 'collectio:', 'widget:w1', ['collectio:coll-7']]) {
    assert.throws(
      () => parseArtifactQuery(raw),
      (e: unknown) => e instanceof ApiError && e.code === 'input.malformed' && e.httpStatus === 400,
      `${JSON.stringify(raw)} must be refused`,
    )
  }
})
