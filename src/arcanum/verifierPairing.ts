import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ServedProvingKey } from './ProvingKeySource.js'
import { makeLogger } from '../lib/logger.js'
import { faultReporter, SETTLE_MS } from '../lib/standingFault.js'

const log = makeLogger('arcanum:pairing')

// Does the verification key this server holds belong to the proving key it hands out?
//
// A Groth16 setup produces both halves together, and they are only meaningful as a pair.
// The two reach a running server by completely different roads: the proving key follows
// the ceremony transcript out of custody, and the verification key is a JSON file baked
// into the image. Nothing made those two agree.
//
// The tracked pair is checked at build time (tests/unit/arcanum/ArcanumPairing.test.ts),
// which is the right check for the state the repo ships in and says nothing about the
// state a finalized ceremony puts a server into. Publish the ceremony's key and every
// existing test stays green while the server hands clients one setup's proving key and
// judges their proofs with a different setup's verification key.
//
// That is not a symmetric failure. Honest proofs made with the served key are rejected,
// which is merely broken; but the verification key still in force is the committed dev
// one, and whoever holds that setup's toxic waste can forge against it. So a ceremony
// could be finalized, its key published, the page reporting the site ready — and the
// forgery the ceremony exists to close still open. This is the check that says so.

export type PairingVerdict =
  /** The verification key is the served proving key's own. */
  | 'paired'
  /** They are from different setups. Proofs made with the served key will not verify. */
  | 'mismatch'
  /** Not knowable here: no key is served, or none is held, or the bytes are elsewhere. */
  | 'unknown'

/** Structural equality over two snarkjs verification keys, field order included. */
export function sameVerificationKey(a: unknown, b: unknown): boolean {
  if (!a || !b) return false
  // snarkjs returns bigint-ish values from the exporter and JSON strings from a file;
  // a JSON round-trip puts both in the same shape before comparing.
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k])
    }
    return out
  }
  return typeof v === 'bigint' || typeof v === 'number' ? String(v) : v
}

/**
 * Every zkey opens with the four bytes `zkey` and a little-endian format version, and
 * snarkjs rejects anything else. It rejects it AFTER opening the file and without closing
 * it again — node treats a file handle reclaimed by the garbage collector as an uncaught
 * error, so a key that will never parse is a crash waiting on the next GC, not merely a
 * failed check. Whatever this can refuse before snarkjs opens anything, it refuses here.
 *
 * Returns the reason the header is not a v1 zkey's, or null if it is.
 */
export function zkeyHeaderProblem(head: Buffer): string | null {
  if (head.length < 8) return 'too short to be a zkey'
  if (head.toString('latin1', 0, 4) !== 'zkey') return 'Invalid File format'
  const version = head.readUInt32LE(4)
  // The version exportVerificationKey passes to readBinFile as its maximum.
  if (version > 1) return `zkey format version ${version} not supported`
  return null
}

/** The first bytes of a file, with the handle closed however the read ends. */
async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fd = await open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fd.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fd.close()
  }
}

/** snarkjs reads a zkey from a path; a key held as bytes gets one for the length of the call. */
async function exportVerificationKey(key: ServedProvingKey): Promise<unknown> {
  const snarkjs = await import('snarkjs')
  if (key.path) {
    const problem = zkeyHeaderProblem(await readHead(key.path, 8))
    if (problem) throw new Error(`${key.path}: ${problem}`)
    return snarkjs.zKey.exportVerificationKey(key.path)
  }
  const bytes = key.bytes as Buffer
  const problem = zkeyHeaderProblem(bytes.subarray(0, 8))
  // Refused before the 5MB write, not after it.
  if (problem) throw new Error(`served key: ${problem}`)
  const dir = await mkdtemp(path.join(tmpdir(), 'arcanum-pairing-'))
  const file = path.join(dir, 'served.zkey')
  try {
    await writeFile(file, bytes)
    return await snarkjs.zKey.exportVerificationKey(file)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * A pairing check over whatever key is being served right now, memoised on that key's
 * hash. Both keys are immutable once identified, so the answer for a given hash cannot
 * change, and the export — about a second on the 5MB key, and the only expensive part —
 * is paid once per key this process ever serves.
 *
 * `now` is the clock behind the retry window on a key that could not be read; tests pass
 * one, nothing else does.
 */
export function createVerifierPairing(
  verificationKey: unknown | undefined,
  now?: () => number,
): (key: ServedProvingKey) => Promise<PairingVerdict> {
  const seen = new Map<string, PairingVerdict>()
  // A key that could not be read is not memoised — the verdict has to be able to come
  // back — but retrying it on every GET /arcanum/config is not how it comes back, and it
  // is expensive in two ways that both compound per request. snarkjs leaks the open file
  // handle on a key it rejects (it is closed at garbage collection, which node now treats
  // as an error), so a key that will never parse costs a descriptor each time; and a key
  // that parses slowly costs the export again. So a failed export is retried no more
  // often than a fault takes to settle, and in between the answer stands.
  const failedAt = new Map<string, number>()
  const clock = now ?? Date.now
  const faults = faultReporter(log, now)
  return async (key) => {
    if (!verificationKey) return 'unknown'
    if (key.origin === 'none' || !key.hash) return 'unknown'
    const cached = seen.get(key.hash)
    if (cached) return cached
    const failed = failedAt.get(key.hash)
    if (failed !== undefined && clock() - failed < SETTLE_MS) return 'unknown'
    let verdict: PairingVerdict
    try {
      verdict = sameVerificationKey(await exportVerificationKey(key), verificationKey)
        ? 'paired'
        : 'mismatch'
    } catch (err) {
      // A key we cannot read is a key we cannot vouch for, and saying 'mismatch' would
      // take a working site down over a broken read. Say we do not know.
      failedAt.set(key.hash, clock())
      faults.report(`export-failed:${key.hash}`,
        'could not derive a verification key from the served proving key',
        { zkeyHash: key.hash, error: String(err) })
      return 'unknown'
    }
    if (verdict === 'mismatch') {
      log.error('the verification key this server holds is NOT the served proving key\'s own — ' +
        'proofs made with the key clients are given will not verify here, and the key still in ' +
        'force is whichever setup the image was built with. Export verification_key.json from ' +
        'the zkey being served and redeploy.', { zkeyHash: key.hash, zkeySource: key.origin })
    } else {
      log.info('verification key pairs with the served proving key', { zkeyHash: key.hash })
    }
    failedAt.delete(key.hash)
    faults.clear(`export-failed:${key.hash}`)
    seen.set(key.hash, verdict)
    return verdict
  }
}
