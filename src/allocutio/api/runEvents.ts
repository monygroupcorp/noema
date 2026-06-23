// =============================================================================
// runEvents — bus event → RunEvent projection (pure)
// =============================================================================

import type { Progressus } from '../../types/progressus.js'

export interface RunEvent {
  runId: string
  kind: 'progress' | 'complete' | 'failed'
  terminal: boolean
  /** The owned typed status report (#6c). Carried on `kind: 'progress'`. */
  progressus?: Progressus
  status?: 'complete' | 'failed'
  costUsd?: number
  executionMs?: number
}

/**
 * Map a bus event name + payload onto a `RunEvent`, or return `null` for
 * events that don't belong to the run-observation surface.
 */
export function busToRunEvent(event: string, payload: any): RunEvent | null {
  // Defensive: a malformed event with no actumId can't be keyed per-run — drop it.
  if (!payload || typeof payload.actumId !== 'string') return null

  // #6c — the owned typed status report (the single live-status channel since #6e
  // retired the stringly `actum.stage` frames). A frontend reads `progressus.phase` +
  // `progressus.progress` directly. Never terminal — cost + completion ride the
  // actum.complete/fail events below.
  if (event === 'actum.progressus') {
    if (!payload.progressus || typeof payload.progressus !== 'object') return null
    return {
      runId: payload.actumId,
      kind: 'progress',
      terminal: false,
      progressus: payload.progressus as Progressus,
    }
  }

  if (event === 'actum.complete') {
    const ev: RunEvent = {
      runId: payload.actumId,
      kind: 'complete',
      terminal: true,
      status: 'complete',
    }
    if (payload.costUsd !== undefined) ev.costUsd = payload.costUsd
    if (payload.executionMs !== undefined) ev.executionMs = payload.executionMs
    return ev
  }

  if (event === 'actum.fail') {
    const ev: RunEvent = {
      runId: payload.actumId,
      kind: 'failed',
      terminal: true,
      status: 'failed',
    }
    return ev
  }

  return null
}
