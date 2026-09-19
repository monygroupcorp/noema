import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { classify, run } from '../../../../scripts/guard-weight-addresses.js'

// `guard:weight-addresses` is the refusal that `catalogIntegrity` cannot make: it asks whether a
// registry address names a real file. That check needs the network by definition, so it does not
// live in `test:hermetic` — but its JUDGEMENT does, and this is where it is proven.
//
// Hermetic means no INTERNET, not no sockets. A loopback server here answers with the statuses a
// hub really returns, so the shipped script is exercised end to end — probe, retry, classify,
// exit code — without depending on huggingface.co being up or on what it happens to be serving
// today. A guard nothing tests is a guard that can silently start passing everything, and both
// halves of `guard:claims` were wrong in exactly that way before anyone ran it against a fixture.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

let base = ''
let server: http.Server
let tmp = ''
/** How many times `/flaky` has been asked — it answers 429 until the guard has retried. */
let flakyHits = 0

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/'
    if (path === '/live') return void res.writeHead(200, { 'content-length': '4096' }).end()
    if (path === '/dead') return void res.writeHead(404).end()
    if (path === '/gone') return void res.writeHead(410).end()
    if (path === '/gated') return void res.writeHead(403).end()
    if (path === '/needs-token') return void res.writeHead(401).end()
    // An object store that refuses HEAD and serves the same file to a ranged GET. Real ones do
    // this, and a guard that took the 405 at face value would call a live weight unanswered.
    if (path === '/nohead') {
      if (req.method === 'HEAD') return void res.writeHead(405).end()
      return void res.writeHead(206, { 'content-range': 'bytes 0-0/4096' }).end('x')
    }
    if (path === '/flaky') {
      flakyHits += 1
      if (flakyHits < 2) return void res.writeHead(429).end()
      return void res.writeHead(200).end()
    }
    res.writeHead(500).end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
  tmp = mkdtempSync(join(tmpdir(), 'weight-addresses-'))
})

after(async () => {
  await new Promise<void>(r => server.close(() => r()))
  if (tmp) rmSync(tmp, { recursive: true, force: true })
})

