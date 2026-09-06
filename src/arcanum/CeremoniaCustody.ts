import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readZkeyChain, extendsChain, type ChainVerdict } from './zkeyChain.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('ceremonia:custody')

// Custody for the ceremony's binary zkey chain — the sequencer hands the current head
// to the next contributor and stores each verified contribution back. Keyed by the
// zkey's sha256 (the same hash published in the chain transcript), so a contributor can
// confirm they got the exact file the transcript names.
//
// LocalZkeyCustody (disk) is the dev/single-box impl. Prod can swap an R2-backed custody
// behind the same interface — the head zkey is ~5MB. TODO(ops: R2 custody) for multi-box.

export interface ZkeyCustody {
  /** Raw zkey bytes for a given sha256, or null if absent. */
  get(hash: string): Promise<Buffer | null>
  /** Store zkey bytes under their sha256 (idempotent). */
  put(hash: string, bytes: Buffer): Promise<void>
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class LocalZkeyCustody implements ZkeyCustody {
  constructor(private readonly dir: string) {}

  private file(hash: string): string {
    // hash is hex from sha256Hex — safe as a filename, but guard against traversal anyway.
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('invalid zkey hash')
    return path.join(this.dir, `${hash}.zkey`)
  }

  async get(hash: string): Promise<Buffer | null> {
    const f = this.file(hash)
    if (!existsSync(f)) return null
    return readFile(f)
  }

  async put(hash: string, bytes: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.file(hash), bytes)
  }
}

export interface ContinuationVerifierOpts {
  /** Path to arcanum.r1cs. */
  r1csPath: string
  /**
   * Path to pot20_final.ptau (~1.2GB). When absent, deep verification is skipped
   * with a loud warning — the sequencer still enforces ordering + structural sanity,
   * and the coordinator's finalize step runs a full `zkey verify` before publishing.
   */
  ptauPath?: string
}

export interface ContinuationResult {
  ok: boolean
  /** true when snarkjs actually verified against r1cs+ptau; false = degraded (ptau absent). */
  deepVerified: boolean
  /**
   * The verifier itself could not run — a broken box, not a bad contribution. The caller
   * must not tell the contributor their key was rejected; nothing is wrong with it.
   */
  unavailable?: boolean
  reason?: string
}

// A deep verify is minutes of CPU and, in snarkjs, an open handle on the 1.2GB ptau that
// is never closed (zkey_verify_frominit.js `sameRatioH` opens it and returns). On Node 22+
// the collection of that handle throws ERR_INVALID_STATE from the GC — an uncaught
// exception, outside any try/catch, that takes the whole API process with it on the second
// contribution the sequencer ever verifies. So snarkjs runs in a child that verifies one
// key and exits: the leak dies with it, and the ceremony does not block the event loop of
// the server every other contributor is talking to.
const DEEP_VERIFY_TIMEOUT_MS = 15 * 60 * 1000
const VERIFY_CHILD = `
  const [r1cs, ptau, zkey] = process.argv.slice(1)
  import('snarkjs')
    .then((s) => s.zKey.verifyFromR1cs(r1cs, ptau, zkey))
    .then((valid) => { process.stdout.write(valid ? 'VALID' : 'INVALID'); process.exit(0) })
    .catch((e) => { process.stderr.write(String((e && e.message) || e)); process.exit(3) })
`

/** Run snarkjs `zkey verifyFromR1cs` out of process. Resolves to the child's verdict. */
function deepVerify(
  r1csPath: string, ptauPath: string, zkeyPath: string,
): Promise<ContinuationResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', VERIFY_CHILD, r1csPath, ptauPath, zkeyPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: DEEP_VERIFY_TIMEOUT_MS,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d.toString().slice(0, 2000) })
    child.on('error', (e) => {
      resolve({ ok: false, deepVerified: false, unavailable: true, reason: `verifier failed to start: ${e.message}` })
    })
    child.on('close', (code, signal) => {
      if (code === 0 && out.trim() === 'VALID') return resolve({ ok: true, deepVerified: true })
      if (code === 0 && out.trim() === 'INVALID') {
        return resolve({ ok: false, deepVerified: true, reason: 'zkey is not a valid continuation of the circuit' })
      }
      // 3 is snarkjs itself throwing on the key — a rejection, as it was before this ran
      // out of process. Anything else (a crash, a signal, a verifier that never loaded)
      // says nothing about the contribution.
      if (code === 3) {
        return resolve({ ok: false, deepVerified: true, reason: `verification error: ${err.trim() || 'snarkjs failed'}` })
      }
      log.error('deep verifier did not return a verdict', { code, signal, stderr: err.slice(0, 500) })
      resolve({
        ok: false, deepVerified: false, unavailable: true,
        reason: `verifier exited ${signal ?? code} without a verdict`,
      })
    })
  })
}

/**
 * Verify an uploaded zkey continues the ceremony from `headBytes` — the exact key the
 * sequencer handed this contributor.
 *
 * Two checks, cheapest first. The chain check reads both keys' contribution lists and
 * requires the upload to be the head's list plus exactly one; it is what binds the upload
 * to the head, and it runs whether or not the ptau is mounted. The deep check is snarkjs
 * proving each of those contributions is cryptographically sound; without the ptau it is
 * skipped (loudly), leaving the chain check and the coordinator's full `zkey verify` at
 * finalize.
 */
export async function verifyContinuation(
  bytes: Buffer,
  headBytes: Buffer,
  opts: ContinuationVerifierOpts,
): Promise<ContinuationResult> {
  let chain: ChainVerdict
  try {
    chain = extendsChain(readZkeyChain(headBytes), readZkeyChain(bytes))
  } catch (err) {
    return { ok: false, deepVerified: false, reason: err instanceof Error ? err.message : String(err) }
  }
  if (!chain.ok) return { ok: false, deepVerified: false, reason: chain.reason }

  if (!opts.ptauPath || !existsSync(opts.ptauPath)) {
    log.warn('ptau absent — accepting contribution WITHOUT deep snarkjs verification. ' +
      'Mount pot20_final.ptau on the sequencer for full per-contribution verification.')
    return { ok: true, deepVerified: false }
  }

  // snarkjs reads from paths; write the upload to a temp file.
  const tmp = path.join(os.tmpdir(), `arcanum-contrib-${sha256Hex(bytes).slice(0, 16)}.zkey`)
  try {
    await writeFile(tmp, bytes)
    return await deepVerify(opts.r1csPath, opts.ptauPath, tmp)
  } catch (err) {
    return { ok: false, deepVerified: false, unavailable: true, reason: `verification error: ${String(err)}` }
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
