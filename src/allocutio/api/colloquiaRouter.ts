// =============================================================================
// colloquiaRouter — the concierge's HTTP surface (noema-095, MONEY CODE).
// =============================================================================
//
// Mounted at /v1/colloquia. Routes below are relative to that mount:
//
//   POST /                        — create a conversation thread (owned by the caller's
//                                    ownerKey; anon-capable via the noema-092 bursaToken /
//                                    commitment seam — no animaId required)
//   GET /                         — list the caller's own threads, newest-first, with a
//                                    short preview per thread (noema-111). READ-only.
//   GET /:id                      — the full thread (colloquium + its dicta), for resume
//                                    (noema-111). READ-only.
//   POST /:id/dicta               — run ONE turn: persist the user Dictum, run the
//                                    read-only ConciergeAgent (noema-094), persist the agent
//                                    Dictum, and METER the turn.
//
// METERING (Decision Q1, DIRECT SETTLE — supersedes the pre-095 "concierge settles only on
// GO" note in ApiCursor.ts). A concierge turn is a CHAT turn, not a generation: it settles
// DIRECTLY, per-turn, at the EXACT OpenRouter chat cost (`chatImpetus(sumTokens, 3n/1k)`),
// independent of `createRun`/GO. No Actum/run record is created per turn.
//
// TWO RAILS (locked ruling — anon metering split):
//   • animaId / commitment (Signorum-backed) → EXACT cost: reserve a per-turn cap, run,
//     settle the ACTUAL summed-token cost, refund the unused delta, and stamp the resulting
//     signaIds onto the agent Dictum. The mainline (the real ZK-soul anon path included).
//   • bursaToken (Bursa ephemeral purse)     → FLAT CAP debit: debit the whole per-turn cap,
//     NO refund, `Dictum.signaIds` stays EMPTY (a bursa turn yields no signum by design). The
//     Bursa rail is deliberately NOT extended with refund machinery.
//
// INVARIANTS under review here (value conservation is the whole risk surface):
//   (1) A turn is charged AT MOST ONCE. Idempotency keys on the caller-supplied `turnKey`, enforced
//       ATOMICALLY at the store: a UNIQUE PARTIAL index on (colloquiumId, turnKey) over AGENT dicta
//       (src/crystal/ensureIndexes.ts) makes the agent-Dictum insert the per-turn CHARGE GATE. A
//       sequential retry returns the persisted turn before running (no re-run). A CONCURRENT retry
//       racing the still-in-flight original may re-run the READ-ONLY agent, but the second
//       agent-Dictum insert loses on E11000 → its reservation is released and the winner's turn is
//       returned, so the settle/debit fires exactly once — no double-charge even under the TOCTOU
//       read-check-then-act window (Decision Q2).
//   (2) Affordability is checked BEFORE the agent runs. Insufficient balance/purse → 402 with
//       NO Dictum persisted, NO provider call, NO partial debit (Decision Q1/Q2).
//   (3) The charge (settle / debit) happens only AFTER the agent Dictum is durable, and the
//       Signorum reservation is RELEASED on any failure before settle — so a crashed turn is
//       never charged, and a retry re-runs cleanly. Never run the LLM then fail to charge in a
//       way that double-charges; the failure mode is an (accepted) free turn, never a double.
//   (4) The agent tool surface is the four READ-ONLY discovery handlers only — the endpoint
//       runs the SAME `runConcierge` whose `TOOL_SPECS` can never induce a spend tool
//       (noema-094 invariant (a)), honored end-to-end here.
//
// Sibling of purseRouter.ts / x402AgentRouter.ts: a self-contained `create*Router(deps)` with
// its own DI-injected store/ledger slices, mounted at `/v1/colloquia` by src/index.ts.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'

