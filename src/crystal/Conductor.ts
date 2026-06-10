// =============================================================================
// CONDUCTOR — the studio-lifecycle ring anchor (ADR-0006)
// =============================================================================
//
// "conductor" = the Roman lessee/contractor; `conducere` = "to lease + bring
// together." Opening a **studio** — a warm, owner-hosted, billed compute session
// — composes four crystal nouns that already exist in the ring:
//
//   the live pod        → `Materia`              (procured by the `Procurator`)
//   host attribution    → `Hospitium`            (hostKey = the auctor)
//   the billed session  → `Modo` + budget tessera (opened by the `TesseraCursor`)
//   the spend meter     → the `Census` tick      (drain-terminates on exhaustion)
//
// Before ADR-0006 each caller re-orchestrated that sequence (the Telegram bulletin
// assembled it inline; the API would have re-assembled it) — the exact per-caller
// drift `dispatchInceptio` was extracted to kill for the run path. `Conductor`
// gives the studio lifecycle ONE named door both adapters call.
//
//   Praefectus PICKS the pod (scheduler);  Conductor LEASES + assembles the studio.
//
// A studio IS a `Modo` (a session bound to a `Materia` + `Hospitium`) — per
// crystal-first (ADR-0001) we add no `Studio`/`Officina` type. The studio's
// public id is therefore `modo.id` — the same handle `POST /v1/runs { studioId }`
// targets via `Inceptio.modoId`.
//
// The `maxImpetus` watchdog falls out for free: `conducere` opens with
// `budget = maxImpetus` on the tessera, and `Census` already drain-terminates a
// session when the balance can't cover the tick. No new subsystem.
// =============================================================================

import type { AuctorKey } from '../flow/types.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { Modo, ModoStore } from '../types/modo.js'
import type { HospitiumStore, HostKey } from '../types/hospitium.js'
import type { Signum } from '../types/significandi.js'
import type { Procurator, StudioStageCb, StudioProvision } from './Procurator.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:conductor')

/** Opens a `Modo` session + its budget tessera — the `TesseraCursor` role. */
export interface ModoOpener {
  openModo(
    budget: bigint,
    auctorKey: AuctorKey,
    idleWarmthSec?: number,
  ): Promise<{ modo: Modo; tessera: Signum }>
}

/** What `conducere` leases: the bound session + its pod, plus provision telemetry. */
export interface StudioHandle {
  /** The studio's public id — `modo.id`. This is what `POST /v1/runs { studioId }`
   *  targets (→ `Inceptio.modoId`). */
  studioId: string
  modo: Modo
  materia: Materia
  /** The budget tessera bound to the session (present on `conducere`, not on `find`). */
  tessera?: Signum
  /** Provision telemetry (present only on a fresh `conducere`). */
  provision?: StudioProvision
}

/** What an agent/adapter asks for when leasing a studio. */
export interface ConduceOpts {
  /** Models (intellaId) to install live onto the parked pod. */
  models?: string[]
  /** The session budget (impetus) — `maxImpetus`. The tessera drives the Census watchdog. */
  budget: bigint
  /** How long to hold the pod warm (ms). Also sets the Modo idle window. */
  warmMs?: number
  /** The on-pod runtime (ComfyUI / llama.cpp / …) stamped on the Materia. */
  runtime?: string
  /** Group chat the studio was provisioned in — threaded to `Hospitium`/`pod.parked`
   *  for the group-admin late-binding the adapter completes. Omitted for DMs/API. */
  groupChatId?: string
}

export interface ConductorDeps {
  /** Procures + parks the warm `Materia` (+ Hospitium). Provider-named impls live under it. */
  procurator: Procurator
  /** Opens the `Modo` session + budget tessera (the `TesseraCursor`). */
  opener: ModoOpener
  materiae: MateriaStore
  modos: ModoStore
  hospitia: HospitiumStore
  /** Optional: install models live onto the parked pod (the `InstallCoordinator` seam). */
  installLive?: (materia: Materia, intellaIds: string[]) => Promise<unknown>
  /** Optional: tear a pod down on `claudere` (defaults to a no-op if absent). */
  terminate?: (podId: string) => Promise<void>
}

/**
 * Conductor — lease + assemble (and later release) a studio for an AuctorKey.
 */
export class Conductor {
  constructor(private readonly deps: ConductorDeps) {}

