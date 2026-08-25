import { bus } from './bus.js'
import type { TraceContext } from './trace.js'
import type { Actum } from '../types/actum.js'
import type { Exitus } from '../types/cursus.js'
import { executioFromPhaseDurations } from '../execution/progressus.js'
import { classifyError } from './classifyError.js'

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
  // Grouped over a fixed, finite set (via classifyError) — safe to group failures by. The full
  // raw text this was classified from lives in `message`.
  errorCode?:    string
  message?:      string
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
  rawError?: string,
): WideEvent {
  const impetus = exitus?.impetus ?? 0n
  const reservation = actum.impetus
  const refund = reservation > impetus ? reservation - impetus : 0n

  // Pod telemetry is read off the actum, not the trace context: the completion
  // webhook runs in a fresh context, so ctx has none of the in-flight pod state.
  const e = actum.executio ?? {}
  // #6d — the duration telemetry unifies into phaseDurations: prefer the cursor's
  // explicit report, fall back to the rolled-up timeline (so a runner that reports
  // only a Progressus stream still lands provision/download/execution timings).
  const d = executioFromPhaseDurations(actum.phaseDurations)
  // Total wall-clock from execution start to completion. Durable on the actum —
  // ctx.startTs on the webhook path is just the webhook handler's own start.
  const endTs = actum.completum ? actum.completum.getTime() : Date.now()
  const durationMs = endTs - actum.inceptum.getTime()
  const executionMs = e.executionMs ?? d.executionMs ?? exitus?.duratio
  // Cost is billed against pod wall-time. Prefer an explicit billedMs when the
  // cursor reports one (the dev fake), else the actum's inceptum→completum delta.
  const billedMs = e.billedMs ?? durationMs
  const costUsd = e.costPerHr !== undefined
    ? Number((e.costPerHr * (billedMs / 3_600_000)).toFixed(6))
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
    provisionMs:   e.provisionMs ?? d.provisionMs,
    sshReadyMs:    e.sshReadyMs,
    jobSubmitMs:   ctx.jobSubmitMs,
    webhookMs:     ctx.webhookMs,
    coldStart:     e.coldStart ?? false,
    gpuType:       e.gpuType,
    podId:         e.podId,
    downloadMs:        e.downloadMs ?? d.downloadMs,
    modelsDownloaded:  e.modelsDownloaded,
    modelsReused:      e.modelsReused,
    downloadBytes:     e.downloadBytes,
    executionMs,
    costPerHr:     e.costPerHr,
    costUsd,
    status,
    // The raw text is what made a full diagnosis possible in one pass — kept verbatim in
    // `message`, never truncated. `errorCode` is classified through the shared taxonomy so
    // two instances of one fault with different wording group as the same fault.
    errorCode: rawError !== undefined ? classifyError(rawError) : undefined,
    message:   rawError,
  }
}

export function emitWideEvent(wide: WideEvent): void {
  // Emit as a structured log line so it lands in stdout + bus
  process.stdout.write(JSON.stringify({ ...wide, level: 'info', component: 'wide' }) + '\n')
  bus.emit(wide.event, wide)
}