import type { AuctorKey } from '../../flow/types.js'
import type { Signorum } from '../../types/significandi.js'
import type { Bursarum } from '../../types/bursa.js'
import type { ColloquiumStore, DictumStore, Dictum, Colloquium } from '../../types/colloquium.js'
import { ownerKeyOf } from '../../crystal/ownerKey.js'
import { OPENROUTER_PROVIDER, chatImpetus } from '../../crystal/apiProviders.js'
import { credentialsFromHeaders, type Credentials } from './IdentityResolver.js'
import { refuseTerminalPurse, TerminalPurseError } from './bursaGate.js'
import { ApiError, Errors } from './errors.js'
import { makeLogger } from '../../lib/logger.js'
import { runConcierge, type ConciergeContext, type ConciergeDeps, type ConciergeResult } from './ConciergeAgent.js'
import type { OpenRouterToolClientDeps, OpenRouterChatMessage } from './OpenRouterToolClient.js'
import type { CrystalApi } from './CrystalApi.js'
import type { Run } from './types.js'

const log = makeLogger('api:colloquia')

/** Per-turn reserve cap in impetus (locked ruling): default 200, env-overridable
 *  at the construction site (`CONCIERGE_TURN_CAP_IMPETUS`). The cap bounds one turn's spend
 *  and — with the ~10-turn history bound below — keeps token cost predictable and coverable. */
export const DEFAULT_CONCIERGE_TURN_CAP_IMPETUS = 200n

/** How many prior Dicta are fed to the agent as history (locked ruling) — bounding
 *  the context keeps per-turn token cost (and thus the settled charge) under the cap. */
export const HISTORY_TURN_LIMIT = 10

