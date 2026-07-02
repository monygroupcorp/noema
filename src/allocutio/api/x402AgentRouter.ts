// =============================================================================
// x402AgentRouter — pay-per-call capability serving for agent spells (ADR-0011 §5).
// =============================================================================
//
// "The premise": an external on-chain agent discovers a Noema agent's spell, is
// quoted a USDC price, pays via `X-PAYMENT`, and the platform verifies → runs →
// settles the USDC on-chain; the Noema agent's OWNER takes a rev-share skim.
//
//   GET  /api/v1/x402/agents/:agentId/spell/:name   — discover (schema + quote)
//   POST /api/v1/x402/agents/:agentId/spell/:name   — run (x402-gated)
//
// The run itself is a normal crystal run (injected `runSpell`, funded by the
// payment); verify/settle are the injected facilitator seam; replay protection is
// the payment log's unique `signatureHash`. Payment failure is a 402 (never a
// catch-all 403); a run failure does NOT settle (the payer keeps their USDC).

import express, { type Router, type Request, type Response } from 'express'
import type { LegatusStore } from '../../types/legatus.js'
import type { Modorum, Modus } from '../../types/modus.js'
import type { X402Facilitator, X402LogStore } from '../../types/x402.js'
import type { Run } from './types.js'
import { aditusToJsonSchema } from './aditusToJsonSchema.js'
import { buildQuote, buildPaymentRequirements, acceptFor, type X402Config } from '../../crystal/x402Pricing.js'

