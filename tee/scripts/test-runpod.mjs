#!/usr/bin/env node
/**
 * test-runpod.mjs — autonomous TEE pod test.
 *
 * Spins up a real RunPod SECURE pod, probes every surface, terminates it.
 * No browser, no user required. Run it, read the output, iterate.
 *
 * Usage:
 *   RUNPOD_API_KEY=xxx node tee/scripts/test-runpod.mjs
 *
 * Optional env:
 *   TEE_IMAGE           Docker image (default: monygroup/tee-runner:0617b)
 *   PLATFORM_CALLBACK   URL for runner/ready callback (default: https://staging.noema.art)
 *   GPU_TYPE_ID         RunPod GPU type (default: NVIDIA GeForce RTX 4090)
 */

import tls from 'tls'
import https from 'https'
import crypto from 'crypto'

// ── Config ────────────────────────────────────────────────────────────────────

const API_KEY  = process.env.RUNPOD_API_KEY
const IMAGE    = process.env.TEE_IMAGE    || 'monygroup/tee-runner:0617b'
const CALLBACK = process.env.PLATFORM_CALLBACK || 'https://staging.noema.art'
const GPU_TYPE = process.env.GPU_TYPE_ID  || 'NVIDIA GeForce RTX 4090'

if (!API_KEY) { die('RUNPOD_API_KEY is required') }

const SESSION_ID    = `autotest-${crypto.randomUUID().slice(0, 8)}`
const CLIENT_PUBKEY = crypto.randomBytes(32).toString('base64')

const RUNTIME_POLL_MS    = 8_000
const RUNTIME_TIMEOUT_MS = 5 * 60_000
const BOOT_SETTLE_MS     = 6_000   // wait after runtime before probing

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log(`image        : ${IMAGE}`)
  log(`session      : ${SESSION_ID}`)
  log(`client pubkey: ${CLIENT_PUBKEY.slice(0, 16)}…`)
  log(`callback     : ${CALLBACK}`)
  log('')

  const podId = await startPod()
  log(`pod created  : ${podId}`)

  try {
    await waitForRuntime(podId)
    const base = `https://${podId}-8080.proxy.runpod.net`
    log(`pod running  : ${base}`)
    log(`settling for ${BOOT_SETTLE_MS / 1000}s…`)
    await sleep(BOOT_SETTLE_MS)

    const results = {}

    // ── Test 1: plain HTTP health check ──────────────────────────────────────
    log('\n=== TEST 1: HTTP /health ===')
    results.health = await httpGet(base + '/health')
    log(`status: ${results.health.status}  body: ${results.health.body.slice(0, 120)}`)

    // ── Test 2: wglog (before WS) ────────────────────────────────────────────
    log('\n=== TEST 2: /debug/wglog (before WS test) ===')
    results.wglogBefore = await httpGet(base + '/debug/wglog?tail=30')
    log(`status: ${results.wglogBefore.status}`)
    log(results.wglogBefore.body || '(empty)')

    // ── Test 3: WebSocket upgrade ─────────────────────────────────────────────
    log('\n=== TEST 3: WebSocket upgrade to / ===')
    results.wsRoot = await wsUpgradeTest(`${podId}-8080.proxy.runpod.net`, '/')
    log(`result: ${results.wsRoot.verdict}`)
    log(`status line: ${results.wsRoot.statusLine}`)
    if (results.wsRoot.headers) log(`headers:\n${results.wsRoot.headers}`)

    // ── Test 4: WebSocket upgrade to /ws-test ────────────────────────────────
    log('\n=== TEST 4: WebSocket upgrade to /ws-test ===')
    results.wsTest = await wsUpgradeTest(`${podId}-8080.proxy.runpod.net`, '/ws-test')
    log(`result: ${results.wsTest.verdict}`)
    log(`status line: ${results.wsTest.statusLine}`)

    // ── Test 5: SOCKS5 handshake over WebSocket ───────────────────────────────
    log('\n=== TEST 5: SOCKS5 NoAuth handshake over WS ===')
    results.socks5 = await socks5HandshakeTest(`${podId}-8080.proxy.runpod.net`)
    log(`result: ${results.socks5.verdict}`)
    if (results.socks5.detail) log(`detail: ${results.socks5.detail}`)

    // ── Test 6: wglog after all tests ────────────────────────────────────────
    log('\n=== TEST 6: /debug/wglog (after all tests) ===')
    await sleep(500)
    results.wglogAfter = await httpGet(base + '/debug/wglog?tail=30')
    log(`status: ${results.wglogAfter.status}`)
    log(results.wglogAfter.body || '(empty)')

    // ── Summary ───────────────────────────────────────────────────────────────
    log('\n======== SUMMARY ========')
    log(`HTTP /health         : ${results.health.status === 200 ? 'OK' : 'FAIL (' + results.health.status + ')'}`)
    log(`wglog before WS      : ${results.wglogBefore.body ? 'HAS CONTENT' : 'EMPTY — server not logging'}`)
    log(`WS upgrade /          : ${results.wsRoot.verdict}`)
    log(`WS upgrade /ws-test   : ${results.wsTest.verdict}`)
    log(`SOCKS5 over WS        : ${results.socks5.verdict}`)
    log(`wglog after all tests : ${results.wglogAfter.body ? 'HAS CONTENT' : 'EMPTY'}`)

    if (!results.wglogBefore.body && !results.wglogAfter.body) {
      log('\nDIAGNOSIS: tee-wg-server is NOT writing to /tmp/wg-server.log.')
      log('  Either: (a) wrong Docker image is running, or')
      log('          (b) the binary crashes before main() — check if /debug/wglog returns JSON (runner.py on 8080)')
      log(`  /health body was: ${results.health.body.slice(0, 80)}`)
      log('  If /health returned {"ok":true} (JSON) → runner.py is on 8080, not tee-wg-server')
      log('  If /health returned "ok" (plain text) → tee-wg-server IS on 8080 but log file is broken')
    }

    const wsOk    = results.wsRoot.verdict === 'UPGRADED (101)'
    const socksOk = results.socks5.verdict.startsWith('OK')

    if (wsOk && socksOk) {
      log('\nDIAGNOSIS: Server-side fully working (WS upgrade + SOCKS5 handshake). Ready for browser test.')
      log('  Next: deploy platform with TEE_IMAGE_ID=monygroup/tee-runner:0617b and test from browser.')
    } else if (wsOk && !socksOk) {
      log('\nDIAGNOSIS: WS upgrade works but SOCKS5 handshake failed.')
      log('  Check socksgo server config and AcceptWS error in wglog.')
    } else {
      log(`\nDIAGNOSIS: WebSocket upgrade FAILED. Server returned: ${results.wsRoot.statusLine}`)
      log('  If 200 → server hit the "upgrade != websocket" branch (Upgrade header missing or not restored)')
      log('  If 4xx → proxy rejected the connection before reaching Go')
      log('  If timeout → container crashed or port 8080 not ready')
    }

  } finally {
    await terminatePod(podId)
    log(`\npod terminated: ${podId}`)
  }
}

