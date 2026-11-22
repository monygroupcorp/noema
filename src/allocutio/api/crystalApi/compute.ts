import { randomUUID } from 'crypto'
import { bus } from '../../../lib/bus.js'
import { normalizeProgressus, shouldPersist, rollupPhaseDurations } from '../../../execution/progressus.js'
import type { Progressus } from '../../../types/progressus.js'
import type { StudioHandle, ConduceOpts } from '../../../crystal/Conductor.js'
import type { AuctorKey } from '../../../flow/types.js'
import type { Actum } from '../../../types/actum.js'
import { Errors } from '../errors.js'
import { impetusForPodMs } from '../../../ledger/rates.js'
import { isPodLockedReport } from '../../../crystal/expiryReaper.js'
import type {
  ProvisionStudioOpts, StudioView, ProvisionTeeSessionOpts, TeeSessionView, RunnerReadySignal,
  RunnerHeartbeatSignal, RunnerEndedSignal, ProgressusSignal,
} from '../CrystalApi.js'
import {
  PLATFORM_ANIMA_ID, TEE_READY_WATCHDOG_MS, toStudioView, isSettled, TeeSession, toTeeSessionView,
  _auctorMatch,
} from './support.js'
import { CrystalApiAccount } from './account.js'

/** Warm GPU pods and TEE sessions, and the signals their runners report back. */
export abstract class CrystalApiCompute extends CrystalApiAccount {
  /**
   * Lease a hosted studio for the caller (the agent twin of the bot's `/arm` Start) —
   * the `Conductor` provisions a warm pod, binds it to the caller (Hospitium), installs
   * the loadout, and opens a budgeted `Modo` session. Returns the studio handle; its
   * `studioId` is what `POST /v1/runs { studioId }` targets.
   *
   * The `maxImpetus` cap IS the session budget (the tessera): `Census` drain-terminates
   * the studio once accrued spend crosses it (the watchdog). Absent → the caller's full
   * balance is the budget. A zero budget is refused (`economy.insufficient_signa`).
   */
  async provisionStudio(auctor: AuctorKey, opts: ProvisionStudioOpts = {}): Promise<StudioView> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot provision studios')

    // Dispute freeze (noema-082, freeze-boundary v2): provisioning a studio commits the anima's
    // balance as a compute budget and boots a pod that debits it over time (studioSpendHook mints
    // negative-valor `nexus:studioSpend` signa on the caller). That is a user-initiated credit
    // outflow, so it must be blocked while the anima is frozen by a pending chargeback — otherwise a
    // disputing fraudster drains the disputed balance on GPU compute before the chargeback resolves.
    await this._assertNotDisputeFrozen(auctor)

    if (!this.deps.conductor) throw Errors.studioUnavailable()

    // A fundamentum (when given) supplies the runtime + must resolve (no opaque ids).
    let runtime = opts.runtime
    if (opts.fundamentumId) {
      const f = await this.deps.fundamentorum.find(opts.fundamentumId).catch(() => null)
      if (!f) throw Errors.notFoundFundamentum(opts.fundamentumId)
      runtime = runtime ?? f.runtime
    }

    const balance = await this.deps.signorum.balance(auctor)
    const budget = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : balance
    if (budget <= 0n) throw Errors.insufficientSigna({ available: balance.toString() })

