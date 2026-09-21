// The logic around the pairing check — everything that does not need snarkjs to answer.
//
// A setup's two halves reach a running server by different roads. The proving key follows
// the ceremony transcript out of custody; the verification key is a JSON file baked into
// the image. Nothing made them agree, and the build-time check on the tracked pair
// (ArcanumPairing.test.ts) cannot see the pair a finalized ceremony puts in force.
//
// What matters as much as spotting a mismatch is not inventing one: 'unknown' has to stay
// distinct from 'mismatch', because a mismatch takes the site's `ready` flag down and a
// bad file handle or an absent key is no reason to do that.
//
// The real-snarkjs half is verifierPairingReal.test.ts, which has to live in its own
// process for reasons written down there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVerifierPairing, sameVerificationKey, zkeyHeaderProblem } from '../../../src/arcanum/verifierPairing.js'
import type { ServedProvingKey } from '../../../src/arcanum/ProvingKeySource.js'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'

const VKEY = { protocol: 'groth16', vk_alpha_1: ['1', '2', '1'] }
const REPO_KEY: ServedProvingKey = { origin: 'repo', hash: 'a'.repeat(64), path: '/nonexistent.zkey' }

test('serving no key is unknown, not a verdict about two keys', async () => {
  const none: ServedProvingKey = { origin: 'none', hash: null, reason: 'nothing to serve' }
  assert.equal(await createVerifierPairing(VKEY)(none), 'unknown')
})

test('holding no verification key is unknown, not a mismatch', async () => {
  // A server with no verification_key.json verifies nothing at all and says so elsewhere.
  // Calling that a pairing mismatch would blame the ceremony for an unrelated gap.
  assert.equal(await createVerifierPairing(undefined)(REPO_KEY), 'unknown')
})

test('a proving key that cannot be read is unknown, not a mismatch', async () => {
  // A broken read says nothing about the two keys, and calling it a mismatch would take a
  // working site's `ready` down over a bad file.
  const bad: ServedProvingKey = { origin: 'ceremony', hash: 'b'.repeat(64), bytes: Buffer.from('not a zkey') }
  assert.equal(await createVerifierPairing(VKEY)(bad), 'unknown')
  assert.equal(await createVerifierPairing(VKEY)(REPO_KEY), 'unknown')
})

test('sameVerificationKey compares values, not field order or number shape', () => {
  // snarkjs hands back numbers and bigints from the exporter where the tracked file has
  // strings, and object key order is not stable across the two. Neither is a mismatch.
  assert.equal(sameVerificationKey({ a: 1, b: '2' }, { b: '2', a: '1' }), true)
  assert.equal(sameVerificationKey({ a: [1, 2] }, { a: ['1', '3'] }), false)
  assert.equal(sameVerificationKey(null, { a: 1 }), false)
  assert.equal(sameVerificationKey({ a: 1 }, undefined), false)
})

// ---------------------------------------------------------------------------
// What a key that cannot be read costs per request.
//
// The verdict on an unreadable key is deliberately not memoised, so that a key which
// becomes readable is judged rather than written off. That leaves this path running again
// on every GET /arcanum/config — the same per-request loop the proving key source was
// just taken off — and it is expensive twice over: an unguarded error line each time, and
// a file handle each time, because snarkjs does not close the file it rejects.
// ---------------------------------------------------------------------------

/** Errors this check emitted while `fn` ran. The logger fans out to `bus`. */
async function errorsWhile(fn: () => Promise<void>): Promise<LogEntry[]> {
  const seen: LogEntry[] = []
  const onLog = (e: LogEntry) => {
    if (e.component === 'arcanum:pairing' && e.level === 'error') seen.push(e)
  }
  bus.on('log', onLog)
  try { await fn() } finally { bus.off('log', onLog) }
  return seen
}

/** A file that exists and is not a zkey — snarkjs opens it, then rejects it. */
function unreadableKey(): ServedProvingKey {
  const dir = mkdtempSync(path.join(tmpdir(), 'arcanum-badkey-'))
  const file = path.join(dir, 'served.zkey')
  writeFileSync(file, Buffer.from('not a zkey'))
  return { origin: 'ceremony', hash: 'c'.repeat(64), path: file }
}

test('a proving key that stays unreadable is an error once, not once per request', async () => {
  const bad = unreadableKey()
  const pairing = createVerifierPairing(VKEY, () => 0)

  const errors = await errorsWhile(async () => {
    for (let i = 0; i < 20; i++) assert.equal(await pairing(bad), 'unknown')
  })

  assert.equal(errors.length, 1)
  assert.equal(errors[0].zkeyHash, bad.hash)
})

test('a proving key that stays unreadable is opened once, not once per request', async () => {
  // snarkjs leaks the descriptor on a key it rejects — it is closed at garbage collection,
  // which node now calls an error — so re-reading a key that will never parse spends a
  // file descriptor per request until the process runs out of them.
  if (!existsSync('/proc/self/fd')) return // descriptors are only countable on Linux
  const bad = unreadableKey()
  const pairing = createVerifierPairing(VKEY, () => 0)

  await pairing(bad)
  const before = readdirSync('/proc/self/fd').length
  for (let i = 0; i < 20; i++) assert.equal(await pairing(bad), 'unknown')
  const after = readdirSync('/proc/self/fd').length

  assert.ok(after - before < 20, `20 requests opened ${after - before} more descriptors`)
})

test('a file that is not a zkey is refused by its header, before snarkjs opens it', () => {
  const v1 = Buffer.alloc(8)
  v1.write('zkey', 0, 'latin1')
  v1.writeUInt32LE(1, 4)
  assert.equal(zkeyHeaderProblem(v1), null)

  assert.match(String(zkeyHeaderProblem(Buffer.from('not a zkey'))), /Invalid File format/)
  assert.match(String(zkeyHeaderProblem(Buffer.from('zke'))), /too short/)

  const v99 = Buffer.from(v1)
  v99.writeUInt32LE(99, 4)
  assert.match(String(zkeyHeaderProblem(v99)), /version 99 not supported/)
})
