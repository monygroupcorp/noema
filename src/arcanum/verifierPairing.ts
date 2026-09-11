import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ServedProvingKey } from './ProvingKeySource.js'
import { makeLogger } from '../lib/logger.js'

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

/** snarkjs reads a zkey from a path; a key held as bytes gets one for the length of the call. */
async function exportVerificationKey(key: ServedProvingKey): Promise<unknown> {
  const snarkjs = await import('snarkjs')
  if (key.path) return snarkjs.zKey.exportVerificationKey(key.path)
  const dir = await mkdtemp(path.join(tmpdir(), 'arcanum-pairing-'))
  const file = path.join(dir, 'served.zkey')
  try {
    await writeFile(file, key.bytes as Buffer)
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
 */
export function createVerifierPairing(
  verificationKey: unknown | undefined,
): (key: ServedProvingKey) => Promise<PairingVerdict> {
  const seen = new Map<string, PairingVerdict>()
  return async (key) => {
    if (!verificationKey) return 'unknown'
    if (key.origin === 'none' || !key.hash) return 'unknown'
    const cached = seen.get(key.hash)
    if (cached) return cached
    let verdict: PairingVerdict
    try {
      verdict = sameVerificationKey(await exportVerificationKey(key), verificationKey)
        ? 'paired'
        : 'mismatch'
    } catch (err) {
      // A key we cannot read is a key we cannot vouch for, and saying 'mismatch' would
      // take a working site down over a broken read. Say we do not know.
      log.error('could not derive a verification key from the served proving key',
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
    seen.set(key.hash, verdict)
    return verdict
  }
}
