import { bus } from './bus.js'
import type { TraceContext } from './trace.js'
import type { Actum } from '../types/actum.js'
import type { Exitus } from '../types/cursus.js'

export interface WideEvent {
  event:         'actum.complete' | 'actum.fail'
  ts:            string
  // Identity
  actumId:       string
  modusId:       string
  modusVersiono: string
  animaId?:      string
  byType:        'animaId' | 'commitment' | 'arcanumProof'
  platform?:     string
  cursorType?:   string
  // Economics
  reservation:   string   // bigint as string
  impetus:       string   // bigint as string
  refund:        string   // bigint as string
  // Timing (ms — durationMs is total wall-clock; others are per-stage, undefined if skipped)
  durationMs:    number
  provisionMs?:  number
  sshReadyMs?:   number
  jobSubmitMs?:  number
  webhookMs?:    number
  coldStart:     boolean
  // Pod telemetry — read off actum.executio (durable across the webhook boundary)
  gpuType?:           string
  podId?:             string
  downloadMs?:        number
  modelsDownloaded?:  number
  modelsReused?:      number
  downloadBytes?:     number
  executionMs?:       number
  costPerHr?:         number
  costUsd?:           number
  // Outcome
  status:        'completed' | 'failed'
  errorCode?:    string
}

function inferByType(actum: Actum): WideEvent['byType'] {
  if (actum.nullifier && !actum.signaConsumed.length) return 'arcanumProof'
  if (actum.signaConsumed.length) return 'animaId'
  return 'animaId'
}

export function buildWideEvent(
  actum: Actum,
  ctx: TraceContext,
  status: 'completed' | 'failed',
  exitus?: Exitus,
  errorCode?: string,
): WideEvent {
  const impetus = exitus?.impetus ?? 0n
  const reservation = actum.impetus
  const refund = reservation > impetus ? reservation - impetus : 0n

  // Pod telemetry is read off the actum, not the trace context: the completion
  // webhook runs in a fresh context, so ctx has none of the in-flight pod state.
  const e = actum.executio ?? {}
  // Total wall-clock from execution start to completion. Durable on the actum —
  // ctx.startTs on the webhook path is just the webhook handler's own start.
  const endTs = actum.completum ? actum.completum.getTime() : Date.now()
  const durationMs = endTs - actum.inceptum.getTime()
  const executionMs = e.executionMs ?? exitus?.duratio
  const costUsd = e.costPerHr !== undefined
    ? Number((e.costPerHr * (durationMs / 3_600_000)).toFixed(6))
    : undefined

  return {
    event:         status === 'completed' ? 'actum.complete' : 'actum.fail',
    ts:            new Date().toISOString(),
    actumId:       actum.id,
    modusId:       actum.modusId,
    modusVersiono: actum.modusVersiono,
    animaId:       ctx.animaId,
    byType:        inferByType(actum),
    platform:      ctx.platform,
    reservation:   reservation.toString(),
    impetus:       impetus.toString(),
    refund:        refund.toString(),
    durationMs,
    provisionMs:   e.provisionMs,
    sshReadyMs:    e.sshReadyMs,
    jobSubmitMs:   ctx.jobSubmitMs,
    webhookMs:     ctx.webhookMs,
    coldStart:     e.coldStart ?? false,
    gpuType:       e.gpuType,
    podId:         e.podId,
    downloadMs:        e.downloadMs,
    modelsDownloaded:  e.modelsDownloaded,
    modelsReused:      e.modelsReused,
    downloadBytes:     e.downloadBytes,
    executionMs,
    costPerHr:     e.costPerHr,
    costUsd,
    status,
    errorCode,
  }
}

export function emitWideEvent(wide: WideEvent): void {
  // Emit as a structured log line so it lands in stdout + bus
  process.stdout.write(JSON.stringify({ ...wide, level: 'info', component: 'wide' }) + '\n')
  bus.emit(wide.event, wide)
}
