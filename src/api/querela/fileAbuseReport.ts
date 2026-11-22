// =============================================================================
// fileAbuseReport — the one abuse-report write path, however the reporter tapped
// =============================================================================
//
// `abuse` is the reporting mechanism licence terms such as MiniMax H3's require (Section
// V.5): anyone who sees a run's output can report it, naming the run; who OWNS it and which
// terms its flow carried are resolved HERE from the run itself, never taken from the reporter.
// Shared by `POST /v1/reports` (web, free-text description) and a chat surface's own Report tap
// on a delivered result (Telegram's delivery-menu wrench row, no text entry) — one dedup/rate
// limit/record shape regardless of which surface the tap came from.
// =============================================================================

import { createHash } from 'node:crypto'
import type { QuerelaStore } from '../../types/Querela.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'

export interface AbuseReportDeps {
  querelae: QuerelaStore
  /** The owner key of a run, and the licence terms its flow carries; null for no such run.
   *  Absent → abuse reports are refused, since none could name whom they are about. */
  resolveRun?: (runId: string) => Promise<{ ownerKey: string; useTerms: string[] } | null>
}

// Per-owner rate limit (Decision record Q3): anon DB spam is possible even with no public
// egress. A generous window — this guards against abuse, not normal use.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

function computeContentHash(ownerKey: string, hashInput: string): string {
  return createHash('sha256').update(`${ownerKey}\0abuse\0\0${hashInput}`).digest('hex')
}

/**
 * File an abuse report naming `args.runId`, owned (filed) by `ownerKey`. Dedups on
 * (ownerKey, runId) alone — not the description text — so one reporter repeating themselves,
 * worded however, files one report (Q3): a textless tap from a chat surface dedups exactly
 * like a worded one from the web.
 */
export async function fileAbuseReport(
  deps: AbuseReportDeps,
  ownerKey: string,
  args: { runId: string; description: string; route?: string },
): Promise<{ id: string }> {
  const runId = args.runId.trim()
  if (!runId) throw Errors.inputMalformed('an abuse report names the run it is about')
  if (!deps.resolveRun) throw Errors.internal('abuse reports are not available on this deployment')
  const run = await deps.resolveRun(runId)
  if (!run) throw Errors.notFoundRun(runId)

  const description = args.description.trim()
  if (!description) throw Errors.inputMalformed('description is required')

  const contentHash = computeContentHash(ownerKey, runId)
  const existing = await deps.querelae.findByOwnerAndHash(ownerKey, contentHash)
  if (existing) return { id: existing.id }

  const recent = await deps.querelae.findByOwner(ownerKey)
  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS
  const recentCount = recent.filter(q => q.natum.getTime() >= windowStart).length
  if (recentCount >= RATE_LIMIT_MAX) {
    throw new ApiError('rate.limited', 'Too many reports — please try again later', 429, { retryable: true, retryAfter: RATE_LIMIT_WINDOW_MS / 1000 })
  }

  const created = await deps.querelae.create({
    ownerKey,
    kind: 'abuse',
    status: 'new',
    description,
    feature: null,
    capturedState: { runId, ...(args.route ? { route: args.route } : {}) },
    clientError: null,
    device: null,
    userAgent: null,
    contentHash,
    subjectOwnerKey: run.ownerKey,
    useTerms: run.useTerms,
    verdict: null,
  })
  return { id: created.id }
}
