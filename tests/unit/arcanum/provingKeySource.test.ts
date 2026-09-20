// The served proving key follows the ceremony transcript.
//
// The failure this guards against is not a crash: it is the site publishing a finished
// ceremony while handing clients a key that is not its output. So the cases that matter
// are the ones where the two disagree — finalized with the key missing, and finalized
// with custody holding the wrong bytes — and in both the answer must be "serve nothing",
// never "serve the committed key".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProvingKeySource } from '../../../src/arcanum/ProvingKeySource.js'
import { MemoryCeremoniaStore, type CeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import type { ZkeyCustody } from '../../../src/arcanum/CeremoniaCustody.js'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

class MemoryCustody implements ZkeyCustody {
  private m = new Map<string, Buffer>()
  async get(h: string) { return this.m.get(h) ?? null }
  async has(h: string) { return this.m.has(h) }
  async put(h: string, b: Buffer) { this.m.set(h, b) }
}

/** A stand-in for the committed arcanum_final.zkey — only its bytes matter here. */
function repoKeyFile(): { file: string; bytes: Buffer } {
  const dir = mkdtempSync(path.join(tmpdir(), 'arcanum-zkey-'))
  const bytes = randomBytes(2048)
  const file = path.join(dir, 'arcanum_final.zkey')
  writeFileSync(file, bytes)
  return { file, bytes }
}

/** A ceremony wound forward to finalized on `finalHash`. */
async function finalized(finalHash: string): Promise<MemoryCeremoniaStore> {
  const store = new MemoryCeremoniaStore()
  await store.open('00'.repeat(32), null)
  await store.finalize(finalHash)
  return store
}

test('before the ceremony finalizes, the committed key is served, named by its own hash', async () => {
  const { file, bytes } = repoKeyFile()
  const store = new MemoryCeremoniaStore()
  await store.open('00'.repeat(32), null)
  const source = createProvingKeySource({ store, custody: new MemoryCustody(), repoZkeyPath: file })

  const key = await source()
  assert.equal(key.origin, 'repo')
  assert.equal(key.hash, sha(bytes))
  assert.equal(key.path, file)
})

test('once finalized, the key the transcript names is served out of custody', async () => {
  const { file } = repoKeyFile()
  const final = randomBytes(4096)
  const finalHash = sha(final)
  const custody = new MemoryCustody()
  await custody.put(finalHash, final)
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody, repoZkeyPath: file,
  })

  const key = await source()
  assert.equal(key.origin, 'ceremony')
  assert.equal(key.hash, finalHash)
  assert.ok(key.bytes?.equals(final))
})

test('finalized with the key absent from custody serves nothing — never the committed key', async () => {
  const { file } = repoKeyFile()
  const finalHash = sha(randomBytes(4096))
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody: new MemoryCustody(), repoZkeyPath: file,
  })

  const key = await source()
  assert.equal(key.origin, 'none')
  // The hash is still reported: we know which key belongs here, we just do not have it.
  assert.equal(key.hash, finalHash)
  assert.equal(key.bytes, undefined)
  assert.equal(key.path, undefined)
  assert.match(key.reason ?? '', /not published on this server/)
})

test('custody bytes that do not hash to the published final key are refused', async () => {
  const { file } = repoKeyFile()
  const finalHash = sha(randomBytes(4096))
  const custody = new MemoryCustody()
  await custody.put(finalHash, randomBytes(4096)) // wrong bytes under the right name
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody, repoZkeyPath: file,
  })

  const key = await source()
  assert.equal(key.origin, 'none')
  assert.equal(key.hash, finalHash)
})

test('an unreadable ceremony record falls back to the committed key rather than serving none', async () => {
  const { file, bytes } = repoKeyFile()
  const store = {
    async status() { throw new Error('mongo is down') },
  } as unknown as CeremoniaStore
  const source = createProvingKeySource({ store, custody: new MemoryCustody(), repoZkeyPath: file })

  const key = await source()
  assert.equal(key.origin, 'repo')
  assert.equal(key.hash, sha(bytes))
})

test('a missing committed key is reported without a hash — nothing to serve, nothing to name', async () => {
  const store = new MemoryCeremoniaStore()
  const source = createProvingKeySource({
    store, custody: new MemoryCustody(), repoZkeyPath: path.join(tmpdir(), 'no-such-arcanum.zkey'),
  })

  const key = await source()
  assert.equal(key.origin, 'none')
  assert.equal(key.hash, null)
})

// ---------------------------------------------------------------------------
// The log a standing fault leaves behind.
//
// Both "serve nothing" answers above are re-derived on every GET /arcanum/config and
// every GET /arcanum/circuit/zkey, so whatever they log, they log once per request. A
// finalized ceremony whose key was not on the server logged an error each time and took
// 60 of every 107 production log lines, which buried everything else. The condition is
// real and worth one error; it is not worth one per request.
// ---------------------------------------------------------------------------

/** Every line this source emitted while `fn` ran. The logger fans out to `bus`. */
async function linesWhile(fn: () => Promise<void>): Promise<LogEntry[]> {
  const seen: LogEntry[] = []
  const onLog = (e: LogEntry) => {
    if (e.component === 'arcanum:provingkey' && e.level !== 'debug') seen.push(e)
  }
  bus.on('log', onLog)
  try { await fn() } finally { bus.off('log', onLog) }
  return seen
}

/** Errors this source emitted while `fn` ran. The logger fans out to `bus`. */
async function errorsWhile(fn: () => Promise<void>): Promise<LogEntry[]> {
  const seen: LogEntry[] = []
  const onLog = (e: LogEntry) => {
    if (e.component === 'arcanum:provingkey' && e.level === 'error') seen.push(e)
  }
  bus.on('log', onLog)
  try { await fn() } finally { bus.off('log', onLog) }
  return seen
}

