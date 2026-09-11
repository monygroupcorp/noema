import express, { type Express } from 'express'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { CeremoniaStore } from '../../arcanum/CeremoniaStore.js'
import { headHash } from '../../arcanum/CeremoniaStore.js'
import { LocalZkeyCustody, sha256Hex, type ZkeyCustody } from '../../arcanum/CeremoniaCustody.js'
import { createCeremoniaRouter } from './ceremoniaRouter.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('ceremonia:mount')

declare const __dirname: string

const ARTIFACTS = path.join(__dirname, '..', '..', 'arcanum', 'circuit', 'artifacts')
const R1CS_PATH = path.join(ARTIFACTS, 'arcanum.r1cs')
const ROOT_ZKEY = path.join(ARTIFACTS, 'arcanum_0000.zkey')

/**
 * Where the ceremony's zkey chain lives. The sequencer writes it; /arcanum/circuit/zkey
 * reads the finalized key back out of it, so both sides must resolve the same directory.
 *
 * The default sits inside the built application tree, which is fine for a dev checkout
 * and wrong for a container: the directory is part of the image, so every deploy hands
 * the ceremony an empty custody while the transcript in the database keeps naming keys
 * that used to be in it. On a container, set CEREMONY_ZKEY_DIR to a mounted path.
 */
export function ceremonyCustodyDir(): string {
  return process.env.CEREMONY_ZKEY_DIR ?? path.join(ARTIFACTS, 'ceremony')
}

/**
 * Publish a zkey into custody from a path on disk, keyed by its own sha256.
 *
 * Keys reach a sequencer this way when they were made somewhere else: the beacon'd final
 * key, applied on the coordinator's box, and a chain head being restored to a box that
 * lost it. `declared` is the hash the public record already names for this key — a file
 * that does not hash to it is the wrong file, and publishing it would put bytes in
 * custody under a name the transcript gives to something else.
 */
async function publishKey(
  custody: ZkeyCustody, envVar: string, file: string, declared: string | null,
): Promise<void> {
  try {
    if (!existsSync(file)) {
      log.error(`${envVar} set but the file is absent — key NOT published`, { path: file })
      return
    }
    const bytes = readFileSync(file)
    const hash = sha256Hex(bytes)
    if (declared && declared.toLowerCase() !== hash) {
      log.error(`${envVar} does not hash to the key the ceremony record names — refusing to publish it`,
        { fileHash: hash, declared: declared.toLowerCase() })
      return
    }
    await custody.put(hash, bytes)
    log.info('ceremony key published to custody', { envVar, hash, bytes: bytes.length })
  } catch (err) {
    log.error(`publishing ${envVar} failed`, { error: String(err) })
  }
}

/**
 * Wire the ceremony sequencer onto the app at /v1/ceremony and run the one-time
 * coordinator events as deploy-time toggles (so the live contribution flow itself never
 * needs a redeploy):
 *
 *   CEREMONY_OPEN=1            — seed the chain root from arcanum_0000.zkey and open it.
 *   CEREMONY_HEAD_ZKEY=<path>  — put the chain head back in custody on a box that does not
 *                                have it, so an open ceremony can accept contributions again.
 *   CEREMONY_FINAL_ZKEY=<path> — publish the beacon'd final proving key into custody, so
 *                                the site can serve the key the transcript names.
 *   CEREMONY_FINALIZE=<hash>   — seal the ceremony with the beacon'd final proving-key hash
 *                                (run scripts/arcanum-trusted-setup.sh --finalize first).
 *   CEREMONY_ZKEY_DIR          — custody dir for the zkey chain (default: <artifacts>/ceremony,
 *                                which on a container does not survive a deploy — mount one).
 *   ARCANUM_PTAU_PATH          — pot20_final.ptau for deep per-contribution verification.
 */
