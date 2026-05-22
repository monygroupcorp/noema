import type { StageInfo } from '../../lib/bus.js'
import { Ledger } from './Ledger.js'
import type { BulletinSnapshot } from './BulletinView.js'
import {
  WARM_LADDER_MS, WARM_DEFAULT_MS, DL_SLOW_MS,
  type Audience, type JournalEntry, type LiveState,
} from './types.js'

/** Coarse phase of a pod's life — drives timer orchestration in the manager. */
export type Phase = 'hunting' | 'prep' | 'ready' | 'idle'

/**
 * PodSession — one pod's whole life as pure state: a structured journal, a Ledger,
 * the current live phase, the warm window, and the host/guests. It maps stage
 * events to journal/live transitions; it owns NO timers and does NO I/O (the
 * BulletinManager orchestrates those off `phase`). `snapshot()` feeds BulletinView.
 *
 * Multi-pod/guest is a seam: `audience` exists but only the host path is wired.
 */
export class PodSession {
  private journal: JournalEntry[] = []
  private live: LiveState | null = null
  private readonly ledger = new Ledger()
  private _phase: Phase = 'idle'
  private phaseStartMs?: number
  private podCount = 0
  private pod: { gpu?: string; rate?: number; podId?: string } = {}
  private _warmTtlMs = WARM_DEFAULT_MS
  private _confirmed = false
  private _ended = false

  constructor(readonly hostUserId: string, readonly audience: Audience = 'host') {}

  get phase(): Phase { return this._phase }
  get podId(): string | undefined { return this.pod.podId }
  get warmTtlMs(): number { return this._warmTtlMs }
  get confirmed(): boolean { return this._confirmed }
  get ended(): boolean { return this._ended }

  /** Advance the journal/live for a pod lifecycle stage. */
  onStage(stage: string, info?: StageInfo, now: number = Date.now()): void {
    if (info?.gpuType) this.pod.gpu = info.gpuType
    if (typeof info?.costPerHr === 'number') this.pod.rate = info.costPerHr
    if (info?.podId) this.pod.podId = info.podId

    if (stage === 'provisioning') {
      this.podCount += 1
      this.phaseStartMs = now
      this.live = null            // hunt is silent unless it drags (manager arms the timer)
      this._phase = 'hunting'
      return
    }
    if (stage === 'pod-locked') {
      if (this._phase === 'hunting') {
        // Cold start (or bail replacement): commit the Found line + enter prep.
        this.journal.push({ kind: 'found', gpu: this.pod.gpu, rate: this.pod.rate, ms: this._phaseMs(info, now) })
        this.phaseStartMs = now
        this.live = { kind: 'initializing' }
        this._phase = 'prep'
      } else {
        // Warm reuse of an already-known pod: no new Found line, straight to work.
        this.live = { kind: 'generating' }
        this._phase = 'ready'
      }
      return
    }
    if (stage === 'ssh-ready' || stage === 'bootstrapping') { this.live = { kind: 'initializing' }; this._phase = 'prep'; return }
    if (stage.startsWith('downloading')) {
      const slow = this.phaseStartMs !== undefined && now - this.phaseStartMs > DL_SLOW_MS
      const [n, m] = stage.startsWith('downloading:') ? stage.slice(12).split('/').map(Number) : [undefined, undefined]
      this.live = { kind: 'downloading', n, m, slow }
      this._phase = 'prep'
      return
    }
    if (stage === 'installing-nodes') { this.live = { kind: 'plugins' }; return }
    if (stage === 'restarting')       { this.live = { kind: 'reloading' }; return }
    if (stage === 'pod-bailed')       { this._bail(info); return }
    if (stage === 'comfy-ready') {
      this.journal.push({ kind: 'prepared', ms: this._phaseMs(info, now) })
      this.live = { kind: 'generating' }
      this._phase = 'ready'
      return
    }
    if (stage === 'inferring') { this.live = { kind: 'generating' }; this._phase = 'ready'; return }
    if (stage === 'uploading') { this.live = { kind: 'saving' }; return }
    // unknown stage — keep the current live line
  }

  /** Manager calls this when the hunt drags past the threshold. */
  markHuntSlow(): void {
    if (this._phase === 'hunting' && !this._ended) this.live = { kind: 'hunting-slow' }
  }

  /** Record a completed gen and return to the resting (stat-line) state. */
  recordGen(entry: { costUsd?: number; execMs?: number }): void {
    this.ledger.record(entry)
    this.live = null
    this._phase = 'idle'
  }

  /** Step the warm window along the ladder. */
  stepWarm(dir: 'inc' | 'dec'): void {
    let idx = WARM_LADDER_MS.indexOf(this._warmTtlMs)
    if (idx < 0) idx = WARM_LADDER_MS.indexOf(WARM_DEFAULT_MS)
    idx = dir === 'inc' ? Math.min(WARM_LADDER_MS.length - 1, idx + 1) : Math.max(0, idx - 1)
    this._warmTtlMs = WARM_LADDER_MS[idx]
  }
  setConfirmed(v: boolean): void { this._confirmed = v }
  end(): void { this._ended = true; this.live = null }
  clearLive(): void { this.live = null }

  snapshot(): BulletinSnapshot {
    return {
      journal: this.journal,
      live: this.live,
      ledger: this.ledger.summary(),
      warmTtlMs: this._warmTtlMs,
      confirmed: this._confirmed,
      rateUsdPerHr: this.pod.rate,
      ended: this._ended,
      audience: this.audience,
    }
  }

  private _phaseMs(info: StageInfo | undefined, now: number): number {
    return info?.phaseMs ?? (this.phaseStartMs ? now - this.phaseStartMs : 0)
  }

  /** Cut a sluggish pod loose: erase its Found entry, record a permanent Quit entry. */
  private _bail(info?: StageInfo): void {
    for (let i = this.journal.length - 1; i >= 0; i--) {
      if (this.journal[i].kind === 'found') { this.journal.splice(i, 1); break }
    }
    this.journal.push({ kind: 'quit', podNum: this.podCount, reason: info?.bailReason ?? 'download throttle' })
    this.live = null
    this.phaseStartMs = undefined
    this._phase = 'hunting'
  }
}
