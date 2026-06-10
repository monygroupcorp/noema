// =============================================================================
// runEvents — bus event → RunEvent projection (pure)
// =============================================================================

export interface RunEvent {
  runId: string
  kind: 'stage' | 'complete' | 'failed'
  terminal: boolean
  stage?: string
  elapsedMs?: number
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

  if (event === 'actum.stage') {
    const ev: RunEvent = {
      runId: payload.actumId,
      kind: 'stage',
      terminal: false,
      stage: payload.stage,
      elapsedMs: payload.elapsedMs,
    }
    return ev
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
