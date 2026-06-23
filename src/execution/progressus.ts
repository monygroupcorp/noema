import type {
  Progressus, PhaseDurations, Phasis, ProgressusMensura, ProgressusResources, ProgressusPod, ProgressusUnit,
} from '../types/progressus.js'
import type { StageInfo } from '../lib/bus.js'

// =============================================================================
// progressus (execution rail) — derive phase durations from a Progressus timeline
// =============================================================================
//
// A run accumulates a stream of Progressus reports on `Actum.progressus`. On
// completion we roll that timeline up into `Actum.phaseDurations` — the "how fast
// is each step" substrate (the unification target for `ActumExecutio`'s
// provisionMs/downloadMs/… telemetry). Durations come from transition TIMESTAMPS,
// never from per-tick progress (spec §7). Single source of truth for the roll-up,
// so every completion site derives it the same way — mirrors `projectExitus`.
// =============================================================================

/** The roll-up key for a report: `phase` alone, or `phase/target`. */
export function phaseKey(p: Pick<Progressus, 'phase' | 'target'>): string {
  return p.target ? `${p.phase}/${p.target}` : p.phase
}

/**
 * Roll a Progressus timeline up into per-`(phase, target)` durations (ms).
 *
 * Each report marks the start of its segment; the segment's duration runs until the
 * NEXT report's `at`. Consecutive reports sharing a key accumulate, so total
 * dwell-time in a phase is correct even across coalesced message/checkpoint entries.
 * The final report contributes no duration (it is terminal, or the run is still open).
 * Out-of-order timestamps are skipped rather than producing a negative duration.
 */
export function rollupPhaseDurations(timeline: readonly Progressus[]): PhaseDurations {
  const out: PhaseDurations = {}
  for (let i = 0; i < timeline.length - 1; i++) {
    const cur = timeline[i]
    const next = timeline[i + 1]
    const ms = next.at.getTime() - cur.at.getTime()
    if (ms < 0) continue
    const key = phaseKey(cur)
    out[key] = (out[key] ?? 0) + ms
  }
  return out
}

// ── Lenient inbound parse ───────────────────────────────────────────────────
// A status report NEVER hard-fails (base images deploy off-cadence — an old runner
// and a new platform, or vice-versa, must interoperate). Unknown phase degrades to
// the nearest known (default `executing`); unknown target is a free string; every
// field but `phase`/`at` is optional. See spec §4.

const KNOWN_PHASES: ReadonlySet<string> = new Set<Phasis>([
  'queued', 'provisioning', 'pulling', 'attesting', 'downloading', 'installing',
  'loading', 'warming', 'executing', 'uploading', 'finalizing', 'cancelling', 'done', 'failed',
])

const KNOWN_UNITS: ReadonlySet<string> = new Set<ProgressusUnit>(['items', 'bytes', 'steps', 'pct'])

/**
 * Map any inbound phase string to a canonical `Phasis`. Exact match wins; otherwise a
 * small keyword heuristic picks the nearest known phase; the floor is `executing` (an
 * in-flight runner is, by default, doing work). Terminal-smelling strings land on
 * `failed`/`done` so a run can't get stuck nascens on an unrecognized terminal event.
 * (Spec §9 leaves this table tunable — keep it conservative.)
 */
export function coercePhase(raw: unknown): Phasis {
  if (typeof raw !== 'string') return 'executing'
  if (KNOWN_PHASES.has(raw)) return raw as Phasis
  const s = raw.toLowerCase()
  if (/(fail|error|crash|fatal|oom|abort)/.test(s)) return 'failed'
  if (/(done|complete|finish|success)/.test(s)) return 'done'
  if (/(cancel|interrupt)/.test(s)) return 'cancelling'
  if (/(queue|pending|wait)/.test(s)) return 'queued'
  if (/(provision|acquir|alloc|spawn)/.test(s)) return 'provisioning'
  if (/(pull|image)/.test(s)) return 'pulling'
  if (/(attest|tunnel|handshake)/.test(s)) return 'attesting'
  if (/(download|fetch)/.test(s)) return 'downloading'
  if (/(install|node|dep)/.test(s)) return 'installing'
  if (/(warm)/.test(s)) return 'warming'
  if (/(load)/.test(s)) return 'loading'        // after download/install so "downloading" wins
  if (/(upload|push)/.test(s)) return 'uploading'
  if (/(final|settle|cleanup)/.test(s)) return 'finalizing'
  return 'executing'
}

function coerceDate(raw: unknown, now: Date): Date {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw
  if (typeof raw === 'string' || typeof raw === 'number') {
    const d = new Date(raw)
    if (!isNaN(d.getTime())) return d
  }
  return now
}

function coerceMensura(raw: unknown): ProgressusMensura | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.done !== 'number') return undefined
  const unit = (typeof r.unit === 'string' && KNOWN_UNITS.has(r.unit)) ? r.unit as ProgressusUnit : 'items'
  const m: ProgressusMensura = { done: r.done, unit }
  if (typeof r.total === 'number') m.total = r.total
  return m
}