/** Run the guard over `rows`, swallowing its report. Returns the exit code and what it printed. */
async function guard(rows: Array<{ id: string; uri: string }>, ...flags: string[]) {
  const file = join(tmp, `sources-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(rows))
  const said: string[] = []
  const real = console.error
  console.error = (...args: unknown[]) => { said.push(args.map(String).join(' ')) }
  try {
    const code = await run(['--sources', file, ...flags])
    return { code, out: said.join('\n') }
  } finally {
    console.error = real
  }
}

test('a status is read the way a pod holding no credentials reads it', () => {
  // The pod downloader fetches with plain unauthenticated wget, so these are not abstract
  // categories: they are what does and does not arrive on disk beside ComfyUI.
  assert.equal(classify(200), 'live')
  assert.equal(classify(206), 'live')
  assert.equal(classify(404), 'dead')
  assert.equal(classify(410), 'dead')
  assert.equal(classify(401), 'gated')
  assert.equal(classify(403), 'gated')
  // Not "dead". The host declined to answer; it did not answer "no", and claiming a weight is
  // missing on a 500 or a 429 is how a guard earns the right to be ignored.
  assert.equal(classify(429), 'unknown')
  assert.equal(classify(500), 'unknown')
  assert.equal(classify(503), 'unknown')
})

test('an address that names no file fails the guard, and is named', async () => {
  const { code, out } = await guard([
    { id: 'intella.fine', uri: `${base}/live` },
    { id: 'intella.missing', uri: `${base}/dead` },
  ])
  assert.equal(code, 1)
  assert.match(out, /DEAD\s+intella\.missing/)
  assert.match(out, /HTTP 404/)
  // The passing one is not dragged down with it, and the report says how many of each.
  assert.doesNotMatch(out, /DEAD\s+intella\.fine/)
  assert.match(out, /1 live, 1 dead/)
})

test('410 is as dead as 404 — the address named a file and no longer does', async () => {
  const { code, out } = await guard([{ id: 'intella.withdrawn', uri: `${base}/gone` }])
  assert.equal(code, 1)
  assert.match(out, /DEAD\s+intella\.withdrawn/)
})

test('a catalogue whose every address resolves passes silently enough to be useful', async () => {
  const { code, out } = await guard([
    { id: 'intella.a', uri: `${base}/live` },
    { id: 'intella.b', uri: `${base}/nohead` },
  ])
  assert.equal(code, 0, out)
  assert.match(out, /2 live, 0 dead/)
})

test('a host that refuses HEAD is asked for one byte, not for the whole weight', async () => {
  // Without the ranged-GET fallback this reads 405 → unknown, and a live 14 GB weight is
  // reported as unanswered on every run until someone stops reading the report.
  const { code, out } = await guard([{ id: 'intella.store', uri: `${base}/nohead` }])
  assert.equal(code, 0, out)
  assert.match(out, /1 live/)
})

test('a rate-limited probe is asked again rather than convicted', async () => {
  // The real hub 429s under a burst — one of the four Wan 2.2 probes did, on the very sweep that
  // found them. A guard that read that as a verdict would have reported a live address as broken.
  flakyHits = 0
  const { code, out } = await guard([{ id: 'intella.busy', uri: `${base}/flaky` }])
  assert.equal(code, 0, out)
  assert.ok(flakyHits >= 2, `expected a retry, got ${flakyHits} request(s)`)
})

test('a gated address warns but does not fail, until asked to', async () => {
  // 401/403 means the file is there and an anonymous pull is refused — a real problem with a
  // different fix (mirror it to R2 and make that sources[0]) and one the catalogue is knowingly
  // carrying today. Failing on it would mean this guard could never be switched on at all.
  const warn = await guard([{ id: 'intella.gated', uri: `${base}/gated` }])
  assert.equal(warn.code, 0, warn.out)
  assert.match(warn.out, /GATED\s+intella\.gated/)
  assert.match(warn.out, /a pod fetches anonymously/)

  const strict = await guard([{ id: 'intella.gated', uri: `${base}/needs-token` }], '--strict-gated')
  assert.equal(strict.code, 1)
})

test('no uplink is reported as no uplink, and never as a catalogue full of dead weights', async () => {
  // The failure mode this exists to prevent: a laptop on a train prints 59 DEAD lines, the
  // reader learns the guard cries wolf, and the run it was right about goes unread.
  const closed = await closedPort()
  const rows = [
    { id: 'intella.a', uri: `http://127.0.0.1:${closed}/live` },
    { id: 'intella.b', uri: `http://127.0.0.1:${closed}/dead` },
  ]
  const offline = await guard(rows)
  assert.equal(offline.code, 0, offline.out)
  assert.match(offline.out, /could not reach the network/)
  assert.doesNotMatch(offline.out, /DEAD/)

  // On a runner that is supposed to have an uplink, "I could not tell" is a broken guard, and a
  // broken guard belongs in the red rather than in a green tick nobody looks behind.
  const inCi = await guard(rows, '--require-network')
  assert.equal(inCi.code, 1)
  assert.match(inCi.out, /could not reach the network/)
})

test('one unreachable host among reachable ones is unanswered, not dead', async () => {
  // Half-offline is the subtler case: the sweep DID get answers, so the "no uplink" banner does
  // not apply, and the one host that never answered still must not be convicted.
  const closed = await closedPort()
  const { code, out } = await guard([
    { id: 'intella.here', uri: `${base}/live` },
    { id: 'intella.elsewhere', uri: `http://127.0.0.1:${closed}/live` },
  ])
  assert.equal(code, 0, out)
  assert.match(out, /UNKNOWN\s+intella\.elsewhere/)
  assert.doesNotMatch(out, /DEAD/)
  assert.match(out, /1 live, 0 dead, 0 gated, 1 unanswered/)
})

test('the shipped npm script is wired to the shipped file and exits on its verdict', async () => {
  // Everything above calls `run` in process. This is the one case that proves the thing a
  // developer and CI actually type resolves to this script and carries its exit code out —
  // the seam `guard:claims` had wrong while its logic was fine.
  //
  // `spawn`, never `spawnSync`: the child probes the loopback server THIS process is running, and
  // a synchronous spawn parks the event loop that would answer it. That deadlocks until something
  // kills one of them, which is a hang with no failing assertion to explain it.
  const file = join(tmp, 'cli-sources.json')
  writeFileSync(file, JSON.stringify([{ id: 'intella.missing', uri: `${base}/dead` }]))
  const child = spawn('npm', ['run', '--silent', 'guard:weight-addresses', '--', '--sources', file], {
    cwd: ROOT,
  })
  let err = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { err += chunk })
  child.stdout.resume()
  const code = await new Promise<number | null>(r => child.on('close', r))
  assert.equal(code, 1, err)
  assert.match(err, /DEAD\s+intella\.missing/)
})

/** A port on loopback with nothing listening: bind one, read it, give it back. */
async function closedPort(): Promise<number> {
  const s = http.createServer()
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r))
  const port = (s.address() as { port: number }).port
  await new Promise<void>(r => s.close(() => r()))
  return port
}