    // ASYNC handle: returns a `provisioning` studio immediately; the pod boots in the
    // background (observe via getStudio/listStudios, or the optional webhook on ready/failed).
    const conduceOpts: ConduceOpts = {
      budget,
      ...(opts.models?.length ? { models: opts.models } : {}),
      ...(opts.warmMs !== undefined ? { warmMs: opts.warmMs } : {}),
      ...(runtime ? { runtime } : {}),
    }
    const webhookUrl = opts.webhookUrl
    const onSettled = (webhookUrl && this.deps.notify)
      ? (settled: StudioHandle | null) =>
          this.deps.notify!(webhookUrl, { studio: settled ? toStudioView(settled, budget) : { studioId: null, status: 'failed' } })
      : undefined
    const handle = await this.deps.conductor.conducereAsync(auctor, conduceOpts, onSettled)
    return toStudioView(handle, budget)
  }

  /**
   * One of the caller's studios by id — owner-scoped (a stranger gets `not_found.studio`,
   * no leak). Works for an in-flight (provisioning) studio too.
   *
   * Reading a studio asks whether it is ADDRESSABLE, not whether it is live, so ownership is
   * the only gate: a studio the caller hosts resolves in every state a `Materia` can hold,
   * terminal included, and reports that state through the shared `materiaStudioStatus`
   * projection. That keeps this read consistent with the other two surfaces that speak the
   * caller's studio ids — `/v1/me/status`, which lists a studio through the same status
   * mapping, and `DELETE /v1/studios/:id`, which returns a terminal view rather than 404.
   * Run-targeting is the liveness question and keeps the live-only predicate (`_ownedStudio`),
   * so widening the read never widens what a run may bind to.
   */
  async getStudio(auctor: AuctorKey, studioId: string): Promise<StudioView> {
    if (!this.deps.conductor) throw Errors.notFoundStudio(studioId)
    const handle = await this.deps.conductor.getStudio(studioId, auctor, { includeTerminal: true })
    if (!handle) throw Errors.notFoundStudio(studioId)
    return toStudioView(handle, await this.deps.signorum.sessionBudget(studioId).catch(() => 0n))
  }

  /** The caller's live studios (the agent twin of the bulletin's studio list). Empty when
   *  no provisioning rail is wired. Includes in-flight (provisioning) studios. */
  async listStudios(auctor: AuctorKey): Promise<StudioView[]> {
    if (!this.deps.conductor) return []
    const handles = await this.deps.conductor.find(auctor)
    return Promise.all(handles.map(async (h) =>
      toStudioView(h, await this.deps.signorum.sessionBudget(h.studioId).catch(() => 0n))))
  }

  /**
   * End a lease deliberately — the owner says "I'm done, stop the meter." Owner-scoped
   * + idempotent: wires `Conductor.claudere` (terminate pod, close session/materia/
   * hospitium — already covers cancel-in-flight too). A stranger's DELETE never leaks
   * existence (`not_found.studio`); releasing an already-terminated studio returns the
   * same terminal view, 200 (double-click safe) — `claudere`'s own guard makes this
   * safe to call twice, no second settle path invoked.
   */
  async releaseStudio(auctor: AuctorKey, studioId: string): Promise<StudioView> {
    if (!this.deps.conductor) throw Errors.notFoundStudio(studioId)
    const ok = await this.deps.conductor.claudere(studioId, auctor)
    if (!ok) throw Errors.notFoundStudio(studioId)
    const budget = await this.deps.signorum.sessionBudget(studioId).catch(() => 0n)
    return { studioId, status: 'terminated', budgetImpetus: budget.toString() }
  }

  // ── TEE private compute sessions ─────────────────────────────────────────────

  protected readonly teeSessions = new Map<string, TeeSession>()

  async provisionTeeSession(auctor: AuctorKey, opts: ProvisionTeeSessionOpts): Promise<TeeSessionView> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot provision TEE sessions')

    // Dispute freeze (noema-082, freeze-boundary v2): a TEE session commits the anima's balance as a
    // compute budget and boots a pod that debits it over time (the `tee:spend` path). Same
    // user-initiated outflow as provisionStudio — gate it while frozen so a disputed balance can't be
    // consumed on private-compute GPU time before the chargeback resolves.
    await this._assertNotDisputeFrozen(auctor)

    const balance = await this.deps.signorum.balance(auctor)
    const budget = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : balance
    if (budget <= 0n) throw Errors.insufficientSigna({ available: balance.toString() })

    const sessionId = randomUUID()
    // Per-session secret injected into the pod; the runner echoes it on every callback
    // and spoofed /runner/* posts (which can move real pod billing) are dropped.
    // Local dev (no provisioner) skips it — a manually started runner can't know it.
    const runnerToken = this.deps.teeProvisioner ? randomUUID() : undefined
    this.teeSessions.set(sessionId, {
      sessionId,
      auctor,
      status: 'provisioning',
      phase: 'provisioning',
      gpuClass: opts.gpuClass,
      budgetImpetus: budget,
      wgClientPublicKey: opts.wgClientPublicKey,
      ...(runnerToken ? { runnerToken } : {}),
      ...(opts.costPerHrUsd !== undefined ? { costPerHrUsd: opts.costPerHrUsd } : {}),
      wsProbeAttempts: 0,
      lastBilledGpuHours: 0,
      spentImpetus: 0n,
      createdAt: new Date(),
    })

    if (this.deps.teeProvisioner) {
      // Fire-and-forget: pod boot is async; session transitions to 'ready' via /runner/ready callback.
      // onPodCreated sets podId immediately after _startPod() so that when the runner/ready callback
      // arrives (while _waitForRuntime is still polling), session.podId is already set and
      // handleRunnerReady picks the correct provisioner ingress instead of the localhost fallback.
      this.deps.teeProvisioner.provision(sessionId, opts.wgClientPublicKey, (podId) => {
        const s = this.teeSessions.get(sessionId)
        if (s) s.podId = podId
      }, runnerToken).then(result => {
        const s = this.teeSessions.get(sessionId)
        if (!s) return
        if (s.status === 'ended') {
          // Session ended (user DELETE / watchdog) while the pod was still being created —
          // nothing else will ever terminate the fresh pod.
          console.warn('[tee] session ended during provision — terminating fresh pod', { sessionId, podId: result.podId })
          this.deps.teeProvisioner!.terminate(result.podId).catch(() => {})
          return
        }
        s.podId = result.podId
        if (result.costPerHrUsd !== undefined) s.costPerHrUsd = result.costPerHrUsd
      }).catch(err => {
        const s = this.teeSessions.get(sessionId)
        if (s) { s.status = 'ended'; s.phase = 'failed'; s.error = String(err) }
        console.error('[tee] pod provision failed', { sessionId, err: String(err) })
      })

      // Ready watchdog: the pod can reach 'running' and then die guest-side (IMDS miss,
      // runner crash) without ever calling /runner/ready — no heartbeat means budget
      // enforcement never engages, so the pod would bill forever. If the session is
      // still 'provisioning' at the deadline, fail it and kill the pod. Generous window:
      // covers the CVM multi-minute boot AND up to 3 RunPod WS-probe re-provisions.
      const watchdog = setTimeout(() => {
        const s = this.teeSessions.get(sessionId)
        if (!s || s.status !== 'provisioning') return
        s.status = 'ended'
        s.phase = 'failed'
        s.error = 'runner never became ready — pod terminated'
        console.error('[tee] ready watchdog fired — terminating pod', { sessionId, podId: s.podId })
        if (s.podId) {
          this.deps.teeProvisioner!.terminate(s.podId).catch(err =>
            console.warn('[tee] watchdog pod terminate failed', { sessionId, podId: s.podId, err: String(err) }))
        }
      }, TEE_READY_WATCHDOG_MS)
      watchdog.unref?.()
    }
    // Without teeProvisioner (local dev): start runner.py manually with SESSION_ID matching sessionId.

    return toTeeSessionView(this.teeSessions.get(sessionId)!)
  }

  async getTeeSession(auctor: AuctorKey, sessionId: string): Promise<TeeSessionView> {
    const session = this.teeSessions.get(sessionId)
    if (!session || !_auctorMatch(session.auctor, auctor)) throw Errors.notFoundStudio(sessionId)
    return toTeeSessionView(session)
  }

  async endTeeSession(auctor: AuctorKey, sessionId: string): Promise<void> {
    const session = this.teeSessions.get(sessionId)
    if (!session || !_auctorMatch(session.auctor, auctor)) throw Errors.notFoundStudio(sessionId)
    session.status = 'ended'
    if (session.podId && this.deps.teeProvisioner) {
      await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
        console.warn('[tee] pod terminate failed', { sessionId, podId: session.podId, err: String(err) })
      )
    }
  }

  /**
   * Proxy the pod's token-gated `/debug/wglog` over the platform (avoids CORS; the
   * per-session runner token never reaches the browser). Owner-scoped. Null when the
   * session has no reachable proxy URL yet.
   */
  async fetchTeeWglog(auctor: AuctorKey, sessionId: string, tail?: string): Promise<string | null> {
    const session = this.teeSessions.get(sessionId)
    if (!session || !_auctorMatch(session.auctor, auctor)) throw Errors.notFoundStudio(sessionId)
    if (!session.proxyUrl) return null
    const httpBase = session.proxyUrl
      .replace(/^socks5\+wss:\/\//, 'https://')
      .replace(/^socks5\+ws:\/\//, 'http://')
      .replace(/\?.*$/, '')
      .replace(/\/$/, '')
    const qs = tail ? `?tail=${encodeURIComponent(tail)}` : ''
    const res = await fetch(httpBase + '/debug/wglog' + qs, {
      ...(session.runnerToken ? { headers: { 'Authorization': `Bearer ${session.runnerToken}` } } : {}),
    })
    return res.text()
  }

  /**
   * Callbacks that can move a live pod's billing must carry the per-session token the
   * pod was provisioned with. Sessions without one (local dev) skip the check.
   *
   * Grace + ratchet (deploy-order decoupling): a runner image published before the token
   * existed never echoes it, so a tokenless callback is TOLERATED — the same exposure as
   * before the token shipped (unguessable UUID sessionId) — until the pod proves it knows
   * the token once; from then on the session is strict. A present-but-wrong token is
   * always dropped. Remove the grace path once only token-echoing tee-runner images exist.
   */
  protected _runnerTokenOk(session: TeeSession, token: string | undefined, kind: string): boolean {
    if (!session.runnerToken) return true   // local dev — no token was issued
    if (token === session.runnerToken) {
      session.runnerTokenConfirmed = true
      return true
    }
    if (token === undefined && !session.runnerTokenConfirmed) {
      console.warn('[tee] tokenless runner callback tolerated (legacy runner image — rebuild tee-runner to enforce)', { sessionId: session.sessionId, kind })
      return true
    }
    console.warn('[tee] runner callback with bad token — dropped', { sessionId: session.sessionId, kind })
    return false
  }

  async handleRunnerReady(signal: RunnerReadySignal): Promise<void> {
    console.info('[tee] runner ready', { sessionId: signal.sessionId, wgKey: signal.wgPublicKey?.slice(0, 12) })
    if (signal.wgServerLog) console.info('[tee] wg-server.log at ready:\n' + signal.wgServerLog)
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) {
      console.warn('[tee] runner ready: no session found', { sessionId: signal.sessionId })
      return
    }
    if (!this._runnerTokenOk(session, signal.runnerToken, 'ready')) return
    if (session.status === 'ended') {
      // Ready from a pod whose session already ended (user DELETE / watchdog) — don't
      // resurrect the session; make sure the live pod dies.
      console.warn('[tee] ready on an ended session — terminating pod', { sessionId: signal.sessionId, podId: session.podId })
      if (session.podId && this.deps.teeProvisioner) {
        await this.deps.teeProvisioner.terminate(session.podId).catch(() => {})
      }
      return
    }

    session.serverPublicKey = signal.wgPublicKey
    session.tunnelIp = '10.13.0.2'
    // The secure-tunnel handshake is the TEE-only `attesting` phase (spec §6b): WG key
    // exchange just landed; the WS-upgrade probe below completes it. The runner advances
    // the phase from here (loading/warming) once the browser pushes work over the tunnel.
    session.phase = 'attesting'

    if (session.podId && this.deps.teeProvisioner) {
      // SECURE RunPod pod: probe the WS upgrade path before marking the session ready.
      // Some RunPod hosts route through nginx that strips the Upgrade header — the browser
      // would get a 1006 immediately. Gate 'ready' on the probe so the browser only ever
      // sees sessions with confirmed WS connectivity.
      const wsOk = await this.deps.teeProvisioner.probeWSUpgrade(session.podId)
      if (!wsOk) {
        const badPodId = session.podId
        session.wsProbeAttempts += 1
        if (session.wsProbeAttempts >= 3) {
          console.error('[tee] WS probe failed 3 times — giving up', { sessionId: signal.sessionId })
          session.status = 'ended'
          session.phase = 'failed'
          session.error = 'no GPU with working proxy found after 3 attempts — please try again later'
          await this.deps.teeProvisioner.terminate(badPodId).catch(() => {})
          return
        }
        console.warn('[tee] WS probe failed — re-provisioning', { podId: badPodId, attempt: session.wsProbeAttempts, sessionId: signal.sessionId })
        session.podId = undefined
        await this.deps.teeProvisioner.terminate(badPodId).catch(() => {})
        // Keep session in 'provisioning' — spin a new pod transparently.
        this.deps.teeProvisioner.provision(signal.sessionId, session.wgClientPublicKey, (podId) => {
          const s = this.teeSessions.get(signal.sessionId)
          if (s) s.podId = podId
        }, session.runnerToken).then(result => {
          const s = this.teeSessions.get(signal.sessionId)
          if (!s) return
          if (s.status === 'ended') {
            console.warn('[tee] session ended during re-provision — terminating fresh pod', { sessionId: signal.sessionId, podId: result.podId })
            this.deps.teeProvisioner!.terminate(result.podId).catch(() => {})
            return
          }
          s.podId = result.podId
          if (result.costPerHrUsd !== undefined) s.costPerHrUsd = result.costPerHrUsd
        }).catch(err => {
          const s = this.teeSessions.get(signal.sessionId)
          if (s) { s.status = 'ended'; s.phase = 'failed'; s.error = String(err) }
        })
        return
      }
    }

    // Browser-facing tunnel ingress is the provisioner's to define (RunPod proxy URL /
    // owned confidential-CVM ingress); null → runner self-reports (community cloud, local dev).
    const ingress = session.podId ? this.deps.teeProvisioner?.ingress(session.podId) ?? null : null
    if (ingress) {
      session.proxyUrl = ingress.proxyUrl
      session.endpoint = ingress.endpoint
    } else {
      const host = signal.endpoint.split(':')[0]
      session.proxyUrl = `socks5+ws://${host}:8080?bind=true&gost=true`
      session.endpoint = signal.endpoint
    }

    session.status = 'ready'
  }

  async handleRunnerHeartbeat(signal: RunnerHeartbeatSignal): Promise<{ continue: boolean }> {
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) return { continue: false }
    if (!this._runnerTokenOk(session, signal.runnerToken, 'heartbeat')) return { continue: false }
    session.gpuHours = signal.gpuHours
    const { continue: ok } = await this._billTeeHours(session, signal.gpuHours)
    if (!ok) {
      session.status = 'ended'
      session.phase = 'failed'
      session.error = 'session budget exhausted'
      console.warn('[tee] budget exhausted — ending session and terminating pod', { sessionId: signal.sessionId, podId: session.podId })
      if (session.podId && this.deps.teeProvisioner) {
        await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
          console.warn('[tee] pod terminate failed on budget exhaustion', { podId: session.podId, err: String(err) })
        )
      }
    }
    return { continue: ok }
  }

  async handleRunnerEnded(signal: RunnerEndedSignal): Promise<void> {
    const session = this.teeSessions.get(signal.sessionId)
    if (!session) return
    if (!this._runnerTokenOk(session, signal.runnerToken, 'ended')) return
    // A pod we killed for a failed WS probe posts a clean 'ended' on its way down — while
    // its replacement is still provisioning. Marking the session ended here would destroy
    // the transparent retry (seen live 2026-07-03: sessions died at probe attempt 1 on
    // strip-Upgrade hosts). The replacement's ready — or the watchdog — owns the session's
    // fate; ignore the corpse's sign-off.
    if (session.status === 'provisioning' && session.wsProbeAttempts > 0 && signal.status === 'ended') {
      console.info('[tee] ignoring clean ended from a probe-killed pod — re-provision in flight', { sessionId: signal.sessionId })
      return
    }
    console.info('[tee] runner ended', { sessionId: signal.sessionId, status: signal.status, podId: session.podId })
    session.gpuHours = signal.gpuHours
    await this._billTeeHours(session, signal.gpuHours)
    session.status = 'ended'
    // Clean lifespan exit → `done`; budget-kill or crash → `failed` (spec §6b terminal).
    session.phase = signal.status === 'ended' ? 'done' : 'failed'
    if (!session.error) session.error = signal.status === 'terminated' ? 'session budget exhausted' : 'runner exited unexpectedly'
    if (session.podId && this.deps.teeProvisioner) {
      await this.deps.teeProvisioner.terminate(session.podId).catch(err =>
        console.warn('[tee] pod terminate failed on runner ended', { podId: session.podId, err: String(err) })
      )
    }
  }

  /**
   * The universal status sink (spec §4) — `POST /runner/status`. ONE channel every
   * runner speaks: it carries a Progressus AND returns `{continue}` (subsuming the
   * heartbeat). Lenient by contract — `normalizeProgressus` never throws, so an
   * off-cadence base image is never rejected.
   *
   * For a report bound to an `actumId`: append it to the Actum's persisted timeline
   * (coalesced — transitions + messages + terminals only, never per-tick progress),
   * and on a terminal report roll the timeline up into `phaseDurations`. Always emit
   * the typed `actum.progressus` bus event (the single status channel since #6e retired
   * the `actum.stage` shim). A `sessionId`-bound report (no actumId — the
   * arm Actum that owns warm-session cold-start isn't minted yet, spec §9) reflects the
   * latest phase onto the live TEE session (surfaced on `TeeSessionView.phase`) and returns
   * `continue:false` once that session has ended; full timeline persistence lands when the
   * arm Actum exists.
   */
  async reportProgressus(signal: ProgressusSignal): Promise<{ continue: boolean }> {
    const progressus = normalizeProgressus(signal.progressus ?? signal)
    const { actumId, sessionId } = signal

    const actum = actumId ? await this.deps.actorum.findById(actumId) : undefined
    if (!actum) {
      // No Actum to bind to. A `sessionId`-bound report is the TEE warm session (spec §6b):
      // the arm Actum that would own its cold-start isn't minted yet (§9), so we reflect the
      // latest phase as live session status — the browser polls it during the cold-start wait.
      // A `fractus`/ended session tells the runner to bail (replacing the heartbeat's role).
      const session = sessionId ? this.teeSessions.get(sessionId) : undefined
      if (session) {
        if (!this._runnerTokenOk(session, signal.runnerToken, 'status')) return { continue: true }
        session.phase = progressus.phase
        return { continue: session.status !== 'ended' }
      }
      return { continue: true }
    }

    await this._persistAndEmit(actum, progressus, 'pod')

    // A settled Actum tells the runner to bail — there is nothing left for it to report against.
    return { continue: !isSettled(actum) }
  }

  /**
   * In-process status recorder (spec §6a) — the seam `comfyrunnerClient` + the cold-start
   * pod clients route their typed `Progressus` through, since they live in the crystal rail
   * (constructed before this API). Persists the timeline (coalesced) + emits the typed
   * `actum.progressus` event. Wired at startup via `registerProgressusRecorder` (index.ts).
   */
  async recordProgressus(actumId: string, progressus: Progressus): Promise<void> {
    const actum = await this.deps.actorum.findById(actumId)
    if (!actum) return
    await this._persistAndEmit(actum, progressus, 'host')
  }

  /**
   * Append a Progressus to the Actum's timeline (coalesced — transitions + messages +
   * terminals only, never per-tick progress; §7), roll up `phaseDurations` on a terminal,
   * and emit the typed `actum.progressus` bus event. Shared by the HTTP sink
   * (`reportProgressus`) and the in-process recorder (`recordProgressus`).
   *
   * `source` says WHO is reporting, which the timeline itself cannot: a `pod` report arrived
   * over `POST /runner/status` (the pod speaking for itself), a `host` report was raised in this
   * process on the run's behalf. The first-heartbeat deadline is armed and disarmed off exactly
   * that distinction — see `Actum.podLockedAt` / `Actum.firstPodReportAt`.
   */
  protected async _persistAndEmit(
    actum: Actum,
    progressus: Progressus,
    source: 'pod' | 'host',
  ): Promise<void> {
    // A run that has settled is finished, and a report that arrives afterwards must not be able to
    // put it back in flight. Status posts and the completion webhook travel on separate connections,
    // so an in-flight progress frame can land after settlement; applying it would append an
    // `executing` entry past the terminal one and show a finished run as still working. Terminal
    // reports still land — they agree with the outcome and carry the phase roll-up.
    if (isSettled(actum) && progressus.phase !== 'done' && progressus.phase !== 'failed') return

    // Read-modify-write of the timeline array — safe because a runner posts SEQUENTIALLY
    // (the base-image contract is "emit, await {continue}"; comfyrunner awaits each record),
    // so reports for one Actum never race. If a runner ever fans out concurrent posts,
    // switch the append to an atomic $push.
    const last = actum.progressus?.at(-1)
    const patch: Partial<Pick<Actum,
      'progressus' | 'phaseDurations' | 'resumeCheckpoint' | 'podLockedAt' | 'firstPodReportAt'>> = {}
    if (shouldPersist(last, progressus)) {
      const timeline = [...(actum.progressus ?? []), progressus]
      patch.progressus = timeline
      if (progressus.phase === 'done' || progressus.phase === 'failed') {
        patch.phaseDurations = rollupPhaseDurations(timeline)
      }
    }
    // The rescued-checkpoint anchor is captured ALWAYS — even when the report itself is a
    // per-tick `executing` the timeline coalesces away — so the resume anchor survives a hard kill.
    if (progressus.checkpoint?.url) patch.resumeCheckpoint = progressus.checkpoint

    // ── First-heartbeat deadline: arm on the pod lock, disarm on the pod's first word ──
    // Both stamps are captured regardless of coalescing — the clock is a property of the run,
    // not of whether this particular report earned a place on the timeline.
    if (source === 'pod') {
      // The pod has spoken for itself. Recorded once, on the first post: the field's presence is
      // what takes the run out of the first-heartbeat sweep, and its value is when that happened.
      if (!actum.firstPodReportAt) patch.firstPodReportAt = progressus.at
    } else if (
      actum.firstHeartbeatDeadlineMs !== undefined &&   // only a run whose cursor armed one
      !actum.podLockedAt &&                             // first lock only — a retry never restarts the clock forward
      isPodLockedReport(progressus)
    ) {
      patch.podLockedAt = progressus.at
    }

    if (Object.keys(patch).length > 0) await this.deps.actorum.update(actum.id, patch)
    bus.emit('actum.progressus', { actumId: actum.id, progressus })
  }

  protected async _billTeeHours(session: TeeSession, currentGpuHours: number): Promise<{ continue: boolean }> {
    if (process.env.TEE_BILLING_DISABLED === 'true') return { continue: true }
    const deltaHours = currentGpuHours - session.lastBilledGpuHours
    if (deltaHours <= 0) return { continue: true }
    if (!session.costPerHrUsd) return { continue: true }   // no rate yet — provisioner hasn't set it

    const requested = impetusForPodMs(deltaHours * 3_600_000, session.costPerHrUsd)
    const remaining = session.budgetImpetus - session.spentImpetus
    const charged = requested > remaining ? remaining : requested

    if (charged > 0n) {
      const auctor = session.auctor
      const debit = 'animaId' in auctor
        ? { animaId: auctor.animaId, forma: 'integer' as const, valor: -charged, auctor: 'tee:spend', testis: session.sessionId }
        : { forma: 'arcanum' as const, valor: -charged, auctor: 'tee:spend', testis: (auctor as { commitment: string }).commitment }
      const credit = { animaId: PLATFORM_ANIMA_ID, forma: 'reward' as const, valor: charged, auctor: 'tee:spend', testis: session.sessionId }
      await this.deps.signorum.createMany([debit, credit])
      session.lastBilledGpuHours = currentGpuHours
      session.spentImpetus += charged
    }

    return { continue: charged >= requested }
  }
}
