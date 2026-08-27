// =============================================================================
// depositsAdminRouter — operator-triggered deposit reconciliation
// =============================================================================
//
//   POST /internal/v1/admin/deposits/reconcile   { chainId, fromBlock?, toBlock? }
//
// Re-reads the CreditVault's own logs over a block window and processes anything not already
// recorded, through the single crediting core. Idempotent: a window that is already fully
// reconciled credits nothing.
//
// Gated by `x-internal-secret`, same discipline as the other /internal routers: an unconfigured
// secret refuses every request rather than admitting it.
// =============================================================================

import express, { type Router, type Request, type Response } from 'express'
import { reconcileVaultDeposits, type DepositReconcilerDeps } from '../../crystal/DepositReconciler.js'

export interface DepositsAdminDeps {
  reconciler: DepositReconcilerDeps
  /** The chains this deployment serves; anything else is refused. */
  servedChainIds: string[]
  /** `x-internal-secret` gate. Absent → every request is refused (401). */
  secret?: string
}

/** A block number: a non-negative integer, however the caller spelled it. */
function parseBlock(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[0-9]+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(n) || n < 0) return 'invalid'
  return n
}

export function createDepositsAdminRouter(deps: DepositsAdminDeps): Router {
  const router = express.Router()

  router.use((req: Request, res: Response, next): void => {
    const provided = req.headers['x-internal-secret'] ?? req.query.token
    if (!deps.secret || provided !== deps.secret) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid internal secret' } })
      return
    }
    next()
  })

  router.post('/admin/deposits/reconcile', async (req: Request, res: Response): Promise<void> => {
    const chainId = String(req.body?.chainId ?? '')
    if (!deps.servedChainIds.includes(chainId)) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'chainId is not served by this deployment' } })
      return
    }
    const fromBlock = parseBlock(req.body?.fromBlock)
    const toBlock = parseBlock(req.body?.toBlock)
    if (fromBlock === 'invalid' || toBlock === 'invalid') {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'fromBlock/toBlock must be non-negative integers' } })
      return
    }
    if (fromBlock !== null && toBlock !== null && toBlock < fromBlock) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'toBlock must not precede fromBlock' } })
      return
    }

    try {
      const report = await reconcileVaultDeposits(deps.reconciler, {
        chainId,
        ...(fromBlock !== null ? { fromBlock } : {}),
        ...(toBlock !== null ? { toBlock } : {}),
      })
      res.status(200).json(report)
    } catch (err) {
      res.status(502).json({ error: { code: 'RECONCILE_FAILED', message: err instanceof Error ? err.message : String(err) } })
    }
  })

  return router
}
