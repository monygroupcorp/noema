import { Router } from 'express'
import type { OctraDepositorum } from '../../types/octra.js'
import { commitmentToWire, parseCommitment } from '../../octra/commitment.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('octra:router')

/**
 * OCT funding-rail router. The ONLY new client-facing endpoint is deposit-intent
 * registration — the client then reuses the existing GET /arcanum/tree/leaf/:commitment
 * and /arcanum/tree/proof/:leafIndex to poll for its note and proof, unchanged.
 *
 * `deriveDepositAddress` produces a fresh single-use oct-address bound to the
 * commitment server-side. [UNCERTAIN: address derivation must match the live
 * node's "oct" + base58(sha256(ed25519_pubkey)) scheme — verify before mainnet.]
 */
export function createOctraRouter(
  deposita: OctraDepositorum,
  deriveDepositAddress: (commitmentWire: string) => Promise<string>,
): Router {
  const router = Router()

  // ── POST /intent ──────────────────────────────────────────────────────────
  //
  // Body: { commitment } — client-generated, hex wire form (0x + 64 hex) OR a
  // decimal field-element string. Returns a single-use deposit address.
  //
  //   1. CLIENT generates (nullifier, secret); commitment = poseidon(...)
  //   2. CLIENT POST /octra/intent { commitment }  → { depositAddr }
  //   3. CLIENT sends OCT to depositAddr from a FRESH oct-wallet (no memo needed)
  //   4. WATCHER ingests → arcanumTree.insert → note appears at /arcanum/tree/leaf
  router.post('/intent', async (req, res) => {
    const { commitment } = req.body ?? {}
    if (!commitment || typeof commitment !== 'string') {
      return res.status(400).json({ error: 'commitment is required' })
    }

    // Accept either wire (0x…) or decimal; normalize to both forms.
    let decimal: string | null = null
    let wire: string
    if (commitment.startsWith('0x')) {
      decimal = parseCommitment(commitment)
      wire = commitment
    } else {
      try {
        wire = commitmentToWire(commitment)
        decimal = parseCommitment(wire)
      } catch {
        decimal = null
        wire = ''
      }
    }
    if (!decimal) return res.status(400).json({ error: 'commitment is not a valid BN254 field element' })

    try {
      const depositAddr = await deriveDepositAddress(wire)
      const dep = await deposita.registerIntent(depositAddr, decimal)
      return res.status(201).json({ depositAddr, expiresHint: null, id: dep.id })
    } catch (err) {
      // unique depositAddr / commitment ⇒ intent already exists; surface its address
      const existing = await deposita.byDepositAddr(await deriveDepositAddress(wire)).catch(() => null)
      if (existing) return res.status(200).json({ depositAddr: existing.depositAddr, id: existing.id })
      log.error('intent registration failed', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
