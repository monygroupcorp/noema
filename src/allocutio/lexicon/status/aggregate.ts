// =============================================================================
// Status aggregator — assembles a StatusSnapshot from existing stores.
// =============================================================================
// Pure data layer over Signorum / Hospitium / Materia / Actorum. No UI; no
// platform knowledge. The /status command (Telegram, web, API) invokes this
// then hands the result to StatusView (or serializes it as JSON).
//
// Per-user gen indexing is deliberately injected as a list of actumIds rather
// than queried from Modo: Modo carries NO identity columns by privacy invariant
// (modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima is the
// only chain to identity), so the lexicon can't enumerate "this user's gens"
// without a side-channel. Each adapter supplies its own in-flight list from
// the state it already tracks (Telegram: bulletin actumChat; API: caller's
// session). Empty list → no gens section rendered.

import type { Signorum } from '../../../types/significandi.js'
import type { HospitiumStore, HostKey } from '../../../types/hospitium.js'
import type { MateriaStore, Materia } from '../../../types/materia.js'
import type { ModoStore } from '../../../types/modo.js'
import type { Actorum } from '../../../types/cursus.js'
import type { Modorum } from '../../../types/modus.js'
import type { ActumIndexStore } from '../../../types/actumIndex.js'
import type { AuctorKey } from '../../../flow/types.js'
import { IMPETUS_USD_RATE } from '../../../ledger/rates.js'
import type { StatusSnapshot, GenEntry, StudioEntry } from './types.js'

export interface StatusAggregateDeps {
  signorum: Signorum
  hospitia: HospitiumStore
  materiae: MateriaStore
  actorum: Actorum
  modorum: Modorum
  /** Optional per-anima dispatch index. When present, the aggregator looks up
   *  the user's in-flight actums itself; the adapter-supplied list becomes
   *  unnecessary. Absent → falls back to the input's `inFlightActumIds`. */
  actumIndex?: ActumIndexStore
  /** Optional session store. When present, each studio is keyed by its bound Modo id
   *  (the canonical studio handle — what `POST /v1/runs { studioId }` targets, ADR-0006);
   *  absent → falls back to the Materia id. */
  modos?: ModoStore
  /** Optional warm-pod line. When present, a gen waiting for a pod carries the place it
   *  holds, so `/status` answers "where am I?" without the user opening the run. Absent →
   *  a queued gen reads as pending, exactly as it did before the line existed. */
  vocator?: { place(actumId: string): Promise<{ place: number; depth: number } | null> }
}

export interface StatusAggregateInput {
  /** Identity to aggregate for. `null` = anonymous user with no signed-in
   *  context; we still return zero-state so the UI can render "sign in" copy. */
  auctorKey: AuctorKey | null
  /** Adapter-supplied in-flight gen list. Used as a fallback when no
   *  `actumIndex` is on `deps`; otherwise the aggregator queries the index. */
  inFlightActumIds: string[]
  /** Optional now-clock for testability. */
  now?: () => Date
}

export async function aggregateStatus(
  deps: StatusAggregateDeps,
  input: StatusAggregateInput,
): Promise<StatusSnapshot> {
  const now = (input.now ?? (() => new Date()))()

  if (!input.auctorKey || 'bursaToken' in input.auctorKey) {
    return emptySnapshot(now)
  }

  // Resolve the in-flight actum list: prefer the index (works for both
  // identified runs and anonymous commitment runs), fall back to the
  // adapter's hint when the index isn't wired.
  let actumIds = input.inFlightActumIds
  if (deps.actumIndex) {
    const entries = await deps.actumIndex.findFor(input.auctorKey).catch(() => [])
    if (entries.length > 0) actumIds = entries.map(e => e.actumId)
  }

  // Run independent queries in parallel — they share no state.
  const [balanceImpetus, hospitia, gens] = await Promise.all([
    deps.signorum.balance(input.auctorKey),
    deps.hospitia.findActive(),
    buildGens(deps, actumIds),
  ])

  const studios = await buildStudios(deps, hospitia, input.auctorKey, now)

  return {
    auctorKey: input.auctorKey,
    balanceImpetus,
    balanceUsd: Number(balanceImpetus) * IMPETUS_USD_RATE,
    gens,
    studios,
    joinable: [],     // v1: empty — admission policy spec is a separate sprint
    takenAt: now,
  }
}

function emptySnapshot(now: Date): StatusSnapshot {
  return {
    auctorKey: null,
    balanceImpetus: 0n,
    balanceUsd: 0,
    gens: [], studios: [], joinable: [],
    takenAt: now,
  }
}

// ── gen rows ─────────────────────────────────────────────────────────────────

