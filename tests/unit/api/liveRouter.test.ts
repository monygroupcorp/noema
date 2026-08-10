import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createLiveRouter } from '../../../src/api/internal/liveRouter.js'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'
import type { WideEvent } from '../../../src/lib/wide.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spin up an Express server with the live router mounted and return the
 * server instance + base URL. The server is closed after each test.
 */
function createServer(secret?: string): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const app = express()
    app.use('/internal', createLiveRouter(secret))
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

/**
 * Make a plain HTTP GET request. Returns the response object.
 */
function httpGet(url: string, headers: Record<string, string> = {}): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, res => resolve(res))
    req.on('error', reject)
  })
}

/**
 * Read all data from a response, up to `maxMs` milliseconds, then return the
 * collected chunks as a single string.
 */
function collectSSE(res: http.IncomingMessage, maxMs: number): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      res.destroy()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }, maxMs)
    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    res.on('end', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    res.on('error', () => {
      clearTimeout(timer)
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

// ---------------------------------------------------------------------------
// Test 1 — 401 when secret configured and header missing
// ---------------------------------------------------------------------------

test('GET /internal/live returns 401 when secret is configured and header is missing', async () => {
  const { server, url } = await createServer('supersecret')
  try {
    const res = await httpGet(`${url}/internal/live`)
    assert.equal(res.statusCode, 401)
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// Test 2 — 200 with text/event-stream when secret matches
// ---------------------------------------------------------------------------

test('GET /internal/live returns 200 with Content-Type text/event-stream when secret matches', async () => {
  const { server, url } = await createServer('supersecret')
  try {
    const res = await httpGet(`${url}/internal/live`, { 'x-internal-secret': 'supersecret' })
    assert.equal(res.statusCode, 200)
    assert.ok(
      res.headers['content-type']?.includes('text/event-stream'),
      `expected text/event-stream, got: ${res.headers['content-type']}`,
    )
    // Clean up — destroy the SSE connection
    res.destroy()
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// Test 3 — bus `log` event forwarded as SSE event: log
// ---------------------------------------------------------------------------

test('bus log event is forwarded as SSE event: log line', async () => {
  const { server, url } = await createServer('supersecret')
  try {
    const res = await httpGet(`${url}/internal/live`, { 'x-internal-secret': 'supersecret' })
    assert.equal(res.statusCode, 200)

    const entry: LogEntry = {
      ts:        new Date().toISOString(),
      level:     'info',
      component: 'test:liveRouter',
      msg:       'hello from test 3',
    }

    // Give the SSE stream time to register, then emit on bus
    await new Promise(r => setTimeout(r, 20))
    bus.emit('log', entry)

    const body = await collectSSE(res, 150)

    assert.ok(body.includes('event: log'), `expected "event: log" in SSE output, got:\n${body}`)
    assert.ok(body.includes('hello from test 3'), `expected log msg in SSE data, got:\n${body}`)
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// Test 4 — bus `actum.complete` forwarded as SSE event: actum.complete
// ---------------------------------------------------------------------------

test('bus actum.complete event is forwarded as SSE event: actum.complete line', async () => {
  const { server, url } = await createServer('supersecret')
  try {
    const res = await httpGet(`${url}/internal/live`, { 'x-internal-secret': 'supersecret' })
    assert.equal(res.statusCode, 200)

    const wide: WideEvent = {
      event:         'actum.complete',
      ts:            new Date().toISOString(),
      actumId:       'actum-test-4',
      modusId:       'flux-dev',
      modusVersiono: '1.0.0',
      byType:        'animaId',
      reservation:   '1000',
      impetus:       '800',
      refund:        '200',
      durationMs:    5000,
      coldStart:     false,
      status:        'completed',
    }

    await new Promise(r => setTimeout(r, 20))
    bus.emit('actum.complete', wide)

    const body = await collectSSE(res, 150)

    assert.ok(body.includes('event: actum.complete'), `expected "event: actum.complete", got:\n${body}`)
    assert.ok(body.includes('actum-test-4'), `expected actumId in SSE data, got:\n${body}`)
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// Test 5 — listener removed on client disconnect (no memory leak)
// ---------------------------------------------------------------------------

test('bus listeners are removed when client disconnects', async () => {
  const { server, url } = await createServer('supersecret')
  try {
    const res = await httpGet(`${url}/internal/live`, { 'x-internal-secret': 'supersecret' })
    assert.equal(res.statusCode, 200)

    // Wait for subscription to register
    await new Promise(r => setTimeout(r, 20))

    const beforeCount = bus.listenerCount('log')
    assert.ok(beforeCount >= 1, 'expected at least 1 listener after connecting')

    // Disconnect the client
    res.destroy()

    // Give the server time to process the close event
    await new Promise(r => setTimeout(r, 100))

    const afterCount = bus.listenerCount('log')
    assert.ok(afterCount < beforeCount, `expected listener count to drop after disconnect (before=${beforeCount}, after=${afterCount})`)
  } finally {
    await closeServer(server)
  }
})

// ---------------------------------------------------------------------------
// Test 6 — fail-closed: no secret configured ⇒ every request refused
// ---------------------------------------------------------------------------

test('requests are refused when INTERNAL_SECRET is not configured', async () => {
  const { server, url } = await createServer(undefined)  // no secret
  try {
    // No credential in the request either — an unconfigured gate must refuse, not admit.
    const res = await httpGet(`${url}/internal/live`)
    const { statusCode, headers } = res
    res.destroy()   // release the socket first: a regression would hold an SSE stream open
    assert.equal(statusCode, 401)
    assert.ok(
      !headers['content-type']?.includes('text/event-stream'),
      `expected no event-stream, got: ${headers['content-type']}`,
    )
  } finally {
    await closeServer(server)
  }
})

test('a supplied credential does not open an unconfigured gate', async () => {
  const { server, url } = await createServer(undefined)  // no secret
  try {
    const res = await httpGet(`${url}/internal/live`, { 'x-internal-secret': 'anything' })
    const { statusCode } = res
    res.destroy()
    assert.equal(statusCode, 401)
  } finally {
    await closeServer(server)
  }
})

test('?token= query credential is still accepted when configured', async () => {
  const { server, url } = await createServer('supersecret')
  try {
    const res = await httpGet(`${url}/internal/live?token=supersecret`)
    assert.equal(res.statusCode, 200)
    res.destroy()
  } finally {
    await closeServer(server)
  }
})
