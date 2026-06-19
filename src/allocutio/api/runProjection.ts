// =============================================================================
// runProjection — pure Actum → Run projection
// =============================================================================
//
// Maps the internal Actum execution report onto the public, JSON-safe Run
// shape exposed by the HTTP API. Pure: no mutation, no side effects, no
// runtime dependencies.
// =============================================================================

import type { Actum, ActumStatus } from '../../types/actum.js'
import type { Collectio, CollectioStatus } from '../../types/collectio.js'
import type { Run, RunStatus, Collection, CollectionStatus } from './types.js'

/** Map the Latin ActumStatus onto the public English RunStatus. */
const STATUS_MAP: Record<ActumStatus, RunStatus> = {
  nascens: 'pending',
  agens: 'running',
  completus: 'complete',
  fractus: 'failed',
}

/**
 * Project an Actum onto its public Run shape.
 *   status   nascens→pending, agens→running, completus→complete, fractus→failed
 *   exitus   surfaced only when present
 *   failure  set only for fractus runs ({ code: 'run.execution_error', message })
 *   cost     impetus serialised via .toString()
 *   createdAt inceptum serialised via .toISOString()
 * Pure.
 */
export function toRun(actum: Actum): Run {
  const run: Run = {
    id: actum.id,
    status: STATUS_MAP[actum.status],
    modusId: actum.modusId,
  }

  if (actum.exitus !== undefined) run.exitus = actum.exitus

  if (actum.status === 'fractus') {
    run.failure = {
      code: 'run.execution_error',
      message: actum.error ?? 'run failed',
    }
  }

  if (actum.impetus !== undefined) run.cost = actum.impetus.toString()
  if (actum.inceptum !== undefined) run.createdAt = actum.inceptum.toISOString()

  return run
}

const COLLECTION_STATUS_MAP: Record<CollectioStatus, CollectionStatus> = {
  nascens: 'pending',
  agens: 'running',
  completa: 'complete',
  cancellata: 'cancelled',
}

/** Project a Collectio onto its public, JSON-safe Collection shape. Pure. */
export function toCollection(c: Collectio): Collection {
  const out: Collection = {
    id: c.id,
    status: COLLECTION_STATUS_MAP[c.status],
    modusId: c.modusId,
    total: c.numerus,
    provenanceHash: c.provenanceHash,
    completed: c.completae,
    failed: c.fractae,
  }
  if (c.nomen !== undefined) out.nomen = c.nomen
  if (c.impetusTotal !== undefined) out.cost = c.impetusTotal.toString()
  if (c.natum !== undefined) out.createdAt = c.natum.toISOString()
  if (c.completum !== undefined) out.completedAt = c.completum.toISOString()
  return out
}
