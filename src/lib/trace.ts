import { AsyncLocalStorage } from 'node:async_hooks'
import type { LogEntry } from './logger.js'

export interface TraceContext {
  // Identity — flows into every log line automatically. animaId and commitment
  // are the two sides of the AuctorKey union: identified vs anonymous-arcanum.
  // At most one is set per dispatch.
  actumId?:      string
  animaId?:      string
  commitment?:   string
  platform?:     'telegram' | 'discord' | 'api'

  /**
   * Group-chat identifier when the dispatch originated in a group (e.g. a Telegram
   * group/supergroup chat id). Absent for DMs. Carried in the trace so warm-park
   * can stamp Materia.groupChatId without putting platform context on the durable
   * schemas (Actum/Modo stay platform-neutral).
   */
  groupChatId?:  string

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
