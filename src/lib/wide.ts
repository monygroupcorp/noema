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
  // Timing (ms from actum initiation — null means that stage didn't run)
  durationMs:    number
  provisionMs?:  number
  sshReadyMs?:   number
  jobSubmitMs?:  number
  webhookMs?:    number
  coldStart:     boolean
  // Infrastructure — contributed by SecurePodClient via ctx.wideFields
  gpuType?:      string
  podId?:        string
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

  return {
    event:         `actum.${status}` as WideEvent['event'],
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
    durationMs:    Date.now() - ctx.startTs,
    provisionMs:   ctx.provisionMs,
    sshReadyMs:    ctx.sshReadyMs,
    jobSubmitMs:   ctx.jobSubmitMs,
    webhookMs:     ctx.webhookMs,
    coldStart:     !!ctx.provisionMs,
    status,
    errorCode,
    // Merge anything sub-components contributed (gpuType, podId, cursorType, etc.)
    ...ctx.wideFields,
  }
}

export function emitWideEvent(wide: WideEvent): void {
  // Emit as a structured log line so it lands in stdout + bus
  process.stdout.write(JSON.stringify({ ...wide, level: 'info', component: 'wide' }) + '\n')
  bus.emit(wide.event, wide)
}
