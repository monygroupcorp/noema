import { Router } from 'express'
import type { CeremoniaStore } from '../../arcanum/CeremoniaStore.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('ceremonia:router')

// Public surface for the Arcanum trusted-setup ceremony. Read-only status + a
// contributor-slot request; the chain itself is advanced by the coordinator, not here.
// Mounted at /v1/ceremony (see index.ts) — matches the web app's lib/ceremony.ts client.

const MAX_CONTACT = 256

export function createCeremoniaRouter(store: CeremoniaStore): Router {
  const router = Router()

  // ── GET /v1/ceremony ──────────────────────────────────────────────────────────
  // Current ceremony status: phase, published root/final hashes, and the contribution
  // chain. Anyone can read it; it's the public transcript.
  router.get('/', async (_req, res) => {
    try {
      const status = await store.status()
      return res.json(status)
    } catch (err) {
      log.error('ceremony status error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── POST /v1/ceremony/slots ─────────────────────────────────────────────────────
  // Register interest in a contributor slot. Body: { contact: string }.
  // The coordinator reaches out with the current .zkey and the contributor's position.
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

  return router
}
