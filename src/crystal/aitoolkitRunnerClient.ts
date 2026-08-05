import { getTrace } from '../lib/trace.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { aitkJobToProgressus, type AitkJob } from '../execution/aitkProgressus.js'

// =============================================================================
// aitoolkitRunnerClient — the crystal-native training runner's brain (build #5)
// =============================================================================
//
// Mirrors `comfyrunnerClient`: the platform owns the runtime and reads its STRUCTURED
// state. ostris/ai-toolkit's `UITrainer` writes a live row to its SQLite `Job` table
// (one per training run); this polls that row, projects each read to a `Progressus`
// (`aitkJobToProgressus`, spec §6c), and records it onto the run's training `Actum`
// through the same in-process recorder seam comfyrunner uses (`recordProgressus` via
// `getTrace().actumId`). No stdout scraping — the legacy `TrainingOutputParser` regex
// rail is gone.
//
// `awaitViaPoll` is the loop (this module's testable core, the analog of comfyrunner's
// `awaitViaStream`). The SQLite-backed reader, the Job-row seed, and the container
// spawn are the I/O shell wired around it — injected here as an `AitkJobReader` so the
// loop is exercised hermetically against a scripted timeline (no DB, no GPU).
// =============================================================================

/** Reads the current ai-toolkit `Job` row for `jobId` (undefined until seeded). */
export type AitkJobReader = (jobId: string) => Promise<AitkJob | undefined>

export interface AwaitPollOpts {
  jobId: string
  /** Total configured steps (`job_config.process[0].train.steps`) — drives executing progress + etaMs. */
  cfgSteps?: number
  /** Poll cadence (ms). ai-toolkit step cadence is seconds-scale, so 2s is plenty. */
  intervalMs?: number
  /** Overall cap; on expiry the timeline is closed with a synthetic `failed` and an error outcome. */
  timeoutMs?: number
  /** Injectable clock (tests). */
  now?: () => Date
  /** Injectable delay (tests). */
  sleep?: (ms: number) => Promise<void>
}

/** Terminal result of a training run, for the cursor to map to complete/fail. */
export interface AitkOutcome {
  status: 'completed' | 'error' | 'stopped'
  lastStep: number
  message?: string
  /**
   * The trained LoRA's location for finality (Slice E). On the REMOTE path the pod
   * uploads its safetensors to R2 and reports the URL here, so `urlLoraReader` can
   * fetch it at completion. Absent on the LOCAL path (the file is on host disk —
   * `fsLoraReader` finds it from the output dir instead).
   */
  outputUrl?: string
  /**
   * Durable URLs of the end-of-run preview samples the pod uploaded (REMOTE path). Persisted
   * onto the Intella as first-class previews + committed to the published repo. Absent locally.
   */
  sampleUrls?: string[]
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Poll an ai-toolkit `Job` row to terminal, recording the projected `Progressus` timeline
 * onto the trace's Actum as it goes. Returns the terminal outcome (`completed`/`error`/
 * `stopped`) — it never throws on a training failure; the caller decides complete-vs-fail.
 *
 * Records only when the row's `(status, step, info)` signature CHANGES (matching ai-toolkit's
 * own poll_job dedup) — so a 2s poll over a slow step doesn't re-emit. Persistence is
 * coalesced downstream (`shouldPersist`, §7); the bus event still fires on every change to
 * drive the live progress bar. No `actumId` in the trace (e.g. a non-Actum run) → records
 * nothing, still polls to terminal.
 */
export async function awaitViaPoll(read: AitkJobReader, opts: AwaitPollOpts): Promise<AitkOutcome> {
  const interval = opts.intervalMs ?? 2000
  const now = opts.now ?? (() => new Date())
  const sleep = opts.sleep ?? defaultSleep
  const deadline = opts.timeoutMs !== undefined ? now().getTime() + opts.timeoutMs : Infinity

  let lastSig: string | undefined

  const record = async (job: AitkJob): Promise<void> => {
    const ctx = getTrace()
    if (ctx?.actumId) await recordProgressus(ctx.actumId, aitkJobToProgressus(job, opts.cfgSteps, now()))
  }

  for (;;) {
    const job = await read(opts.jobId)
    if (job) {
      const sig = `${job.status}|${job.step}|${job.info ?? ''}`
      if (sig !== lastSig) {
        lastSig = sig
        await record(job)
      }
      if (job.status === 'completed') return { status: 'completed', lastStep: job.step }
      if (job.status === 'error')     return { status: 'error',  lastStep: job.step, ...(job.info ? { message: job.info } : {}) }
      if (job.status === 'stopped')   return { status: 'stopped', lastStep: job.step, ...(job.info ? { message: job.info } : {}) }
    }

    if (now().getTime() >= deadline) {
      // Close the timeline with a synthetic terminal so `phaseDurations` still rolls up.
      const ctx = getTrace()
      if (ctx?.actumId) await recordProgressus(ctx.actumId, { phase: 'failed', message: 'training poll timeout', at: now() })
      return { status: 'error', lastStep: job?.step ?? 0, message: 'training poll timeout' }
    }

    await sleep(interval)
  }
}
