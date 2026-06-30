import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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
  reason?: string
}

/**
 * Verify an uploaded zkey is a valid Phase-2 continuation of the circuit. Runs
 * snarkjs `zkey verifyFromR1cs` when the ptau is available; otherwise degrades to a
 * structural accept (logged) so a single-box dev sequencer still works.
 */
export async function verifyContinuation(
  bytes: Buffer,
  opts: ContinuationVerifierOpts,
): Promise<ContinuationResult> {
  if (!opts.ptauPath || !existsSync(opts.ptauPath)) {
    log.warn('ptau absent — accepting contribution WITHOUT deep snarkjs verification. ' +
      'Mount pot20_final.ptau on the sequencer for full per-contribution verification.')
    return { ok: true, deepVerified: false }
  }

  // snarkjs reads from paths; write the upload to a temp file.
  const tmp = path.join(os.tmpdir(), `arcanum-contrib-${sha256Hex(bytes).slice(0, 16)}.zkey`)
  try {
    await writeFile(tmp, bytes)
    const snarkjs = await import('snarkjs')
    const valid: boolean = await snarkjs.zKey.verifyFromR1cs(opts.r1csPath, opts.ptauPath, tmp)
    return valid
      ? { ok: true, deepVerified: true }
      : { ok: false, deepVerified: true, reason: 'zkey is not a valid continuation of the circuit' }
  } catch (err) {
    return { ok: false, deepVerified: true, reason: `verification error: ${String(err)}` }
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