export interface X402AgentDeps {
  legati: Pick<LegatusStore, 'findByAgentId'>
  modorum: Pick<Modorum, 'find'>
  facilitator: X402Facilitator
  log: X402LogStore
  config: X402Config
  /** Estimate the run cost in impetus for a modus + inputs. */
  quoteImpetus: (modusId: string, aditus: Record<string, unknown>) => Promise<bigint>
  /** Execute the agent's spell (funded by the x402 payment). Returns the completed Run. */
  runSpell: (input: {
    agentAnimaId: string; modusId: string; aditus: Record<string, unknown>; grossImpetus: bigint; agentId: string
  }) => Promise<Run>
  /** Accrue the agent's cut of a settled call — the MARGIN (price − our serve cost) minus our
   *  fee — to the payee's gated USD payout book (best-effort, non-fatal). Replaces the old
   *  reward-signa skim; the tax gate lives behind this (ADR-0013 §4c). */
  accrueAgentCut: (input: {
    payoutAddress: string; priceAtomic: string; serveImpetus: bigint; sourceRef: string; agentId: string; network: string
  }) => Promise<unknown>
  publicBase?: string
  /** `X402_ENABLED`. When false the endpoints 404 (feature-flagged like the legacy). */
  enabled?: boolean
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

export function createX402AgentRouter(deps: X402AgentDeps): Router {
  const base = (deps.publicBase ?? 'https://noema.art').replace(/\/$/, '')
  const router = express.Router({ mergeParams: true })

  /** Resolve the agent + its spell modus, or write the appropriate error. */
  async function resolve(req: Request, res: Response): Promise<{ agentId: string; animaId: string; ownerAddress: string; payoutAddress: string; modus: Modus } | null> {
    if (deps.enabled === false) { fail(res, 404, 'NOT_FOUND', 'x402 is not enabled'); return null }
    const agentId = String(req.params.agentId)
    const legatus = await deps.legati.findByAgentId(agentId)
    if (!legatus || legatus.status !== 'active') { fail(res, 404, 'AGENT_NOT_FOUND', 'Agent not found or inactive'); return null }
    // Which modus to run: an explicit `modusId` (from the widget's modus picker) if given,
    // else the agent's starter workspace modus. A requested modus MUST be the workspace one OR
    // owned by the agent's animaId — you can only run an agent's own capabilities.
    const requested = (typeof req.body?.modusId === 'string' && req.body.modusId)
      || (typeof req.query?.modusId === 'string' && req.query.modusId) || legatus.workspaceModusId
    if (!requested) { fail(res, 404, 'SPELL_NOT_FOUND', 'Agent has no runnable spell'); return null }
    const modus = await deps.modorum.find(requested)
    if (!modus) { fail(res, 404, 'SPELL_NOT_FOUND', 'Agent spell not found'); return null }
    const ownsIt = requested === legatus.workspaceModusId
      || (modus.auctor !== undefined && 'animaId' in modus.auctor && modus.auctor.animaId === legatus.animaId)
    if (!ownsIt) { fail(res, 403, 'NOT_AGENT_MODUS', 'That modus does not belong to this agent'); return null }
    // The agent's cut lands at their declared payout target, else the on-chain owner (§4c).
    const payoutAddress = legatus.payoutPolicy?.withdrawAddress ?? legatus.ownerAddress
    return { agentId, animaId: legatus.animaId, ownerAddress: legatus.ownerAddress, payoutAddress, modus }
  }

  const resourceUrl = (agentId: string, name: string): string => `${base}/api/v1/x402/agents/${agentId}/spell/${name}`

  // ── GET — discover: input schema + quote + payment requirements ───────────────
  router.get('/agents/:agentId/spell/:name', async (req: Request, res: Response): Promise<void> => {
    const r = await resolve(req, res)
    if (!r) return
    const name = String(req.params.name)
    const impetus = await deps.quoteImpetus(r.modus.id, {})
    const quote = buildQuote(impetus, deps.config)
    res.status(200).json({
      agentId: r.agentId,
      spell: name,
      name: r.modus.nomen,
      inputSchema: aditusToJsonSchema(r.modus.aditus),
      quote,
      accepts: [acceptFor(quote, deps.config)],
    })
  })

  // ── POST — run: x402-gated execution ──────────────────────────────────────────
  router.post('/agents/:agentId/spell/:name', async (req: Request, res: Response): Promise<void> => {
    try {
      const r = await resolve(req, res)
      if (!r) return
      const name = String(req.params.name)
      const aditus = (req.body?.inputs ?? {}) as Record<string, unknown>

      // 1. Quote → payment requirements.
      const impetus = await deps.quoteImpetus(r.modus.id, aditus)
      const quote = buildQuote(impetus, deps.config)
      const accept = acceptFor(quote, deps.config)

      // 2. No payment → 402 with the requirements.
      const paymentHeader = req.get('x-payment')
      if (!paymentHeader) {
        res.status(402).json({
          error: 'PAYMENT_REQUIRED',
          message: 'Payment required to run this spell',
          paymentRequired: buildPaymentRequirements(quote, deps.config, {
            url: resourceUrl(r.agentId, name), description: `${r.modus.nomen} execution`,
          }),
          quote: { baseCostUsd: quote.baseCostUsd, markupUsd: quote.markupUsd, totalCostUsd: quote.totalCostUsd },
        })
        return
      }

      // 3. Verify the payment (facilitator).
      const verified = await deps.facilitator.verify(paymentHeader, accept)
      if (!verified.valid || !verified.signatureHash) {
        res.status(402).json({ error: 'PAYMENT_INVALID', message: verified.error ?? 'Payment verification failed' })
        return
      }

      // 4. Replay guard — the unique signatureHash. A duplicate is refused, not re-run.
      const fresh = await deps.log.recordVerified({
        signatureHash: verified.signatureHash,
        payer: (verified.payer ?? '').toLowerCase(),
        amount: verified.amount ?? accept.amount,
        network: accept.network, asset: accept.asset, payTo: accept.payTo,
        agentId: r.agentId, spellName: name, modusId: r.modus.id, costUsd: quote.totalCostUsd,
      })
      if (!fresh) { fail(res, 409, 'PAYMENT_REPLAY', 'This payment has already been used'); return }

      // 5. Run the agent's spell (funded by the payment).
      let run: Run
      try {
        run = await deps.runSpell({ agentAnimaId: r.animaId, modusId: r.modus.id, aditus, grossImpetus: impetus, agentId: r.agentId })
      } catch (err) {
        await deps.log.recordFailed(verified.signatureHash, `run threw: ${(err as Error).message}`)
        fail(res, 502, 'EXECUTION_FAILED', `Spell execution failed: ${(err as Error).message}`)
        return
      }
      if (run.status === 'failed') {
        // Do NOT settle — the payer keeps their USDC.
        await deps.log.recordFailed(verified.signatureHash, run.failure?.code ?? 'run_failed')
        fail(res, 502, 'EXECUTION_FAILED', run.failure?.message ?? 'Spell execution failed')
        return
      }

      // 6. Settle the USDC on-chain, then skim the owner rev-share (best-effort).
      const settlement = await deps.facilitator.settle(paymentHeader, accept)
      if (settlement.success) {
        await deps.log.recordSettled(verified.signatureHash, settlement.transaction ?? '', run.id)
      } else {
        await deps.log.recordFailed(verified.signatureHash, `settle failed: ${settlement.error ?? 'unknown'}`)
      }
      await deps.accrueAgentCut({
        payoutAddress: r.payoutAddress, priceAtomic: verified.amount ?? accept.amount, serveImpetus: impetus,
        sourceRef: verified.signatureHash, agentId: r.agentId, network: accept.network,
      }).catch(() => { /* the agent cut is non-fatal — the run + settle already succeeded */ })

      if (settlement.transaction) res.setHeader('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({ success: settlement.success, transaction: settlement.transaction })).toString('base64'))
      res.status(200).json({
        runId: run.id,
        status: run.status,
        outputs: run.exitus ?? null,
        agentId: r.agentId,
        spell: name,
        x402: { settled: settlement.success, transaction: settlement.transaction ?? null },
      })
    } catch (err) {
      fail(res, 500, 'INTERNAL_ERROR', `Unexpected x402 error: ${(err as Error).message}`)
    }
  })

  return router
}
