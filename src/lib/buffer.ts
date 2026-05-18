import type { TraceContext } from './trace.js'
import type { LogEntry } from './logger.js'
import { bus } from './bus.js'

// How long before an actum is considered slow (default: 5 minutes)
const SLOW_THRESHOLD_MS = Number(process.env.SLOW_ACTUM_MS ?? 5 * 60 * 1000)

export function shouldFlush(ctx: TraceContext, status: 'completed' | 'failed'): boolean {
  if (status === 'failed') return true
  const durationMs = Date.now() - ctx.startTs
  if (durationMs > SLOW_THRESHOLD_MS) return true
  return false
}

export function flushBuffer(ctx: TraceContext, reason: string): void {
  if (ctx.buffer.length === 0) return

  // Emit a marker so the trace block is identifiable in logs
  const marker: LogEntry = {
    ts:         new Date().toISOString(),
    level:      'warn',
    component:  'tracer',
    msg:        'retroactive trace flushed',
    actumId:    ctx.actumId,
    animaId:    ctx.animaId,
    reason,
    eventCount: ctx.buffer.length,
    durationMs: Date.now() - ctx.startTs,
  }
  process.stdout.write(JSON.stringify(marker) + '\n')
  bus.emit('log', marker)

  for (const entry of ctx.buffer) {
    const retro = { ...entry, _retro: true }
    process.stdout.write(JSON.stringify(retro) + '\n')
    bus.emit('log', retro)
  }

  ctx.buffer = []  // clear after flush
}
