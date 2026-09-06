import { EventEmitter } from 'node:events'
import type { LogEntry } from './logger.js'
import type { WideEvent } from './wide.js'
import type { Progressus } from '../types/progressus.js'

/**
 * Optional pod/runtime detail carried on the studio-provision callback (`StudioStageCb`)
 * and projected onto `Progressus.pod` for richer user-facing UX. (Was also the payload of
 * the retired `actum.stage` event, #6e.)
 */
export interface StageInfo {
  gpuType?:   string
  region?:    string
  costPerHr?: number
  /** Estimated time remaining for the current phase (e.g. model download), in ms. */
  etaMs?:     number
  /** Pod id, carried at lock-in so the UI can control the pod (warm window / destroy). */
  podId?:     string
  /** Authoritative duration (ms) of the phase that just completed (hunt at pod-locked,
   *  prep at comfy-ready). Lets the UI show a real "in 30s" / "4.5m" summary; falls
   *  back to the UI's own wall-clock when absent. */
  phaseMs?:   number
  /** Why a pod was cut loose, carried on a `pod-bailed` stage (e.g. "download throttle"). */
  bailReason?: string
}

// Typed event map — extended in Phase 2 with actum lifecycle events
export interface BusEvents {
  'log':             [entry: LogEntry]
  'actum.start':     [data: { actumId: string; modusId: string; animaId?: string }]
  /**
   * The typed, OWNED status report (Progressus) — the single status channel since the
   * stringly `actum.stage` shim was retired (#6e). Emitted by `CrystalApi.reportProgressus`
   * for every report a runner POSTs to `/runner/status`, by the in-process `recordProgressus`
   * seam (comfyrunner / cold-start), and by the dev Fake clients.
   */
  'actum.progressus': [data: { actumId: string; progressus: Progressus }]
  'actum.complete':  [wide: WideEvent]
  'actum.fail':      [wide: WideEvent]
  /** Idle reaper terminated a warm pod — lets the UI freeze its bulletin to a receipt. */
  'pod.reaped':      [data: { externusId: string }]
  /**
   * A warm pod finished a job and went back to idle — it is free NOW, before the next
   * caller happens to look for it. `imageRef` is what makes the event actionable: the
   * warm-pod line is per-image, so this says which line just gained capacity.
   */
  'pod.idle':        [data: { materiaId: string; imageRef?: string }]
  /**
   * A cold pod just parked warm: Materia + (optionally) Hospitium were just created.
   * Subscribers handle late-binding hosting metadata that depends on platform state —
   * notably, resolving the group chat's admin set into the Hospitium when groupChatId
   * is present. `platform` is the source surface (telegram/discord/api) so each
   * adapter can scope its handler to its own pods in multi-platform processes.
   */
  'pod.parked':      [data: { materiaId: string; groupChatId?: string; platform?: 'telegram' | 'discord' | 'api' }]
  /**
   * Studio billing engaged drain-only mode — the host's balance can no longer
   * cover continuous billing. New guest gens refused; in-flight allowed; idle
   * reaper terminates when the queue drains.
   */
  'studio.draining': [data: { materiaId: string }]
}

class TypedBus extends EventEmitter {
  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): boolean {
    return super.emit(event, ...args)
  }
  on<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): this {
    return super.on(event, listener)
  }
}

export const bus = new TypedBus()
