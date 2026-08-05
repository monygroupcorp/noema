import type { Progressus } from '../types/progressus.js'

// =============================================================================
// aitkProgressus (execution rail) — project ostris/ai-toolkit's job state → Progressus
// =============================================================================
//
// The crystal-native training runner drives ostris/ai-toolkit (FLUX.2 Klein etc.) and
// reads its STRUCTURED job state, never training stdout. ai-toolkit's `UITrainer`
// writes a row to its own SQLite `Job` table (`ui/prisma/schema.prisma`); this projects
// that row to a canonical `Progressus` (spec §6c). The legacy `TrainingOutputParser`
// (538 lines of `/step\s*(\d+)\/(\d+)/` regexes guessing across ai-toolkit/Kohya/generic
// stdout formats) is NOT ported — owning the typed Job row retires it.
//
// The Job signal is two-axis: a coarse typed `status` × an `info` sub-phase label. The
// projection reads both, plus `step` / `speed_string` / the config's total steps.
// =============================================================================

/**
 * The subset of ai-toolkit's `Job` row this projection reads. ai-toolkit owns these
 * fields verbatim — `status` is its typed `Literal["running","stopped","error",
 * "completed"]` (+ `"queued"` from the GPU queue); `info` is the sub-phase label its
 * `UITrainer` sets ("Loading model" → "Loading dataset" → "Training" → …).
 */
export interface AitkJob {
  status: string
  /** Latest training step (0 before the loop starts). */
  step: number
  /** Sub-phase label, e.g. "Loading model" | "Loading dataset" | "Training" | "Starting". */
  info?: string
  /** Speed sample, e.g. "1.52 iter/sec" or "0.66 sec/iter". */
  speed_string?: string
  /** Position in ai-toolkit's GPU queue while `status:"queued"`. */
  queue_position?: number
}

const ITER_PER_SEC = /([0-9.]+)\s*iter\/sec/i
const SEC_PER_ITER = /([0-9.]+)\s*sec\/iter/i

/**
 * ms to finish `remaining` steps at ai-toolkit's reported speed — handles both forms
 * it emits (`iter/sec` and `sec/iter`). Undefined when there's no usable rate or the
 * run is already complete.
 */
export function etaMsFromSpeed(speed: string | undefined, remaining: number): number | undefined {
  if (!speed || remaining <= 0) return undefined
  const ips = ITER_PER_SEC.exec(speed)
  if (ips) { const v = Number(ips[1]); return v > 0 ? Math.round((remaining / v) * 1000) : undefined }
  const spi = SEC_PER_ITER.exec(speed)
  if (spi) { const v = Number(spi[1]); return v > 0 ? Math.round(remaining * v * 1000) : undefined }
  return undefined
}

/**
 * Project an ai-toolkit `Job` row to a `Progressus` (spec §6c). Two-axis map —
 * coarse `status` × the `info` sub-phase:
 *  - queued                         → queued       (queue position in message)
 *  - running + "…dataset…"          → downloading/dataset
 *  - running + "Generating baseline" → warming      (pre-train sample = readiness inference)
 *  - running + pre-loop (step 0)    → loading/vram  ("Loading model" / "Starting")
 *  - running + training (step > 0)  → executing {done:step, total:cfgSteps, steps} + etaMs
 *  - completed                      → done
 *  - error                          → failed        (info as message)
 *  - stopped                        → cancelling     (terminal)
 *
 * `message` is set for phase-meaningful sub-phases / errors but NEVER for the steady
 * "Training" pings — so consecutive incrementing-step reports coalesce to live-only
 * (spec §7: a phase's duration comes from its transition timestamps, not its ticks).
 *
 * NOTE: a LOCAL ai-toolkit run has no `provisioning`/`pulling` phase (no pod create, no
 * image pull) — its timeline opens at `loading`/`downloading`. A remote training variant
 * would prepend those, mapped from the provider, not from ai-toolkit.
 */
export function aitkJobToProgressus(job: AitkJob, cfgSteps?: number, now: Date = new Date()): Progressus {
  const at = now
  const info = job.info?.trim() || undefined

  switch (job.status) {
    case 'completed':
      return { phase: 'done', at }
    case 'error':
      return { phase: 'failed', at, ...(info ? { message: info } : {}) }
    case 'stopped':
      return { phase: 'cancelling', at, ...(info ? { message: info } : {}) }
    case 'queued':
      return {
        phase: 'queued', at,
        ...(typeof job.queue_position === 'number'
          ? { message: `queue position ${job.queue_position}` }
          : info ? { message: info } : {}),
      }
  }

  // status === 'running' (and any unrecognized live status floors here, like coercePhase).
  const lower = info?.toLowerCase() ?? ''
  if (lower.includes('dataset')) {
    return { phase: 'downloading', target: 'dataset', at, ...(info ? { message: info } : {}) }
  }
  if (job.step <= 0 && /baseline|sample|generat/.test(lower)) {
    // Pre-loop "Generating baseline" sample — post-load readiness inference, not a VRAM load.
    return { phase: 'warming', at, ...(info ? { message: info } : {}) }
  }
  if (job.step <= 0 && !lower.includes('training')) {
    // Pre-loop: "Loading model" / "Starting" — weights into VRAM (the GPU load, not a download).
    return { phase: 'loading', target: 'vram', at, ...(info ? { message: info } : {}) }
  }

  // Training steady state — pure step progress, NO message so the ticks coalesce live-only.
  const p: Progressus = { phase: 'executing', at }
  if (typeof cfgSteps === 'number' && cfgSteps > 0) {
    p.progress = { done: job.step, total: cfgSteps, unit: 'steps' }
    const eta = etaMsFromSpeed(job.speed_string, cfgSteps - job.step)
    if (eta !== undefined) p.etaMs = eta
  } else {
    p.progress = { done: job.step, unit: 'steps' }
  }
  return p
}
