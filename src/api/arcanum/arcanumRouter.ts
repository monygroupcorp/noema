import { Router, type Request } from 'express'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import type { ArcanumIssuer } from '../../ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../../arcanum/ArcanumTree.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('arcanum:router')

declare const __dirname: string

const ARTIFACTS_DIR = path.join(__dirname, '..', '..', 'arcanum', 'circuit', 'artifacts')
const WASM_PATH     = path.join(ARTIFACTS_DIR, 'arcanum.wasm')
const WASM_READY    = existsSync(WASM_PATH)

export interface ArcanumRouterConfig {
  /** Public URL where the proving key (.zkey) can be fetched by clients. */
  zkeyUrl?: string
  /** Public URL of this server — used to build the wasm URL in /config. */
  serverUrl?: string
  /**
   * Resolve the caller's animaId from an authenticated request.
   * When provided, POST /issue requires a valid credential and uses the
   * resolved animaId instead of accepting it from the request body.
   * When absent, /issue is disabled (returns 501).
   */
  resolve?: (req: Request) => Promise<{ animaId: string }>
}

export function createArcanumRouter(
  arcanumIssuer: ArcanumIssuer,
  arcanumTree: ArcanumTreeStore,
  config: ArcanumRouterConfig = {},
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
    if (!config.resolve) {
      return res.status(501).json({ error: 'issue endpoint not configured' })
    }

    let animaId: string
    try {
      const auctor = await config.resolve(req)
      animaId = auctor.animaId
    } catch {
      return res.status(401).json({ error: 'authentication required' })
    }

    const { valor: valorStr, commitment, nullifier } = req.body

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
      log.error('issue error', { error: String(err) })
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
      log.error('getRoot error', { error: String(err) })
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
      log.error('getProof error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /config ───────────────────────────────────────────────────────────────
  //
  // Prover discovery: client fetches this to learn where to get the wasm and zkey.
  //
  // Returns:
  //   wasmUrl  string  — URL to fetch arcanum.wasm (for snarkjs in-browser proving)
  //   zkeyUrl  string  — URL to fetch arcanum_final.zkey (~5MB dev / ~300MB prod)
  //   depth    number  — Merkle tree depth (32)
  //   ready    boolean — false when wasm or zkey is not yet configured

  router.get('/config', (_req, res) => {
    const wasmUrl = config.serverUrl
      ? `${config.serverUrl.replace(/\/$/, '')}/arcanum/circuit/wasm`
      : '/arcanum/circuit/wasm'
    const zkeyUrl = config.zkeyUrl ?? null
    return res.json({
      wasmUrl,
      zkeyUrl,
      depth: 32,
      ready: WASM_READY && zkeyUrl !== null,
    })
  })

  // ── GET /circuit/wasm ─────────────────────────────────────────────────────────
  //
  // Serve the compiled circuit WASM for client-side proof generation.
  // 2MB — safe to serve from the API. The proving key (.zkey) is large and lives on R2.

  router.get('/circuit/wasm', (req, res) => {
    if (!WASM_READY) {
      return res.status(404).json({ error: 'wasm not found — run arcanum-trusted-setup.sh' })
    }
    res.setHeader('Content-Type', 'application/wasm')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    const stream = createReadStream(WASM_PATH)
    stream.on('error', (err) => {
      log.error('wasm stream error', { error: String(err) })
      if (!res.headersSent) res.status(500).json({ error: 'internal error' })
      else res.destroy()
    })
    stream.pipe(res)
  })

  return router
}
