import { Router } from 'express'
import type { ArcanumIssuer } from '../../ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../../arcanum/ArcanumTree.js'

export function createArcanumRouter(
  arcanumIssuer: ArcanumIssuer,
  arcanumTree: ArcanumTreeStore,
): Router {
  const router = Router()

  // ── POST /issue ───────────────────────────────────────────────────────────────
  //
  // Convert identified credits into an anonymous ZK note.
  //
  // Body:
  //   animaId     string   required  — identity whose balance to debit
  //   valor       string   required  — amount (decimal bigint string, e.g. "200")
  //   commitment  string   optional  — client-generated commitment (max privacy mode)
  //   nullifier   string   optional  — client-provided nullifier (required if commitment given)
  //
  // Returns:
  //   note: ArcanumNote — commitment, nullifierHash, valor, leafIndex, spent=false
  //   merkleRoot        — current tree root at time of issuance
  //   merklePathElements — 32 sibling hashes (client needs for ZK proof)
  //   merklePathIndices  — 32 path bits
  //
  // The note is the ONLY time the client receives the Merkle path for this exact
  // tree state. Clients should persist it. To refresh the path (tree grew),
  // call GET /tree/proof/:leafIndex.

  router.post('/issue', async (req, res) => {
    const { animaId, valor: valorStr, commitment, nullifier } = req.body

    if (!animaId || typeof animaId !== 'string') {
      return res.status(400).json({ error: 'animaId is required' })
    }
    if (!valorStr || typeof valorStr !== 'string') {
      return res.status(400).json({ error: 'valor is required (decimal bigint string)' })
    }

    let valor: bigint
    try {
      valor = BigInt(valorStr)
      if (valor <= 0n) throw new Error('non-positive')
    } catch {
      return res.status(400).json({ error: 'valor must be a positive decimal integer string' })
    }

    if ((commitment == null) !== (nullifier == null)) {
      return res.status(400).json({ error: 'commitment and nullifier must be provided together' })
    }
    if (commitment != null && typeof commitment !== 'string') {
      return res.status(400).json({ error: 'commitment must be a string' })
    }
    if (nullifier != null && typeof nullifier !== 'string') {
      return res.status(400).json({ error: 'nullifier must be a string' })
    }

    try {
      const issuance = await arcanumIssuer.issue(
        { animaId },
        valor,
        commitment ? { commitment, nullifier: nullifier! } : undefined,
      )
      return res.status(201).json(issuance)
    } catch (err) {
      const msg = (err as Error).message ?? 'issue failed'
      if (/insufficient/i.test(msg)) return res.status(402).json({ error: msg })
      if (/positive/i.test(msg))    return res.status(400).json({ error: msg })
      console.error('[arcanumRouter] issue error:', err)
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /tree/root ────────────────────────────────────────────────────────────
  //
  // Returns the current Merkle root and tree size.
  //
  // Clients call this before generating a proof to confirm they have the
  // latest root. If their stored root is stale (tree grew after they issued),
  // they must fetch a fresh Merkle path via GET /tree/proof/:leafIndex.

  router.get('/tree/root', async (_req, res) => {
    try {
      const [root, size] = await Promise.all([
        arcanumTree.getRoot(),
        arcanumTree.size(),
      ])
      return res.json({ root, size })
    } catch (err) {
      console.error('[arcanumRouter] getRoot error:', err)
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /tree/proof/:leafIndex ────────────────────────────────────────────────
  //
  // Returns a fresh Merkle inclusion proof for the given leaf.
  //
  // Clients need a proof whose root matches the CURRENT tree root.
  // If other notes were issued after theirs, the path is still valid
  // but the root has changed. This endpoint returns an updated proof.
  //
  // The proof is NOT secret — it only says "a note exists at this index."
  // The ZK circuit keeps the nullifier and secret private.

  router.get('/tree/proof/:leafIndex', async (req, res) => {
    const raw = parseInt(req.params.leafIndex, 10)
    if (!Number.isInteger(raw) || raw < 0) {
      return res.status(400).json({ error: 'leafIndex must be a non-negative integer' })
    }

    try {
      const proof = await arcanumTree.getProof(raw)
      return res.json({ proof })
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (/out of range/i.test(msg)) return res.status(404).json({ error: msg })
      console.error('[arcanumRouter] getProof error:', err)
      return res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
