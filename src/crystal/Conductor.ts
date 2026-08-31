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
  /** The bound pod — absent while the studio is still provisioning (async path). */
  materia?: Materia
  /** The budget tessera bound to the session (present on `conducere`, not on `find`). */
  tessera?: Signum
  /** Provision telemetry (present only on a fresh, completed `conducere`). */
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
   * Lease a studio for `auctor`, SYNCHRONOUSLY (the bot `/arm` path — streams stages
   * via `onStage` and returns once the pod is warm). Opens the session + host record,
   * provisions + binds the pod. Returns the studio handle, or `null` on failure.
   */
  async conducere(
    auctor: AuctorKey,
    opts: ConduceOpts,
    onStage?: StudioStageCb,
  ): Promise<StudioHandle | null> {
    if ('bursaToken' in auctor) throw new Error('Bursa tokens cannot provision studios')
    const { modo, tessera } = await this._open(auctor as HostKey, opts)
    const res = await this._provisionBind(modo, opts, onStage)
    if (!res) { await this._fail(modo.id); return null }
    return { studioId: modo.id, modo: res.modo, materia: res.materia, tessera, provision: res.provision }
  }

  /**
   * Lease a studio ASYNCHRONOUSLY (the API path): open the session + host record and
   * return the handle IMMEDIATELY (status `claiming`), then provision the pod in the
   * background — the caller observes the `claiming → warming → idle` (or `terminated`)
   * transitions via `find`/`getStudio`. The host record is keyed by `modoId` from the
   * start, so an in-flight studio is owner-scoped before its pod parks.
   */
  async conducereAsync(
    auctor: AuctorKey,
    opts: ConduceOpts,
    onSettled?: (handle: StudioHandle | null) => void,
  ): Promise<StudioHandle> {
    if ('bursaToken' in auctor) throw new Error('Bursa tokens cannot provision studios')
    const { modo, tessera } = await this._open(auctor as HostKey, opts)
    // Fire-and-forget the boot; status lives on the Modo. (Single-instance: a server
    // restart mid-provision orphans a `warming` Modo — recovery sweep is a follow-up.)
    // `onSettled` fires on the terminal state (bound or failed) — the webhook seam.
    void (async () => {
      await this.deps.modos.update(modo.id, { status: 'warming' }).catch(() => {})
      const res = await this._provisionBind(modo, opts).catch(() => null)
      if (!res) { await this._fail(modo.id); onSettled?.(null); return }
      onSettled?.({ studioId: modo.id, modo: res.modo, materia: res.materia, tessera, provision: res.provision })
    })()
    return { studioId: modo.id, modo, tessera }
  }

  /** Open the session (Modo `claiming` + budget tessera) and its host record
   *  (`Hospitium` keyed by `modoId` + `auctor`, pod attached later). */
  private async _open(auctor: HostKey, opts: ConduceOpts): Promise<{ modo: Modo; tessera: Signum }> {
    const idleWarmthSec = opts.warmMs ? Math.max(1, Math.floor(opts.warmMs / 1000)) : undefined
    const { modo, tessera } = await this.deps.opener.openModo(opts.budget, auctor, idleWarmthSec)
    await this.deps.hospitia.create({ modoId: modo.id, hostKey: auctor, inceptum: new Date() })
      .catch(err => log.warn('conducere: host record create failed', { studioId: modo.id, error: String(err) }))
    return { modo, tessera }
  }

  /** Procure + park the pod, install the loadout, and bind it to the session + host
   *  record. The Procurator is NOT given a hostKey — the Conductor owns the studio's
   *  Hospitium (created in `_open`), so the pod-client must not pair a second one. */
  private async _provisionBind(
    modo: Modo,
    opts: ConduceOpts,
    onStage?: StudioStageCb,
  ): Promise<{ modo: Modo; materia: Materia; provision: StudioProvision } | null> {
    const provCtx = opts.groupChatId ? { groupChatId: opts.groupChatId } : undefined
    const provision = await this.deps.procurator.provisionStudio(
      {
        ...(opts.runtime ? { runtime: opts.runtime } : {}),
        ...(opts.warmMs ? { warmMs: opts.warmMs } : {}),
        ...(provCtx ? { provisioningContext: provCtx } : {}),
      },
      onStage,
    )
    if (!provision) return null

    const materia = (await this.deps.materiae.findActive().catch(() => []))
      .find(m => m.externusId === provision.podId)
    if (!materia) {
      log.warn('conducere: provisioned pod has no parked Materia', { podId: provision.podId })
      return null
    }

    // Install the loadout live (best-effort — a failed download doesn't sink the lease).
    if (opts.models?.length && this.deps.installLive) {
      await this.deps.installLive(materia, opts.models).catch(err =>
        log.warn('conducere: live model install failed', { materiaId: materia.id, error: String(err) }))
    }

    // Attach the pod to the host record + bind the session, warm + resting.
    await this.deps.hospitia.bindMateria(modo.id, materia.id)
      .catch(err => log.warn('conducere: bindMateria failed', { studioId: modo.id, error: String(err) }))
    const bound = await this.deps.modos.update(modo.id, { materiamId: materia.id, status: 'idle' })
    log.info('studio leased', { studioId: modo.id, materiaId: materia.id, podId: provision.podId })
    return { modo: bound, materia, provision }
  }

  /** Close a studio whose provisioning failed — the session ends; the (pod-less)
   *  host record is harmless (no `materiaId` → never billed, never listed). */
  private async _fail(studioId: string): Promise<void> {
    await this.deps.modos.update(studioId, { status: 'terminated', terminatum: new Date() }).catch(() => {})
    log.warn('studio provisioning failed', { studioId })
  }

  /**
   * The auctor's live studios — their `Hospitium`(host) records joined to the bound
   * `Modo`. Includes in-flight (provisioning, pod-less) studios; excludes terminated
   * sessions and reaped pods. Gen-warm pod records (no `modoId`) are not studios.
   */
  async find(auctor: AuctorKey): Promise<StudioHandle[]> {
    const mine = (await this.deps.hospitia.findActive().catch(() => []))
      .filter(h => h.modoId && hostKeyMatches(h.hostKey, auctor))
    const out: StudioHandle[] = []
    for (const h of mine) {
      const handle = await this._handleFor(h.modoId!, h.materiaId)
      if (handle) out.push(handle)
    }
    return out
  }

  /**
   * One studio, owner-scoped by its session id.
   *
   * TWO QUESTIONS, ONE OWNER GATE. "Is this studio mine?" and "is it still live?" are
   * separate; the caller says which it is asking:
   *
   *   - default (`includeTerminal` absent/false) — LIVENESS: a terminal studio resolves
   *     to `null`, so a run cannot be bound to a closed session or a reaped pod. This is
   *     what run-targeting (`POST /v1/runs { studioId }`) asks.
   *   - `{ includeTerminal: true }` — ADDRESSABILITY: the studio resolves in any state and
   *     reports that state through the shared `materiaStudioStatus` projection. This is what
   *     `GET /v1/studios/:id` asks, so an id the owner is shown elsewhere (`/v1/me/status`,
   *     and the terminal view `DELETE /v1/studios/:id` returns) is one they can read back.
   *
   * The ownership gate is the same either way and is the ONLY thing that hides a studio from
   * a caller: an unknown session id and another host's studio both return `null` — which the
   * API renders as `not_found.studio`, never `forbidden` — so a stranger cannot tell the two
   * apart and session ids stay non-enumerable.
   */
  async getStudio(
    studioId: string,
    auctor: AuctorKey,
    opts: { includeTerminal?: boolean } = {},
  ): Promise<StudioHandle | null> {
    const h = await this.deps.hospitia.findByModoId(studioId).catch(() => null)
    if (!h || !hostKeyMatches(h.hostKey, auctor)) return null
    return this._handleFor(studioId, h.materiaId, opts)
  }

  /** Build a studio handle from a session id + its (maybe-absent) pod. Returns null when the
   *  session never existed, and — unless `includeTerminal` — when the session is terminated
   *  or its pod was reaped. */
  private async _handleFor(
    modoId: string,
    materiaId?: string,
    opts: { includeTerminal?: boolean } = {},
  ): Promise<StudioHandle | null> {
    const modo = await this.deps.modos.findById(modoId).catch(() => null)
    if (!modo) return null
    const materia = materiaId ? await this.deps.materiae.findById(materiaId).catch(() => null) : null
    if (!opts.includeTerminal) {
      if (modo.status === 'terminated') return null
      if (materia && materia.status === 'terminated') return null
    }
    return { studioId: modo.id, modo, ...(materia ? { materia } : {}) }
  }

  /**
   * Release a studio (owner-scoped by its session id) — terminate the pod and mark
   * the session + pod + host record closed. Works for an in-flight studio too (cancel).
   * Returns false if the studio isn't the caller's.
   */
  async claudere(studioId: string, auctor: AuctorKey): Promise<boolean> {
    const hospitium = await this.deps.hospitia.findByModoId(studioId).catch(() => null)
    if (!hospitium || !hostKeyMatches(hospitium.hostKey, auctor)) return false

    const materia = hospitium.materiaId
      ? await this.deps.materiae.findById(hospitium.materiaId).catch(() => null)
      : null
    if (materia?.externusId && this.deps.terminate) {
      await this.deps.terminate(materia.externusId).catch(err =>
        log.warn('claudere: pod terminate failed', { podId: materia.externusId, error: String(err) }))
    }
    const now = new Date()
    await Promise.all([
      this.deps.modos.update(studioId, { status: 'terminated', terminatum: now }).catch(() => {}),
      materia ? this.deps.materiae.update(materia.id, { status: 'terminated', terminatum: now }).catch(() => {}) : Promise.resolve(),
      hospitium.materiaId ? this.deps.hospitia.update(hospitium.materiaId, { terminatum: now }).catch(() => {}) : Promise.resolve(),
    ])
    log.info('studio released', { studioId })
    return true
  }
}

function hostKeyMatches(hk: HostKey, who: AuctorKey): boolean {
  if ('animaId' in hk && 'animaId' in who) return hk.animaId === who.animaId
  if ('commitment' in hk && 'commitment' in who) return hk.commitment === who.commitment
  return false
}