  /**
   * Lease a studio for `auctor`: procure + park a `Materia` (Hospitium keyed by
   * the auctor — so a studio is NEVER host-less by construction), install any
   * models live, open a `Modo` session + budget tessera, and bind the session to
   * the pod. Returns the studio handle, or `null` if provisioning failed.
   */
  async conducere(
    auctor: AuctorKey,
    opts: ConduceOpts,
    onStage?: StudioStageCb,
  ): Promise<StudioHandle | null> {
    const provision = await this.deps.procurator.provisionStudio(
      {
        ...(opts.runtime ? { runtime: opts.runtime } : {}),
        ...(opts.warmMs ? { warmMs: opts.warmMs } : {}),
        provisioningContext: {
          hostKey: auctor,
          ...(opts.groupChatId ? { groupChatId: opts.groupChatId } : {}),
        },
      },
      onStage,
    )
    if (!provision) return null

    // The Procurator parked a Materia keyed by externusId = podId. (MateriaStore has
    // no find-by-externusId; findActive is the parked-pod lookup the bot path uses too.)
    const materia = (await this.deps.materiae.findActive().catch(() => []))
      .find(m => m.externusId === provision.podId)
    if (!materia) {
      log.warn('conducere: provisioned pod has no parked Materia', { podId: provision.podId })
      return null
    }

    // Install the loadout live onto the warm pod (best-effort — a failed download
    // doesn't sink the lease; the gen-admission gate retries it).
    if (opts.models?.length && this.deps.installLive) {
      await this.deps.installLive(materia, opts.models).catch(err =>
        log.warn('conducere: live model install failed', { materiaId: materia.id, error: String(err) }))
    }

    const idleWarmthSec = opts.warmMs ? Math.max(1, Math.floor(opts.warmMs / 1000)) : undefined
    const { modo, tessera } = await this.deps.opener.openModo(opts.budget, auctor, idleWarmthSec)

    // Bind the session to its pod — the `modo.materiamId` FK + warm-resting status.
    const bound = await this.deps.modos.update(modo.id, { materiamId: materia.id, status: 'idle' })

    log.info('studio leased', { studioId: bound.id, materiaId: materia.id, podId: provision.podId })
    return { studioId: bound.id, modo: bound, materia, tessera, provision }
  }

  /**
   * The auctor's live studios — join `Hospitium`(host = auctor) → `Materia` +
   * the bound `Modo`. A Hospitium with no Modo (legacy/group-hosted pod) is
   * skipped — `find` reports leased sessions, the unit `conducere` mints.
   */
  async find(auctor: AuctorKey): Promise<StudioHandle[]> {
    const [hospitia, modos] = await Promise.all([
      this.deps.hospitia.findActive().catch(() => []),
      this.deps.modos.findActive().catch(() => []),
    ])
    const mine = hospitia.filter(h => hostKeyMatches(h.hostKey, auctor))
    const modoByMateria = new Map<string, Modo>()
    for (const m of modos) if (m.materiamId) modoByMateria.set(m.materiamId, m)

    const out: StudioHandle[] = []
    for (const h of mine) {
      const modo = modoByMateria.get(h.materiaId)
      if (!modo) continue
      const materia = await this.deps.materiae.findById(h.materiaId).catch(() => null)
      // Skip studios whose pod is gone — `find` reports LIVE studios. The Materia is
      // the truth about pod liveness; a reaped pod leaves a stale-`idle` Modo behind.
      if (!materia || materia.status === 'terminated') continue
      out.push({ studioId: modo.id, modo, materia })
    }
    return out
  }

  /**
   * Release a leased studio: verify the caller hosts it, terminate the pod, and
   * mark the session + pod + hospitium closed. Returns false if the studio isn't
   * the caller's (or doesn't exist).
   */
  async claudere(studioId: string, auctor: AuctorKey): Promise<boolean> {
    const modo = await this.deps.modos.findById(studioId).catch(() => null)
    if (!modo?.materiamId) return false
    const hospitium = await this.deps.hospitia.findByMateriaId(modo.materiamId).catch(() => null)
    if (!hospitium || !hostKeyMatches(hospitium.hostKey, auctor)) return false

    const materia = await this.deps.materiae.findById(modo.materiamId).catch(() => null)
    if (materia?.externusId && this.deps.terminate) {
      await this.deps.terminate(materia.externusId).catch(err =>
        log.warn('claudere: pod terminate failed', { podId: materia.externusId, error: String(err) }))
    }
    const now = new Date()
    await Promise.all([
      this.deps.modos.update(modo.id, { status: 'terminated', terminatum: now }).catch(() => {}),
      materia ? this.deps.materiae.update(materia.id, { status: 'terminated', terminatum: now }).catch(() => {}) : Promise.resolve(),
      this.deps.hospitia.update(hospitium.materiaId, { terminatum: now }).catch(() => {}),
    ])
    log.info('studio released', { studioId, materiaId: modo.materiamId })
    return true
  }
}

function hostKeyMatches(hk: HostKey, who: AuctorKey): boolean {
  if ('animaId' in hk && 'animaId' in who) return hk.animaId === who.animaId
  if ('commitment' in hk && 'commitment' in who) return hk.commitment === who.commitment
  return false
}
