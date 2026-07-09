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
import type { Editio } from '../../types/editio.js'
import type { Sodalitas } from '../../types/sodalitas.js'
import type { Provincia } from '../../types/provincia.js'
import type { ActumIndex } from '../../types/actumIndex.js'
import { IMPETUS_USD_RATE } from '../../ledger/rates.js'
import type { Run, RunStatus, Collection, CollectionStatus, Team, Edition, Project, SettledRun } from './types.js'

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
  if (actum.resumeCheckpoint?.url) run.resumeCheckpoint = actum.resumeCheckpoint

  return run
}

/**
 * Project a retained-on-settle ActumIndex entry onto its public SettledRun shape.
 *   cost     the stamped impetus string (already JSON-safe)
 *   costUsd  DERIVED on read: Number(cost) × IMPETUS_USD_RATE — never persisted
 *   settledAt / createdAt  serialised to ISO-8601
 * Pure. `impetus`/`modusLabel` fall back defensively for a row stamped by an older writer.
 */
export function toSettledRun(entry: ActumIndex): SettledRun {
  const cost = entry.impetus ?? '0'
  const out: SettledRun = {
    id: entry.actumId,
    modusId: entry.modusId,
    modusLabel: entry.modusLabel ?? entry.modusId,
    status: 'settled',
    cost,
    costUsd: Number(cost) * IMPETUS_USD_RATE,
  }
  if (entry.settledAt !== undefined) out.settledAt = new Date(entry.settledAt).toISOString()
  if (entry.createdAt !== undefined) out.createdAt = new Date(entry.createdAt).toISOString()
  return out
}

const COLLECTION_STATUS_MAP: Record<CollectioStatus, CollectionStatus> = {
  draft: 'draft',
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
    rejected: c.reiectae ?? 0,
  }
  if (c.nomen !== undefined) out.nomen = c.nomen
  if (c.owners !== undefined) out.owners = c.owners
  if (c.tractus !== undefined) out.tractus = c.tractus
  if (c.reviewEnabled !== undefined) out.reviewEnabled = c.reviewEnabled
  if (c.impetusTotal !== undefined) out.cost = c.impetusTotal.toString()
  if (c.natum !== undefined) out.createdAt = c.natum.toISOString()
  if (c.completum !== undefined) out.completedAt = c.completum.toISOString()
  return out
}

/** Project an Editio onto its public, JSON-safe Edition shape. Pure. */
export function toEdition(e: Editio): Edition {
  const out: Edition = {
    id: e.id,
    artifact: { kind: e.artifactRef.kind, id: e.artifactRef.id },
    destination: e.destination,
    visibility: e.visibility,
    custody: e.custody,
    status: e.status,
    createdAt: e.natum.toISOString(),
    updatedAt: e.mutatum.toISOString(),
  }
  if (e.reviewOutcome !== undefined) out.reviewOutcome = e.reviewOutcome
  if (e.externalRef !== undefined) out.externalRef = e.externalRef
  if (e.owners !== undefined) out.owners = e.owners
  if (e.license !== undefined) out.license = e.license
  return out
}

/** Project a Sodalitas onto its public, JSON-safe Team shape. Pure. */
export function toTeam(s: Sodalitas): Team {
  return {
    id: s.id,
    nomen: s.nomen,
    members: s.membra,
    founder: s.auctor,
    createdAt: s.natum.toISOString(),
  }
}

/** Project a Provincia onto its public, JSON-safe Project shape. Pure. */
export function toProject(p: Provincia): Project {
  return {
    id: p.id,
    owner: p.animaId,
    name: p.nomen,
    ...(p.descriptio !== undefined ? { desc: p.descriptio } : {}),
    ...(p.ornatus?.glyph !== undefined ? { glyph: p.ornatus.glyph } : {}),
    ...(p.ornatus?.color !== undefined ? { color: p.ornatus.color } : {}),
    datasetIds: p.datasetIds,
    modelIds: p.modelIds,
    collectionIds: p.collectionIds,
    ...(p.sodalitasId != null ? { teamId: p.sodalitasId } : {}),
    createdAt: p.natum.toISOString(),
    updatedAt: p.mutatum.toISOString(),
  }
}