export interface ColloquiaRouterDeps {
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
  colloquia: Pick<ColloquiumStore, 'create' | 'find' | 'findByOwner'>
  dicta: Pick<DictumStore, 'create' | 'update' | 'listByColloquium' | 'findByTurnKey'>
  /** The ledger — the Signorum-backed EXACT-cost rail (animaId / commitment callers). */
  signorum: Pick<Signorum, 'balance' | 'reserve' | 'settle' | 'release'>
  /** The ephemeral-purse FLAT-CAP rail (bursaToken callers). */
  bursarium: Pick<Bursarum, 'findByToken' | 'debit'>
  /** Read-only handler backend the agent tool-loop calls, plus the caller-context reads
   *  (`getMe` for spicyMode/style/bindings; `getRun` for the owner-scoped critique prior run). */
  api: CrystalApi
  /** The noema-093 OpenRouter tool-chat seam + the model the concierge runs on. */
  agent: {
    runToolChat: ConciergeDeps['runToolChat']
    toolClient: OpenRouterToolClientDeps
    model?: string
  }
  /** Per-turn reserve cap (impetus). Omit → DEFAULT_CONCIERGE_TURN_CAP_IMPETUS. */
  turnCapImpetus?: bigint
  /** Agent entrypoint override — defaults to the real `runConcierge`. Tests may inject a stub;
   *  production ALWAYS runs the real loop so invariant (4) is exercised end-to-end. */
  runConcierge?: typeof runConcierge
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

/** A Mongo duplicate-key (E11000) error — the per-turn CHARGE-GATE collision (noema-095): a
 *  concurrent dicta POST with the same turnKey already persisted this turn's agent Dictum. Duck-typed
 *  on `.code` so it also recognizes the in-memory DictumStore fake's simulated dup-key in tests. */
function isDuplicateTurnClaim(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}

/** The Signorum identity for a caller, or null for a bursaToken (which has no ledger identity —
 *  it spends the ephemeral Bursa purse instead). */
function signorumBy(auctor: AuctorKey): { animaId: string } | { commitment: string } | null {
  if ('animaId' in auctor) return { animaId: auctor.animaId }
  if ('commitment' in auctor) return { commitment: auctor.commitment }
  return null
}

/** Prior Dicta → OpenRouter wire history (user→user, agent→assistant, systema→system). */
function toHistory(dicta: Dictum[]): OpenRouterChatMessage[] {
  return dicta.map((d) => ({
    role: d.genus === 'user' ? ('user' as const) : d.genus === 'agent' ? ('assistant' as const) : ('system' as const),
    content: d.corpus,
  }))
}

/** The text recorded as the agent Dictum's corpus: a reply's text, or the proposal serialized
 *  (so the thread round-trips what the agent actually produced). */
function dictumCorpus(result: ConciergeResult): string {
  if (result.kind === 'reply') return result.text
  const { tokenUsage: _t, ...proposal } = result
  return JSON.stringify(proposal)
}

function serializeColloquium(c: Colloquium): Record<string, unknown> {
  return {
    id: c.id,
    status: c.status,
    ...(c.titulus !== undefined ? { titulus: c.titulus } : {}),
    ...(c.projectId !== undefined ? { projectId: c.projectId } : {}),
    ...(c.tabulaId !== undefined ? { tabulaId: c.tabulaId } : {}),
    ...(c.modoId !== undefined ? { modoId: c.modoId } : {}),
    natum: c.natum,
    mutatum: c.mutatum,
  }
}

/** Max length of the list-view preview (first user message, truncated) — legible without an N+1
 *  full-thread fetch and small enough to keep the list payload bounded (noema-111). */
const PREVIEW_MAX_CHARS = 140

/** First user Dictum's corpus for a thread, truncated — the list preview (noema-111). Empty
 *  string when the thread has no user turn yet (a thread created but never sent to). */
function previewOf(dicta: Dictum[]): string {
  const firstUser = dicta.find((d) => d.genus === 'user')
  if (!firstUser) return ''
  const text = firstUser.corpus.trim()
  return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS)}…` : text
}

function serializeDictum(d: Dictum): Record<string, unknown> {
  return {
    id: d.id,
    colloquiumId: d.colloquiumId,
    genus: d.genus,
    corpus: d.corpus,
    signaIds: d.signaIds,
    ...(d.turnKey !== undefined ? { turnKey: d.turnKey } : {}),
    natum: d.natum,
  }
}

export function createColloquiaRouter(deps: ColloquiaRouterDeps): Router {
  const router = express.Router()
  const cap = deps.turnCapImpetus ?? DEFAULT_CONCIERGE_TURN_CAP_IMPETUS
  const runTurn = deps.runConcierge ?? runConcierge

  /** Resolve the caller's identity. A bursaToken in the body or `x-bursa-token` header
   *  short-circuits to the anonymous bursa identity (noema-092 seam), matching apiRouter.ts —
   *  but only for a purse that is still live. A revoked or redeemed purse refuses its own
   *  token here, before it can own a thread or read one (`bursaGate.ts`). This surface has no
   *  ANON_PURSE gate of its own and does not acquire one: an anon purse holds concierge
   *  threads today, and only the terminal-status rule is being added. */
  const auth = async (req: Request): Promise<AuctorKey> => {
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) {
      refuseTerminalPurse(await deps.bursarium.findByToken(bursaToken))
      return { bursaToken }
    }
    return deps.identity.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )
  }

  /** Async route wrapper — a thrown ApiError → its httpStatus + `{ error }`; anything else → 500. */
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          log.error('unhandled colloquia error', { method: req.method, path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // POST /v1/colloquia — create a thread. Anon-capable: owned by the caller's ownerKey
  // (animaId, commitment, or bursaToken all collapse to a stable ownerKey — noema-092).
  router.post(
    '/',
    wrap(async (req, res) => {
      let auctor: AuctorKey
      try {
        auctor = await auth(req)
      } catch (err) {
        if (err instanceof TerminalPurseError) throw err   // a decided refusal, not a failed read
        fail(res, 401, 'auth.invalid', 'Sign in or present a bursa token to start a conversation')
        return
      }
      const ownerKey = ownerKeyOf(auctor)
      const titulus = typeof req.body?.titulus === 'string' ? req.body.titulus.slice(0, 200) : undefined
      const tabulaId = typeof req.body?.tabulaId === 'string' ? req.body.tabulaId : undefined
      const modoId = typeof req.body?.modoId === 'string' ? req.body.modoId : undefined
      // The active project at create time (noema-111) — a grouping tag only. Absent → uncategorized.
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined
      const colloquium = await deps.colloquia.create({
        ownerKey,
        status: 'active',
        ...(titulus !== undefined ? { titulus } : {}),
        ...(projectId !== undefined ? { projectId } : {}),
        ...(tabulaId !== undefined ? { tabulaId } : {}),
        ...(modoId !== undefined ? { modoId } : {}),
      })
      res.status(200).json({ colloquium: serializeColloquium(colloquium) })
    }),
  )

  // GET /v1/colloquia — list the caller's own threads, newest-first, each with a short preview.
  // READ-only (no metering/settle). STRICTLY ownerKey-scoped via findByOwner(ownerKeyOf(auctor)) —
  // a caller can never see another owner's threads (noema-111).
  router.get(
    '/',
    wrap(async (req, res) => {
      let auctor: AuctorKey
      try {
        auctor = await auth(req)
      } catch (err) {
        if (err instanceof TerminalPurseError) throw err   // a decided refusal, not a failed read
        fail(res, 401, 'auth.invalid', 'Sign in or present a bursa token to list conversations')
        return
      }
      const mine = await deps.colloquia.findByOwner(ownerKeyOf(auctor))
      // Newest-activity first so the list reads like a recents pane.
      mine.sort((a, b) => new Date(b.mutatum).getTime() - new Date(a.mutatum).getTime())
      const colloquia = await Promise.all(
        mine.map(async (c) => {
          // Bounded per-thread first-message read for the legible preview (the thread's dicta are
          // already small; this is not the full-thread hydrate the :id route does).
          const dicta = await deps.dicta.listByColloquium(c.id)
          return { ...serializeColloquium(c), preview: previewOf(dicta) }
        }),
      )
      res.status(200).json({ colloquia })
    }),
  )

  // GET /v1/colloquia/:id — the full thread (colloquium + its dicta), for resume. READ-only.
  // SAME authz as the dicta POST: not-found OR not-owned → 404, so a cross-owner probe cannot
  // distinguish "someone else's thread" from "no thread" (noema-111, pattern reused verbatim).
  router.get(
    '/:id',
    wrap(async (req, res) => {
      let auctor: AuctorKey
      try {
        auctor = await auth(req)
      } catch (err) {
        if (err instanceof TerminalPurseError) throw err   // a decided refusal, not a failed read
        fail(res, 401, 'auth.invalid', 'Sign in or present a bursa token')
        return
      }
      const colloquiumId = String(req.params.id)
      const colloquium = await deps.colloquia.find(colloquiumId)
      if (!colloquium || colloquium.ownerKey !== ownerKeyOf(auctor)) {
        fail(res, 404, 'not.found', 'Colloquium not found')
        return
      }
      const dicta = await deps.dicta.listByColloquium(colloquiumId)
      res.status(200).json({
        colloquium: serializeColloquium(colloquium),
        dicta: dicta.map(serializeDictum),
      })
    }),
  )

  // POST /v1/colloquia/:id/dicta — run ONE metered turn.
  router.post(
    '/:id/dicta',
    wrap(async (req, res) => {
      let auctor: AuctorKey
      try {
        auctor = await auth(req)
      } catch (err) {
        if (err instanceof TerminalPurseError) throw err   // a decided refusal, not a failed read
        fail(res, 401, 'auth.invalid', 'Sign in or present a bursa token')
        return
      }

      // (a) Load the colloquium and enforce ownerKey authz. Not-found OR not-owned → 404, so a
      //     cross-owner probe cannot even distinguish "someone else's thread" from "no thread".
      const colloquiumId = String(req.params.id)
      const colloquium = await deps.colloquia.find(colloquiumId)
      if (!colloquium || colloquium.ownerKey !== ownerKeyOf(auctor)) {
        fail(res, 404, 'not.found', 'Colloquium not found')
        return
      }

      // Caller-supplied idempotency/turn key (Decision Q2) — REQUIRED.
      const turnKey = typeof req.body?.turnKey === 'string' && req.body.turnKey.trim() ? req.body.turnKey.trim() : null
      if (!turnKey) {
        fail(res, 400, 'input.malformed', 'a turnKey (idempotency key) is required')
        return
      }

      const message = typeof req.body?.message === 'string' ? req.body.message : undefined
      if (message === undefined || message.trim() === '') {
        fail(res, 400, 'input.malformed', 'a non-empty message is required')
        return
      }

      // (b) Idempotent replay: if the AGENT Dictum for this turn key already exists, the turn
      //     already ran + settled — return it verbatim, no re-run, no re-charge (invariant (1)).
      const priorTurn = await deps.dicta.findByTurnKey(colloquiumId, turnKey)
      const priorAgent = priorTurn.find((d) => d.genus === 'agent')
      if (priorAgent) {
        res.status(200).json({ dictum: serializeDictum(priorAgent), idempotentReplay: true })
        return
      }
      const priorUser = priorTurn.find((d) => d.genus === 'user')

      // (c) Affordability BEFORE running the agent (invariant (2)).
      const by = signorumBy(auctor)
      const actumRef = `concierge:${colloquiumId}:${turnKey}` // synthetic correlation id — NOT an Actum.
      let reservationSignaIds: string[] | null = null
      if (by) {
        // Signorum EXACT-cost rail: reserve() IS the atomic affordability check — it fails closed,
        // locking nothing when the balance can't cover the cap.
        const reservation = await deps.signorum.reserve(by, cap, actumRef)
        if (!reservation.ok) {
          fail(res, 402, 'insufficient.balance', `Insufficient balance for a concierge turn (need ${cap}, have ${reservation.available})`)
          return
        }
        reservationSignaIds = reservation.signaIds
      } else {
        // Bursa FLAT-CAP rail: pre-check the purse can cover the cap; the debit itself happens only
        // AFTER the agent Dictum is durable (invariant (3)) so a retry can never double-debit.
        const bursaToken = (auctor as { bursaToken: string }).bursaToken
        const purse = await deps.bursarium.findByToken(bursaToken)
        if (!purse || purse.credits < cap) {
          fail(res, 402, 'insufficient.balance', `Insufficient purse credits for a concierge turn (need ${cap})`)
          return
        }
      }

      // From here the reservation (if any) is LIVE — any failure before settle must release it.
      let settled = false
      try {
        // (f) Assemble the caller context. History is PRIOR turns only (exclude this turnKey's own
        //     dicta so a retry-after-failure never feeds the message back to itself), bounded to the
        //     last HISTORY_TURN_LIMIT. spicyMode/style/bindings from getMe; owner-scoped prior run.
        const existing = await deps.dicta.listByColloquium(colloquiumId)
        const history = toHistory(existing.filter((d) => d.turnKey !== turnKey).slice(-HISTORY_TURN_LIMIT))

        const me = await deps.api.getMe(auctor)
        const bindings = Object.fromEntries((me.bindings ?? []).map((b) => [b.verb, b.modusId]))

        let priorRun: Run | undefined
        const priorRunId = typeof req.body?.priorRunId === 'string' ? req.body.priorRunId : undefined
        if (priorRunId) {
          // Owner-scoped: getRun throws a 404 ApiError if the run is not the caller's.
          priorRun = await deps.api.getRun(auctor, priorRunId)
        }

        const ctx: ConciergeContext = {
          auctor,
          spicyMode: me.generatio?.spicyMode === true,
          ...(me.generatio !== undefined ? { generatio: me.generatio } : {}),
          bindings,
          history,
          ...(priorRun !== undefined ? { priorRun } : {}),
        }

        // (e) Persist the USER Dictum (tagged with the turn key). Skipped if a prior failed attempt
        //     of this same turn already recorded it (no duplicate user turns on retry).
        if (!priorUser) {
          await deps.dicta.create({ colloquiumId, genus: 'user', corpus: message, signaIds: [], turnKey })
        }

        // (g) Run the read-only ConciergeAgent (noema-094). invariant (4): the SAME loop, whose tool
        //     surface can never emit a spend tool. No createRun/GO is invoked here.
        const agentDeps: ConciergeDeps = {
          runToolChat: deps.agent.runToolChat,
          toolClient: deps.agent.toolClient,
          api: deps.api,
          ...(deps.agent.model !== undefined ? { model: deps.agent.model } : {}),
        }
        const result: ConciergeResult = await runTurn(agentDeps, ctx, message)

        // (h) Persist the AGENT Dictum (tagged with the turn key) — the ATOMIC per-turn CHARGE GATE.
        //     A unique partial index on (colloquiumId, turnKey) over AGENT dicta makes this insert the
        //     single point at which a turn commits to being charged (the settle/debit below runs ONLY
        //     if it succeeds). If a concurrent POST with the SAME turnKey — a client-timeout retry
        //     racing the still-in-flight original — already persisted the agent Dictum, THIS insert
        //     throws E11000: we must NOT settle/debit a second time (invariant (1)).
        let agentDictum: Dictum
        try {
          agentDictum = await deps.dicta.create({
            colloquiumId,
            genus: 'agent',
            corpus: dictumCorpus(result),
            signaIds: [],
            turnKey,
          })
        } catch (err) {
          if (!isDuplicateTurnClaim(err)) throw err
          // A concurrent turn won the charge gate. Release our still-live reservation so no funds are
          // stranded (the Bursa rail has debited nothing yet at this point) and return the winner's
          // turn rather than charging twice.
          if (reservationSignaIds && !settled) await deps.signorum.release(reservationSignaIds)
          const raced = await deps.dicta.findByTurnKey(colloquiumId, turnKey)
          const winner = raced.find((d) => d.genus === 'agent')
          if (winner) {
            res.status(200).json({ dictum: serializeDictum(winner), idempotentReplay: true })
          } else {
            // Winner's agent Dictum not yet visible (mid-commit) — signal an idempotent retry rather
            // than charge. A subsequent POST with the same turnKey lands on the replay path above.
            fail(res, 409, 'turn.in_progress', 'A concurrent turn with this turnKey is being charged; retry the idempotent POST')
          }
          return
        }

        // (i) Settle at the EXACT OpenRouter chat cost for the summed token usage.
        const actual = chatImpetus(result.tokenUsage.totalTokens, OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens)
        let charged = 0n
        let signaIds: string[] = []
        if (by && reservationSignaIds) {
          // EXACT-cost: settle the actual against the locked cap (clamped to the cap — the reserved
          // ceiling is never exceeded); the ledger refunds the unused delta back to the caller.
          const settleAmount = actual > cap ? cap : actual
          await deps.signorum.settle(reservationSignaIds, settleAmount, actumRef)
          settled = true
          charged = settleAmount
          signaIds = reservationSignaIds
          // Stamp the settle's signa onto the agent Dictum (Decision Q1 / step 4i).
          const updated = await deps.dicta.update(agentDictum.id, { signaIds })
          agentDictum.signaIds = updated.signaIds
        } else {
          // Bursa FLAT-CAP: debit the whole cap. No refund; signaIds stays EMPTY (bursa yields no
          // signum by design). debit throws if the purse can't cover — caught below.
          const bursaToken = (auctor as { bursaToken: string }).bursaToken
          await deps.bursarium.debit(bursaToken, cap)
          settled = true
          charged = cap
        }

        res.status(200).json({
          dictum: serializeDictum(agentDictum),
          result,
          charged: charged.toString(),
        })
      } catch (err) {
        // Any failure before settle succeeded → release the Signorum lock so funds are never
        // stranded (the Bursa rail has debited nothing yet at this point). invariant (3).
        if (reservationSignaIds && !settled) await deps.signorum.release(reservationSignaIds)
        throw err
      }
    }),
  )

  return router
}
