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
import type { Actorum } from '../../../types/cursus.js'
import type { Modorum } from '../../../types/modus.js'
import type { AuctorKey } from '../../../flow/types.js'
import { IMPETUS_USD_RATE } from '../../../ledger/rates.js'
import type { StatusSnapshot, GenEntry, StudioEntry } from './types.js'

export interface StatusAggregateDeps {
  signorum: Signorum
  hospitia: HospitiumStore
  materiae: MateriaStore
  actorum: Actorum
  modorum: Modorum
}

export interface StatusAggregateInput {
  /** Identity to aggregate for. `null` = anonymous user with no signed-in
   *  context; we still return zero-state so the UI can render "sign in" copy. */
  auctorKey: AuctorKey | null
  /** Adapter-supplied in-flight gen list — see file header. */
  inFlightActumIds: string[]
  /** Optional now-clock for testability. */
  now?: () => Date
}

export async function aggregateStatus(
  deps: StatusAggregateDeps,
  input: StatusAggregateInput,
): Promise<StatusSnapshot> {
  const now = (input.now ?? (() => new Date()))()

  if (!input.auctorKey) {
    return emptySnapshot(now)
  }

  // Run independent queries in parallel — they share no state.
  const [balanceImpetus, hospitia, gens] = await Promise.all([
    deps.signorum.balance(input.auctorKey),
    deps.hospitia.findActive(),
    buildGens(deps, input.inFlightActumIds),
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

    rows.push({
      actumId: a.id,
      modusLabel,
      studio,
      status: a.status,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    })
  }
  return rows
}

// ── studio rows ──────────────────────────────────────────────────────────────

async function buildStudios(
  deps: StatusAggregateDeps,
  allHospitia: Awaited<ReturnType<HospitiumStore['findActive']>>,
  who: AuctorKey,
  now: Date,
): Promise<StudioEntry[]> {
  const mine = allHospitia.filter(h => hostKeyMatches(h.hostKey, who))
  if (mine.length === 0) return []

  const rows: StudioEntry[] = []
  for (const h of mine) {
    const m = await deps.materiae.findById(h.materiaId).catch(() => null)
    if (!m) continue

    const label = `${m.imageRef?.split('/').pop()?.split(':')[0] ?? 'studio'} on ${shortGpu(m.gpu)}`

    const warmRemainingMs = m.warmUntil
      ? Math.max(0, new Date(m.warmUntil).getTime() - now.getTime())
      : undefined

    const status: StudioEntry['status'] =
      m.status === 'terminated' ? 'terminated' :
      m.drainOnly ? 'draining' :
      m.status === 'warming' ? 'provisioning' :
      m.status === 'active' ? 'running' :
      'idle'

    // Net = earnings (signa with hostCut/hospitium auctor on this host) - costAccrued.
    // For v1, earnings are aggregated across ALL of this host's studios — per-studio
    // attribution would require materiaId on the signa (a Phase D refinement). We
    // surface a rough "this studio's net" by attributing nothing here and showing
    // only costAccrued; bulletin gets the rich earnings view later.
    const cost = h.costAccrued ?? 0n
    const netImpetus = -cost   // negative until per-studio earnings attribution lands
    const netUsd = Number(netImpetus) * IMPETUS_USD_RATE

    rows.push({
      studioId: h.materiaId,
      label, status,
      ...(warmRemainingMs !== undefined ? { warmRemainingMs } : {}),
      guestsToday: 0,     // v1: not attributed per-studio yet
      netImpetus,
      netUsd,
    })
  }
  return rows
}

function hostKeyMatches(hk: HostKey, who: AuctorKey): boolean {
  if ('animaId' in hk && 'animaId' in who) return hk.animaId === who.animaId
  if ('commitment' in hk && 'commitment' in who) return hk.commitment === who.commitment
  return false
}

function shortGpu(gpu?: string): string {
  return gpu?.replace(/^NVIDIA\s+(GeForce\s+)?/i, '').trim() ?? 'GPU'
}
