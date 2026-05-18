import { AsyncLocalStorage } from 'node:async_hooks'
import type { LogEntry } from './logger.js'

export interface TraceContext {
  // Identity — flows into every log line automatically
  actumId?:      string
  animaId?:      string
  platform?:     'telegram' | 'discord' | 'api'

  // Timing — each stage stamps itself here; used for wide event in Phase 2
  startTs:       number
  provisionMs?:  number
  sshReadyMs?:   number
  jobSubmitMs?:  number
  webhookMs?:    number

  // Debug mode
  liveTrace:     boolean      // true = emit debug events live to stdout
  buffer:        LogEntry[]   // always accumulates; flushed on failure (Phase 2)

  // Wide event accumulation (Phase 2) — sub-components write here
  wideFields:    Record<string, unknown>
}

const store = new AsyncLocalStorage<TraceContext>()

export function withTrace<T>(ctx: TraceContext, fn: () => T): T {
  return store.run(ctx, fn)
}

export function getTrace(): TraceContext | undefined {
  return store.getStore()
}

export function makeTraceContext(partial: Partial<TraceContext> = {}): TraceContext {
  return {
    startTs:   Date.now(),
    liveTrace: false,
    buffer:    [],
    wideFields: {},
    ...partial,
  }
}
