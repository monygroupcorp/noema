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
import type { Mandatum } from '../../types/mandatum.js'
import { IMPETUS_USD_RATE } from '../../ledger/rates.js'
import { classifyError } from '../../lib/classifyError.js'
import { failureStage } from '../../lib/retryVerdict.js'
import type { Run, RunOrder, RunStatus, Collection, CollectionStatus, Team, Edition, Project, SettledRun } from './types.js'

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
    const raw = actum.error ?? 'run failed'
    const stage = failureStage(raw)
    run.failure = {
      code: 'run.execution_error',
      // Classified copy, not the raw internal text. The stored `error` is an operator
      // artefact — pod ids, elapsed milliseconds, the recovery the platform was already
      // attempting — and it reads as a stack trace wherever it is surfaced. `classifyError`
      // is the same mapping the chat surfaces use, so one failure says one thing everywhere.
      message: classifyError(raw),
      // …but "not the raw text" was never a reason to say NOTHING structural. `stage` is a
      // closed enum read off the same failure-mode table that decides retryability: it names
      // WHERE the run died and carries no free text at all, so it leaks nothing and goes to
      // every caller. It is absent when the recorded cause does not identify a stage — the
      // field never guesses. (noema-390; the raw text itself is owner-only, see toRunDetail.)
      ...(stage !== undefined ? { stage } : {}),
    }
  }

  if (actum.impetus !== undefined) run.cost = actum.impetus.toString()
  if (actum.inceptum !== undefined) run.createdAt = actum.inceptum.toISOString()
  if (actum.resumeCheckpoint?.url) run.resumeCheckpoint = actum.resumeCheckpoint

  return run
}

/**
 * Project an Actum onto its OWNER-SCOPED Run detail shape — everything `toRun` exposes,
 * plus the stored effective input so an owner can read back what actually produced a run
 * and adjust it directly.
 *   aditus       echoed verbatim (no transformation, including an unresolved "shuffle"
 *                seed sentinel if that's what was stored) — present only when populated.
 *   pinnedModels the models pinned at cast time — present only when populated.
 *   modusVersion the cast-time modus version (Actum's internal `modusVersiono`), plain-named.
 *   failure.detail  the recorded internal failure text, VERBATIM — see below.
 * `toRun()` itself is unchanged by this function's existence — this is a separate,
 * structurally owner-only projection, not a flag on `toRun`.
 * Pure.
 */
export function toRunDetail(actum: Actum): Run {
  const run = toRun(actum)

  if (actum.aditus !== undefined) run.aditus = actum.aditus
  if (actum.pinnedModels !== undefined) run.pinnedModels = actum.pinnedModels
  if (actum.modusVersiono !== undefined) run.modusVersion = actum.modusVersiono

  // The raw failure text, for the one party entitled to it: the payer. It is an operator
  // artefact and stays out of `toRun` — a stranger, and every non-owner surface, still gets
  // the classified sentence and nothing else. But the owner of a run that burned twenty
  // minutes and real pod time should not have to infer a full disk from "Something went
  // wrong", and this projection is already the owner-only seam (`aditus`, `pinnedModels`),
  // reached only after `getRun`'s ownership check. Echoed verbatim, like `aditus`: no
  // truncation, because the cause is as often in the tail as the head. (noema-390)
  if (run.failure && actum.error !== undefined) {
    run.failure = { ...run.failure, detail: actum.error }
  }

  return run
}

/** Terminal `MandatumCausa` → the public `reason`, and the state that goes with it. */
const CAUSA_MAP = {
  impletum: { state: 'fulfilled', reason: 'fulfilled' },
  defectus: { state: 'stopped', reason: 'failed' },
  consumptum: { state: 'stopped', reason: 'exhausted' },
  revocatum: { state: 'cancelled', reason: 'cancelled' },
} as const

/**
 * Project a Mandatum onto its public RunOrder shape — the standing order behind a run.
 *
 * The state is DERIVED from the stored fields rather than stored twice: an order still
 * holding an attempt (`pendens`) is attempting, a live order between attempts is scheduled,
 * and a terminal one reads its reason off `causa`. That keeps the durable record minimal and
 * makes the public vocabulary something we can change without a migration.
 *
 * A terminal order reports no `nextAttemptAt` even if a stale one is stored — nothing is
 * coming, and a time in that field would say otherwise. Pure.
 */
export function toRunOrder(m: Mandatum): RunOrder {
  const terminal = m.status === 'exhaustus' || m.status === 'revocatum'
  const mapped = m.causa ? CAUSA_MAP[m.causa] : undefined
  const maxRuns = m.schedula?.maxRuns
  const out: RunOrder = {
    id: m.id,
    state: terminal
      ? (mapped?.state ?? 'stopped')
      : m.pendens ? 'attempting' : 'scheduled',
    attempts: m.ignitions,
    attemptsRemaining: terminal ? 0 : Math.max(0, (maxRuns ?? m.ignitions) - m.ignitions),
  }
  if (terminal && mapped) out.reason = mapped.reason
  if (!terminal && m.proximum !== undefined) out.nextAttemptAt = new Date(m.proximum).toISOString()
  if (m.finis !== undefined) out.until = new Date(m.finis).toISOString()
  const latest = m.acta[m.acta.length - 1]
  if (latest !== undefined) out.latestRunId = latest
  return out
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

/**
 * Project a Collectio onto its public, JSON-safe Collection shape. Pure.
 *
 * The piece counters are projected straight off the record — `completae` is
 * "generated and accepted", `pendentes` is "generated, awaiting a reviewer",
 * `fractae` is "did not generate", `reiectae` is "generated, then declined".
 * They are read from the ONE place that maintains them (the Collectio itself),
 * so what a caller polls and what the collection records cannot disagree.
 */
export function toCollection(c: Collectio): Collection {
  const out: Collection = {
    id: c.id,
    status: COLLECTION_STATUS_MAP[c.status],
    modusId: c.modusId,
    total: c.numerus,
    provenanceHash: c.provenanceHash,
    completed: c.completae,
    pendingReview: c.pendentes ?? 0,
    failed: c.fractae,
    rejected: c.reiectae ?? 0,
  }
  if (c.nomen !== undefined) out.nomen = c.nomen
  if (c.owners !== undefined) out.owners = c.owners
  if (c.tractus !== undefined) out.tractus = c.tractus
  if (c.reviewEnabled !== undefined) out.reviewEnabled = c.reviewEnabled
  if (c.pausatum !== undefined) out.paused = true
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
  // Generic, author-safe note only — the raw classifier text (`e.moderation.reason`)
  // stays admin-only (`CrystalApi.getEditionModeration`), never reaches this public
  // projection (docs/spec/moderation-reject-reason.md §3(a) privacy note).
  if (e.moderation !== undefined) out.moderationNote = 'Flagged by automated review.'
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
