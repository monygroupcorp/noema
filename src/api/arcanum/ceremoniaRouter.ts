import { Router, raw } from 'express'
import type { CeremoniaStore } from '../../arcanum/CeremoniaStore.js'
import { headHash } from '../../arcanum/CeremoniaStore.js'
import {
  type ZkeyCustody,
  type ContinuationVerifierOpts,
  sha256Hex,
  verifyContinuation,
} from '../../arcanum/CeremoniaCustody.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('ceremonia:router')

// Public sequencer for the Arcanum trusted-setup ceremony — the KZG-summoning model.
// The contribution chain is live server state: contributors self-serve (download the
// head, contribute in-browser, upload), the page polls /v1/ceremony, and the chain
// grows with no redeploy. Mounted at /v1/ceremony (see index.ts).

const MAX_CONTACT = 256
const MAX_NAME = 80
const MAX_ZKEY_BYTES = 64 * 1024 * 1024 // arcanum zkey is ~5MB; cap generously.

export interface CeremoniaRouterConfig {
  /** Binary custody for the zkey chain — required for current.zkey + contributions. */
  custody?: ZkeyCustody
  /** snarkjs continuation-verifier inputs (r1cs always; ptau when mounted). */
  verifier?: ContinuationVerifierOpts
}

export function createCeremoniaRouter(
  store: CeremoniaStore,
  config: CeremoniaRouterConfig = {},
): Router {
  const router = Router()

  // ── GET /v1/ceremony ──────────────────────────────────────────────────────────
  // Public, pollable status: phase, published root/final hashes, and the live chain.
  router.get('/', async (_req, res) => {
    try {
      const status = await store.status()
      return res.json({ ...status, headHash: headHash(status) })
    } catch (err) {
      log.error('ceremony status error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── POST /v1/ceremony/slots ─────────────────────────────────────────────────────
  // Register interest in a contributor slot. Body: { contact: string }.
  router.post('/slots', async (req, res) => {
    const contact = req.body?.contact
    if (typeof contact !== 'string' || !contact.trim()) {
      return res.status(400).json({ error: 'contact is required' })
    }
    if (contact.length > MAX_CONTACT) {
      return res.status(400).json({ error: 'contact too long' })
    }
    try {
      await store.requestSlot(contact.trim())
      return res.status(201).json({ ok: true })
    } catch (err) {
      log.error('ceremony slot request error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /v1/ceremony/current.zkey ─────────────────────────────────────────────
  // Stream the current head — the zkey the next contributor builds on. The x-zkey-hash
  // header is the head's sha256 (== the value to pass back as x-based-on).
  router.get('/current.zkey', async (_req, res) => {
    if (!config.custody) return res.status(501).json({ error: 'ceremony custody not configured' })
    try {
      const status = await store.status()
      if (status.phase !== 'open') return res.status(409).json({ error: 'ceremony not open' })
      const head = headHash(status)
      if (!head) return res.status(409).json({ error: 'ceremony not open' })
      const bytes = await config.custody.get(head)
      if (!bytes) return res.status(503).json({ error: 'head zkey not in custody' })
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('x-zkey-hash', head)
      res.setHeader('Content-Disposition', `attachment; filename="arcanum_${head.slice(0, 8)}.zkey"`)
      return res.end(bytes)
    } catch (err) {
      log.error('current.zkey error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── POST /v1/ceremony/contributions ───────────────────────────────────────────
  // Upload a contribution. Body: raw zkey bytes (application/octet-stream).
  // Headers: x-based-on (head hash you built on), x-contributor-name (your handle).
  //
  // The server verifies it's a valid Phase-2 continuation (snarkjs), then appends under
  // an optimistic lock so concurrent uploads can't fork the chain. Anyone may contribute;
  // the gate is cryptographic, not an account — the 1-of-N honesty guarantee does the rest.
  router.post('/contributions',
    raw({ type: 'application/octet-stream', limit: MAX_ZKEY_BYTES }),
    async (req, res) => {
      if (!config.custody || !config.verifier) {
        return res.status(501).json({ error: 'ceremony custody not configured' })
      }
      const basedOn = String(req.header('x-based-on') || '').toLowerCase()
      const nameRaw = String(req.header('x-contributor-name') || 'anonymous').slice(0, MAX_NAME)
      const name = nameRaw.trim() || 'anonymous'
      const bytes = req.body as Buffer
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'empty body — send the zkey as application/octet-stream' })
      }
      if (!/^[0-9a-f]{64}$/.test(basedOn)) {
        return res.status(400).json({ error: 'x-based-on header (head hash) is required' })
      }

      try {
        const status = await store.status()
        if (status.phase !== 'open') return res.status(409).json({ error: 'ceremony not open' })
        const head = headHash(status)
        if (head !== basedOn) {
          return res.status(409).json({ error: 'stale head — re-fetch current.zkey and contribute again', head })
        }

        const outputHash = sha256Hex(bytes)
        if (outputHash === head) {
          return res.status(400).json({ error: 'no contribution detected (output identical to input)' })
        }

        const verdict = await verifyContinuation(bytes, config.verifier)
        if (!verdict.ok) {
          return res.status(400).json({ error: verdict.reason ?? 'invalid contribution' })
        }

        // Store bytes BEFORE the chain append so the head is always retrievable once named.
        await config.custody.put(outputHash, bytes)

        const appended = await store.appendContribution(
          { index: status.chain.length + 1, name, outputHash },
          head,
        )
        if (!appended) {
          // Someone extended the head between our read and write — the chain is safe,
          // this contribution just lost the race.
          return res.status(409).json({ error: 'another contribution landed first — re-fetch and retry' })
        }

        log.info('ceremony contribution accepted', {
          index: status.chain.length + 1, name, outputHash, deepVerified: verdict.deepVerified,
        })
        const next = await store.status()
        return res.status(201).json({ ...next, headHash: headHash(next), deepVerified: verdict.deepVerified })
      } catch (err) {
        log.error('contribution error', { error: String(err) })
        return res.status(500).json({ error: 'internal error' })
      }
    },
  )

  return router
}