test('a key absent from custody is an error once, not once per request', async () => {
  const { file } = repoKeyFile()
  const finalHash = sha(randomBytes(4096))
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody: new MemoryCustody(), repoZkeyPath: file,
  })

  const errors = await errorsWhile(async () => {
    for (let i = 0; i < 20; i++) assert.equal((await source()).origin, 'none')
  })

  assert.equal(errors.length, 1)
  assert.match(String(errors[0].msg), /neither custody nor the image/)
  assert.equal(errors[0].finalHash, finalHash)
})

test('an unreadable ceremony record is an error once, however long the outage lasts', async () => {
  const { file, bytes } = repoKeyFile()
  const store = {
    async status() { throw new Error('mongo is down') },
  } as unknown as CeremoniaStore
  const source = createProvingKeySource({ store, custody: new MemoryCustody(), repoZkeyPath: file })

  const errors = await errorsWhile(async () => {
    for (let i = 0; i < 20; i++) assert.equal((await source()).hash, sha(bytes))
  })

  assert.equal(errors.length, 1)
  assert.match(String(errors[0].msg), /status unreadable/)
})

test('a fault that clears and returns is reported again — silence is not permanent', async () => {
  const { file } = repoKeyFile()
  const final = randomBytes(4096)
  const finalHash = sha(final)
  const custody = new MemoryCustody()
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody, repoZkeyPath: file,
  })

  // Absent: reported, then quiet.
  const first = await errorsWhile(async () => { await source(); await source() })
  assert.equal(first.length, 1)

  // Published: the source serves it, and the fault is over.
  await custody.put(finalHash, final)
  assert.equal((await source()).origin, 'ceremony')

  // A second source over the same now-empty custody faults afresh — the suppression is
  // tied to the condition standing, not to the message having been said once ever.
  const again = createProvingKeySource({
    store: await finalized(finalHash), custody: new MemoryCustody(), repoZkeyPath: file,
  })
  const second = await errorsWhile(async () => { await again() })
  assert.equal(second.length, 1)
})

test('a flapping ceremony record does not re-arm the standing key fault', async () => {
  const { file } = repoKeyFile()
  const finalHash = sha(randomBytes(4096))
  const finalizedStore = await finalized(finalHash)

  // The ceremony record answers every other call and throws on the rest, while the final
  // key stays absent from custody throughout. The absent key is the standing condition —
  // it holds the whole time, and the requests that never reach it must not make it news
  // again. Each outage of the record is its own event and is reported as one.
  let call = 0
  const store = {
    async status() {
      if (call++ % 2 === 1) throw new Error('mongo is flapping')
      return finalizedStore.status()
    },
  } as unknown as CeremoniaStore
  const source = createProvingKeySource({ store, custody: new MemoryCustody(), repoZkeyPath: file })

  const errors = await errorsWhile(async () => {
    for (let i = 0; i < 20; i++) await source()
  })

  const absent = errors.filter((e) => /neither custody nor the image/.test(String(e.msg)))
  assert.equal(absent.length, 1, 'the standing fault is one line however often it is re-derived')

  // And the flapping record itself is one line, not one per outage. Each refusal clears
  // and re-arms within milliseconds of the last, so the condition never settled — nine of
  // these ten outages are the same fault still going, and only the first is news.
  const unreadable = errors.filter((e) => /status unreadable/.test(String(e.msg)))
  assert.equal(unreadable.length, 1, 'a flapping dependency is one fault, not one per flap')
})

test('a fault that settles before returning is news again — the window forgives, it does not gag',
  async () => {
    const { file } = repoKeyFile()
    // A clock the test advances by hand, so the settle window is exercised rather than raced.
    let clock = 1_000_000
    let down = true
    const healthy = new MemoryCeremoniaStore()
    await healthy.open('00'.repeat(32), null)
    const store = {
      async status() {
        if (down) throw new Error('mongo is down')
        return healthy.status()
      },
    } as unknown as CeremoniaStore
    const source = createProvingKeySource({
      store, custody: new MemoryCustody(), repoZkeyPath: file, now: () => clock,
    })

    // Down: one error.
    const first = await errorsWhile(async () => { await source(); await source() })
    assert.equal(first.length, 1)

    // Recovered, and it STAYS recovered for well past the settle window.
    down = false
    await source()
    clock += 5 * 60_000

    // The same outage returns after a real recovery. That is a new incident and is said.
    down = true
    const second = await errorsWhile(async () => { await source() })
    assert.equal(second.length, 1, 'a fault that genuinely cleared is reported when it returns')
  })

test('an unreadable custody with the ceremony key in the image says so once, not per request', async () => {
  const { file, bytes } = repoKeyFile()
  const finalHash = sha(bytes)   // the image IS carrying the key the transcript names
  const custody = {
    async get() { throw new Error('custody volume is not mounted') },
    async put() { throw new Error('custody volume is not mounted') },
  } as unknown as ZkeyCustody
  const source = createProvingKeySource({
    store: await finalized(finalHash), custody, repoZkeyPath: file,
  })

  const lines = await linesWhile(async () => {
    for (let i = 0; i < 20; i++) {
      const key = await source()
      assert.equal(key.origin, 'ceremony')
      assert.equal(key.path, file)
    }
  })

  // The unreadable custody is one error, and the answer it fell back to is one info —
  // identified on the first request and kept, not re-derived and re-announced on all 20.
  assert.equal(lines.filter((e) => e.level === 'error').length, 1)
  assert.equal(lines.filter((e) => e.level === 'info').length, 1)
})