// ── RunPod API ────────────────────────────────────────────────────────────────

async function startPod() {
  const body = {
    name:                `noema-autotest-${SESSION_ID.slice(0, 8)}`,
    imageName:           IMAGE,
    gpuCount:            1,
    cloudType:           'SECURE',
    containerDiskInGb:   40,
    ports:               ['8080/http'],
    supportPublicIp:     true,
    gpuTypeIds:          [GPU_TYPE],
    env: {
      SESSION_ID:        SESSION_ID,
      PLATFORM_CALLBACK: CALLBACK,
      WG_CLIENT_PUBKEY:  CLIENT_PUBKEY,
    },
  }
  const res = await jsonPost('https://rest.runpod.io/v1/pods', body)
  if (!res.id) die(`pod creation failed: ${JSON.stringify(res)}`)
  return res.id
}

async function waitForRuntime(podId) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(RUNTIME_POLL_MS)
    try {
      const query = `{ pod(input: {podId: "${podId}"}) { desiredStatus runtime { uptimeInSeconds } } }`
      const res = await jsonPost(
        `https://api.runpod.io/graphql?api_key=${API_KEY}`,
        { query },
        { method: 'POST', auth: false }
      )
      const pod = res?.data?.pod
      process.stdout.write('.')
      if (pod?.runtime) { process.stdout.write('\n'); return }
      if (pod?.desiredStatus && pod.desiredStatus !== 'RUNNING') {
        die(`pod entered unexpected state: ${pod.desiredStatus}`)
      }
    } catch { /* network blip — retry */ }
  }
  die('pod did not reach runtime within 5 min')
}

async function terminatePod(podId) {
  await new Promise((resolve) => {
    const req = https.request({
      hostname: 'rest.runpod.io',
      path:     `/v1/pods/${podId}`,
      method:   'DELETE',
      headers:  { 'Authorization': `Bearer ${API_KEY}` },
    }, resolve)
    req.on('error', resolve)
    req.end()
  })
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', e => resolve({ status: 0, body: e.message }))
    req.setTimeout(15_000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
  })
}

function jsonPost(url, body, opts = {}) {
  const u = new URL(url)
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    }
    if (opts.auth !== false) headers['Authorization'] = `Bearer ${API_KEY}`
    const req = https.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:   opts.method || 'POST',
      headers,
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ── WebSocket upgrade test (raw TLS, no npm deps) ────────────────────────────
// Makes a raw TLS connection and sends HTTP upgrade headers manually.
// Reads the first response line to determine if the server returned:
//   101 Switching Protocols → upgrade accepted
//   200 OK                  → server ignored the upgrade (returned plain HTTP)
//   4xx / other             → proxy/server rejected