export async function mountCeremony(app: Express, store: CeremoniaStore): Promise<void> {
  const custodyDir = ceremonyCustodyDir()
  const custody = new LocalZkeyCustody(custodyDir)
  const ptauPath = process.env.ARCANUM_PTAU_PATH ?? path.join(ARTIFACTS, 'pot20_final.ptau')

  // ── one-time: open ──────────────────────────────────────────────────────────────
  if (process.env.CEREMONY_OPEN === '1') {
    try {
      const status = await store.status()
      if (status.phase === 'announced') {
        if (!existsSync(ROOT_ZKEY)) {
          log.error('CEREMONY_OPEN set but arcanum_0000.zkey absent — run arcanum-trusted-setup.sh --init')
        } else {
          const bytes = readFileSync(ROOT_ZKEY)
          const root = sha256Hex(bytes)
          await custody.put(root, bytes)
          const slots = process.env.CEREMONY_SLOTS ? Number(process.env.CEREMONY_SLOTS) : null
          await store.open(root, Number.isFinite(slots as number) ? slots : null)
          log.info('ceremony OPENED', { rootHash: root })
        }
      } else {
        log.info('CEREMONY_OPEN set but ceremony already past announced — no-op', { phase: status.phase })
      }
    } catch (err) {
      log.error('ceremony open failed', { error: String(err) })
    }
  }

  // ── restore a lost chain head ─────────────────────────────────────────────────────
  // Custody is the sequencer's own disk. A box that never held the chain, or held it and
  // lost it, has an open ceremony it cannot serve: the transcript names a head no
  // contributor can download. The key itself is not secret — the coordinator and every
  // contributor after them can produce the bytes — so putting it back is a file and a
  // restart, checked against the hash the transcript already published.
  const headZkey = process.env.CEREMONY_HEAD_ZKEY
  if (headZkey) {
    try {
      const declared = headHash(await store.status())
      if (!declared) {
        log.error('CEREMONY_HEAD_ZKEY set but the ceremony has no published head — nothing to restore')
      } else {
        await publishKey(custody, 'CEREMONY_HEAD_ZKEY', headZkey, declared)
      }
    } catch (err) {
      log.error('restoring the ceremony chain head failed', { error: String(err) })
    }
  }

  // ── one-time: publish the beacon'd final key ──────────────────────────────────────
  // The beacon is applied off the sequencer (scripts/arcanum-trusted-setup.sh --finalize),
  // so the final key exists only on the coordinator's box until it is put here. Without
  // it the transcript would name a key the site cannot serve. This runs BEFORE the phase
  // flip below: the ceremony must never read finalized while the key it names is absent.
  const finalZkey = process.env.CEREMONY_FINAL_ZKEY
  if (finalZkey) {
    await publishKey(custody, 'CEREMONY_FINAL_ZKEY', finalZkey, process.env.CEREMONY_FINALIZE ?? null)
  }

  // ── one-time: finalize ────────────────────────────────────────────────────────────
  const finalHash = process.env.CEREMONY_FINALIZE
  if (finalHash && /^[0-9a-f]{64}$/i.test(finalHash)) {
    try {
      const status = await store.status()
      if (status.phase === 'open') {
        await store.finalize(finalHash.toLowerCase())
        log.info('ceremony FINALIZED', { finalHash: finalHash.toLowerCase() })
      }
    } catch (err) {
      log.error('ceremony finalize failed', { error: String(err) })
    }
  }

  // A ceremony whose key is not on this box cannot do its job, and boot is the first place
  // that is knowable. Both halves below are the same failure — the record lives in the
  // database and the keys live on a disk, and nothing makes the disk outlive a deploy
  // unless CEREMONY_ZKEY_DIR points somewhere mounted.
  try {
    const status = await store.status()
    const head = headHash(status)
    if (status.phase === 'open' && head && !(await custody.has(head))) {
      log.error('the ceremony is OPEN but its chain head is not in custody — no contribution ' +
        'can be downloaded or accepted. Restore it with CEREMONY_HEAD_ZKEY=<the zkey that ' +
        'hashes to the head below>, and set CEREMONY_ZKEY_DIR to a mounted directory so the ' +
        'next deploy does not strand it again.', { headHash: head, custodyDir })
    }
    if (status.phase === 'finalized' && status.finalHash && !process.env.ARCANUM_ZKEY_URL) {
      if (!(await custody.has(status.finalHash))) {
        log.error('ceremony is finalized but its proving key is in neither custody nor ' +
          'ARCANUM_ZKEY_URL — the site can serve no proving key. Set CEREMONY_FINAL_ZKEY ' +
          'to the beacon\'d arcanum_final.zkey and redeploy.', { finalHash: status.finalHash })
      }
    }
  } catch (err) {
    log.error('ceremony key check failed', { error: String(err) })
  }

  app.use('/v1/ceremony', express.json(), createCeremoniaRouter(store, {
    custody,
    verifier: { r1csPath: R1CS_PATH, ptauPath: existsSync(ptauPath) ? ptauPath : undefined },
  }))
  log.info('ceremony sequencer mounted at /v1/ceremony', {
    deepVerify: existsSync(ptauPath),
    custodyDir,
    custodyPinned: Boolean(process.env.CEREMONY_ZKEY_DIR),
  })
}
