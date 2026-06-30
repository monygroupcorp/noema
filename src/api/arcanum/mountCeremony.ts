import express, { type Express } from 'express'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { CeremoniaStore } from '../../arcanum/CeremoniaStore.js'
import { LocalZkeyCustody, sha256Hex } from '../../arcanum/CeremoniaCustody.js'
import { createCeremoniaRouter } from './ceremoniaRouter.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('ceremonia:mount')

declare const __dirname: string

const ARTIFACTS = path.join(__dirname, '..', '..', 'arcanum', 'circuit', 'artifacts')
const R1CS_PATH = path.join(ARTIFACTS, 'arcanum.r1cs')
const ROOT_ZKEY = path.join(ARTIFACTS, 'arcanum_0000.zkey')

/**
 * Wire the ceremony sequencer onto the app at /v1/ceremony and run the two one-time
 * coordinator events as deploy-time toggles (so the live contribution flow itself never
 * needs a redeploy):
 *
 *   CEREMONY_OPEN=1            — seed the chain root from arcanum_0000.zkey and open it.
 *   CEREMONY_FINALIZE=<hash>   — seal the ceremony with the beacon'd final proving-key hash
 *                                (run scripts/arcanum-trusted-setup.sh --finalize first).
 *   CEREMONY_ZKEY_DIR          — custody dir for the zkey chain (default: <artifacts>/ceremony).
 *   ARCANUM_PTAU_PATH          — pot20_final.ptau for deep per-contribution verification.
 */
export async function mountCeremony(app: Express, store: CeremoniaStore): Promise<void> {
  const custodyDir = process.env.CEREMONY_ZKEY_DIR ?? path.join(ARTIFACTS, 'ceremony')
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

  app.use('/v1/ceremony', express.json(), createCeremoniaRouter(store, {
    custody,
    verifier: { r1csPath: R1CS_PATH, ptauPath: existsSync(ptauPath) ? ptauPath : undefined },
  }))
  log.info('ceremony sequencer mounted at /v1/ceremony', {
    deepVerify: existsSync(ptauPath), custodyDir,
  })
}