function coercePod(raw: unknown): ProgressusPod | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: ProgressusPod = {}
  for (const k of ['podId', 'gpuType', 'region'] as const) {
    if (typeof r[k] === 'string') out[k] = r[k] as string
  }
  if (typeof r.costPerHr === 'number') out.costPerHr = r.costPerHr
  return Object.keys(out).length ? out : undefined
}

function coerceResources(raw: unknown): ProgressusResources | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: ProgressusResources = {}
  for (const k of ['vramUsedMb', 'vramTotalMb', 'gpuUtilPct', 'diskUsedMb'] as const) {
    if (typeof r[k] === 'number') out[k] = r[k] as number
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Normalize an untrusted inbound payload into a `Progressus`. Total — never throws.
 * Defaults `at` to `now`. Recurses into `parallel[]`. A legacy TEE `{ step }` body
 * (no `phase`) becomes an `executing` report carrying `step` as its message, so the
 * one channel subsumes the old stub without breaking it.
 */
export function normalizeProgressus(raw: unknown, now: Date = new Date()): Progressus {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const p: Progressus = { phase: coercePhase(r.phase), at: coerceDate(r.at, now) }
  if (typeof r.target === 'string') p.target = r.target
  const progress = coerceMensura(r.progress);     if (progress) p.progress = progress
  if (typeof r.etaMs === 'number') p.etaMs = r.etaMs
  if (typeof r.message === 'string') p.message = r.message
  else if (r.phase === undefined && typeof r.step === 'string') p.message = r.step  // legacy TEE {step}
  const resources = coerceResources(r.resources); if (resources) p.resources = resources
  const pod = coercePod(r.pod); if (pod) p.pod = pod
  if (Array.isArray(r.parallel)) p.parallel = r.parallel.map(x => normalizeProgressus(x, now))
  return p
}

// ── Cold-start projection (build #6a) ───────────────────────────────────────
/**
 * Project a pod-lifecycle `actum.stage` string (the cold-start vocabulary only emitted by
 * SecurePodClient/WarmPodClient — `provisioning`/`pod-locked`/`bootstrapping`/`comfy-ready`/
 * `warm-pod-found`) to a `Progressus`, so a cold run's timeline opens at `provisioning`
 * instead of `downloading` (the #3 scope boundary). Returns `undefined` for any other stage —
 * notably comfyrunner's own `inferring`/`uploading`/`downloading:n/m`, which comfyrunner
 * already records itself (no double-record). `pod-locked`/`warm-pod-found` carry the pod
 * identity/cost on `pod`; each maps to a `message` so the entry persists (§7).
 */
export function coldStartProgressus(stage: string, info?: StageInfo): Omit<Progressus, 'at'> | undefined {
  const pod = coercePod(info)
  switch (stage) {
    case 'provisioning':  return { phase: 'provisioning', message: 'acquiring GPU' }
    case 'pod-locked':    return { phase: 'provisioning', message: podLabel(info), ...(pod ? { pod } : {}) }
    case 'warm-pod-found': return { phase: 'provisioning', message: 'warm pod reused', ...(pod ? { pod } : {}) }
    case 'bootstrapping': return { phase: 'pulling', target: 'fundamentum', message: 'bootstrapping runtime' }
    case 'comfy-ready':   return { phase: 'pulling', target: 'fundamentum', message: 'runtime ready' }
    default:              return undefined   // comfyrunner stages record themselves; ignore here
  }
}

function podLabel(info?: StageInfo): string {
  if (!info) return 'pod acquired'
  const gpu = info.gpuType ? ` (${info.gpuType})` : ''
  return info.podId ? `pod ${info.podId}${gpu}` : `pod acquired${gpu}`
}

// ── Coalescing (volume guard, spec §7) ──────────────────────────────────────
/**
 * Should this report be APPENDED to the persisted timeline (vs live-only)?
 *
 * Persist verbatim: every phase/target TRANSITION, every log `message`, every
 * terminal (`done`/`failed`). DON'T persist a same-`(phase,target)` pure numeric
 * progress sample (sampler 7→8→9, byte ticks) — that's bus/SSE-only; a phase's
 * duration comes from its transition timestamps, not its ticks. Bounds the Actum doc
 * to ~dozens of entries per run, not thousands.
 */
export function shouldPersist(last: Progressus | undefined, next: Progressus): boolean {
  if (!last) return true
  if (last.phase !== next.phase || last.target !== next.target) return true
  if (next.message) return true
  if (next.phase === 'done' || next.phase === 'failed') return true
  return false
}

// ── Legacy projection shim (retired in build #6) ────────────────────────────
/**
 * Project a `Progressus` to the legacy stringly `actum.stage` value, so existing
 * consumers (Telegram StatusView, SSE) keep working unchanged while a runner emits
 * the new typed reports. `phase:done/total` when there's countable progress, else the
 * bare phase word. Mirrors the vocabulary comfyrunner emits today (`downloading:2/5`,
 * `executing` etc.).
 */
export function progressusToStage(p: Progressus): string {
  if (p.progress && typeof p.progress.total === 'number') {
    return `${p.phase}:${p.progress.done}/${p.progress.total}`
  }
  return p.phase
}