async function buildGens(deps: StatusAggregateDeps, actumIds: string[]): Promise<GenEntry[]> {
  if (actumIds.length === 0) return []

  const acta = await Promise.all(actumIds.map(id => deps.actorum.findById(id).catch(() => null)))
  const rows: GenEntry[] = []
  for (const a of acta) {
    if (!a) continue
    if (a.status !== 'nascens' && a.status !== 'agens') continue   // finished or failed → drop

    const modus = await deps.modorum.find(a.modusId, a.modusVersiono).catch(() => null)
    const modusLabel = modus?.nomen ?? a.modusId

    const studio = a.materiamId
      ? { id: a.materiamId, hostLabel: '@host', isOwn: false }  // hostLabel resolution lands with adapter context
      : null

    const elapsedMs = a.status === 'agens' && a.inceptum
      ? Date.now() - new Date(a.inceptum).getTime()
      : undefined

    // The place is asked for only while a gen could plausibly be in a line — a run that
    // has reached a pod is running, not waiting — and an unanswerable store leaves the
    // field absent rather than reporting a place the user does not hold.
    const queue = a.status === 'nascens'
      ? await deps.vocator?.place(a.id).catch(() => null) ?? null
      : null

    rows.push({
      actumId: a.id,
      modusLabel,
      studio,
      status: a.status,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      ...(queue ? { queue } : {}),
    })
  }
  return rows
}

// ── studio rows ──────────────────────────────────────────────────────────────

async function buildStudios(
  deps: StatusAggregateDeps,
  allHospitia: Awaited<ReturnType<HospitiumStore['findActive']>>,
  who: HostKey,
  now: Date,
): Promise<StudioEntry[]> {
  const mine = allHospitia.filter(h => hostKeyMatches(h.hostKey, who))
  if (mine.length === 0) return []

  // One history fetch covers every studio — filter client-side by contextId.
  const history = await deps.signorum.history(who).catch(() => [])

  // The studio's canonical id is its bound Modo's id (ADR-0006) when a session store
  // is wired; index live Modos by the Materia they're bound to. Absent → Materia id.
  const modoByMateria = new Map<string, string>()
  if (deps.modos) {
    for (const mo of await deps.modos.findActive().catch(() => [])) {
      if (mo.materiamId) modoByMateria.set(mo.materiamId, mo.id)
    }
  }

  const rows: StudioEntry[] = []
  for (const h of mine) {
    // Skip an in-flight studio record (opened, pod not yet parked → no `materiaId`):
    // /status is the economic view of live pods; the focused /v1/studios shows provisioning ones.
    if (!h.materiaId) continue
    const materiaId = h.materiaId
    const m = await deps.materiae.findById(materiaId).catch(() => null)
    if (!m) continue

    const label = `${m.imageRef?.split('/').pop()?.split(':')[0] ?? 'studio'} on ${shortGpu(m.gpu)}`

    const warmRemainingMs = m.warmUntil
      ? Math.max(0, new Date(m.warmUntil).getTime() - now.getTime())
      : undefined

    const status = materiaStudioStatus(m)

    // Per-studio earnings: signa from hostCut + hospitium with this materia
    // tagged in their `contextId`. costAccrued lives on Hospitium. Net is the
    // simple subtraction — bulletin renders the same number when it lands.
    const earnings = history
      .filter(s => s.contextId === materiaId &&
                   (s.auctor === 'nexus:hostCut' || s.auctor === 'nexus:hospitium'))
      .reduce((sum, s) => sum + s.valor, 0n)
    const cost = h.costAccrued ?? 0n
    const netImpetus = earnings - cost
    const netUsd = Number(netImpetus) * IMPETUS_USD_RATE

    // Guests served = count of hostCut signa for this studio (one per guest gen).
    const guestsToday = history.filter(
      s => s.contextId === materiaId && s.auctor === 'nexus:hostCut',
    ).length

    rows.push({
      // The studio's canonical id is its session (Modo) id — now carried directly on the
      // host record (ADR-0006); the modos-join is a fallback for legacy pod-keyed records.
      studioId: h.modoId ?? modoByMateria.get(materiaId) ?? materiaId,
      materiaId,
      label, status,
      ...(warmRemainingMs !== undefined ? { warmRemainingMs } : {}),
      guestsToday,
      netImpetus,
      netUsd,
    })
  }
  return rows
}

/**
 * Map a Materia's live state to the studio-facing status vocabulary — the single
 * source of truth shared by `/status` (here) and the `/v1/studios` projection, so
 * both surfaces report a studio's liveness identically.
 */
export function materiaStudioStatus(m: Materia): StudioEntry['status'] {
  return (
    m.status === 'terminated' ? 'terminated' :
    m.drainOnly ? 'draining' :
    m.status === 'warming' ? 'provisioning' :
    m.status === 'active' ? 'running' :
    'idle'
  )
}

function hostKeyMatches(hk: HostKey, who: AuctorKey): boolean {
  if ('animaId' in hk && 'animaId' in who) return hk.animaId === who.animaId
  if ('commitment' in hk && 'commitment' in who) return hk.commitment === who.commitment
  return false
}

function shortGpu(gpu?: string): string {
  return gpu?.replace(/^NVIDIA\s+(GeForce\s+)?/i, '').trim() ?? 'GPU'
}