function wsUpgradeTest(hostname, path) {
  return new Promise((resolve) => {
    const wsKey = crypto.randomBytes(16).toString('base64')
    const request = [
      `GET ${path} HTTP/1.1`,
      `Host: ${hostname}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${wsKey}`,
      `Sec-WebSocket-Version: 13`,
      `Origin: https://staging.noema.art`,
      '',
      '',
    ].join('\r\n')

    const sock = tls.connect({ host: hostname, port: 443, servername: hostname }, () => {
      sock.write(request)
    })

    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ verdict: 'TIMEOUT', statusLine: '(no response within 10s)', headers: '' })
    }, 10_000)

    sock.on('data', (chunk) => {
      buf += chunk.toString('binary')
      // Wait until we have the full response headers
      if (!buf.includes('\r\n\r\n')) return
      clearTimeout(timer)
      sock.destroy()
      const [headerBlock] = buf.split('\r\n\r\n')
      const lines = headerBlock.split('\r\n')
      const statusLine = lines[0]
      const headers = lines.slice(1).join('\n')
      const is101 = statusLine.startsWith('HTTP/1.1 101')
      resolve({
        verdict: is101 ? 'UPGRADED (101)' : `NOT UPGRADED — ${statusLine}`,
        statusLine,
        headers,
      })
    })

    sock.on('error', (e) => {
      clearTimeout(timer)
      resolve({ verdict: `ERROR: ${e.message}`, statusLine: '', headers: '' })
    })
  })
}

// ── SOCKS5 handshake test ─────────────────────────────────────────────────────
// Upgrades to WebSocket then sends the 3-byte SOCKS5 NoAuth greeting.
// If the server responds with 05 00 (NoAuth selected), the SOCKS5 layer is alive.

function socks5HandshakeTest(hostname) {
  return new Promise((resolve) => {
    const wsKey = crypto.randomBytes(16).toString('base64')
    const upgradeReq = [
      `GET / HTTP/1.1`,
      `Host: ${hostname}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Key: ${wsKey}`,
      `Sec-WebSocket-Version: 13`,
      `Origin: https://staging.noema.art`,
      '',
      '',
    ].join('\r\n')

    const sock = tls.connect({ host: hostname, port: 443, servername: hostname }, () => {
      sock.write(upgradeReq)
    })

    const timer = setTimeout(() => {
      sock.destroy()
      resolve({ verdict: 'TIMEOUT', detail: 'no response within 15s' })
    }, 15_000)

    let state = 'awaiting-101'
    let buf = Buffer.alloc(0)

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk])

      if (state === 'awaiting-101') {
        const str = buf.toString('binary')
        if (!str.includes('\r\n\r\n')) return
        if (!str.startsWith('HTTP/1.1 101')) {
          clearTimeout(timer); sock.destroy()
          const status = str.split('\r\n')[0]
          resolve({ verdict: `FAIL: got ${status} instead of 101`, detail: '' })
          return
        }
        // 101 received — find where HTTP headers end and WS frames begin
        const headerEnd = str.indexOf('\r\n\r\n') + 4
        buf = buf.slice(headerEnd)
        state = 'ws-connected'

        // Send SOCKS5 NoAuth greeting as a WebSocket binary frame.
        // WS frame: FIN=1, opcode=2 (binary), mask=1, payload=[05 01 00]
        const greeting = Buffer.from([0x05, 0x01, 0x00])
        const maskKey  = crypto.randomBytes(4)
        const masked   = Buffer.from(greeting.map((b, i) => b ^ maskKey[i % 4]))
        const frame    = Buffer.concat([
          Buffer.from([0x82, 0x83]), // FIN|binary, MASK|len=3
          maskKey,
          masked,
        ])
        sock.write(frame)
        state = 'awaiting-socks5'
        return
      }

      if (state === 'awaiting-socks5') {
        // Expect a WS binary frame containing [05 00] (NoAuth accepted)
        if (buf.length < 4) return
        // Parse minimal WS frame header
        const fin    = (buf[0] & 0x80) !== 0
        const opcode = buf[0] & 0x0f
        const masked = (buf[1] & 0x80) !== 0
        const payLen = buf[1] & 0x7f
        const offset = 2 + (masked ? 4 : 0)
        if (buf.length < offset + payLen) return

        const payload = masked
          ? buf.slice(offset + 4, offset + 4 + payLen).map((b, i) => b ^ buf[offset + i % 4])
          : buf.slice(offset, offset + payLen)

        clearTimeout(timer); sock.destroy()
        if (payload[0] === 0x05 && payload[1] === 0x00) {
          resolve({ verdict: 'OK — SOCKS5 NoAuth accepted (05 00)', detail: `opcode=${opcode} fin=${fin}` })
        } else {
          const hex = Buffer.from(payload).toString('hex')
          resolve({ verdict: `FAIL: unexpected SOCKS5 response: ${hex}`, detail: '' })
        }
      }
    })

    sock.on('error', (e) => {
      clearTimeout(timer)
      resolve({ verdict: `ERROR: ${e.message}`, detail: '' })
    })
  })
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function log(msg)  { console.log(msg) }
function die(msg)  { console.error('[FATAL]', msg); process.exit(1) }

// ── Run ───────────────────────────────────────────────────────────────────────
main().catch(e => { console.error(e); process.exit(1) })
