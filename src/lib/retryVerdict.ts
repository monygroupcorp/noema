// =============================================================================
// retryVerdict — the failure-mode table: may we ask again, and WHERE did it die?
// =============================================================================
//
// `classifyError` answers "what do we SAY to the user". This file answers the two
// structural questions, from ONE ordered table of named failure modes:
//
//   verdict — may the platform re-attempt this on the payer's credits?
//     'infra-retry' — the job never ran. Provisioning, connectivity, or the runtime
//                     startup gave out before the work began, so nothing about the
//                     request itself is known to be wrong and a fresh machine is a
//                     materially different attempt.
//     'quit'        — asking again cannot help, or the job DID run and failed on its
//                     own terms. An execution error inside the training is NOT retried
//                     automatically: a job that ran and failed is a real answer.
//
//   stage   — WHERE in the run's lifecycle it died: provision → ssh → bootstrap →
//             download → execute. A closed enum with no free text, so it is safe to
//             publish to any caller (`Run.failure.stage`, noema-390) while the raw
//             recorded text stays owner-scoped.
//
// ONE TABLE, TWO READERS. The header of this file has always said the split "is about
// WHERE the failure happened" — the stage IS that, read for a different consumer, so it
// belongs on the same rows rather than in a third regex list that has to be kept in step
// with these. A new provider failure mode is one row plus one assertion, never a new
// parser and never a second table.
//
// INFRA_RETRY_PATTERNS / QUIT_PATTERNS remain exported as DERIVED VIEWS of the table so
// existing importers and their coverage guard keep working unchanged.
//
// The input is the recorded failure string (`Actum.error`) because that is what
// survives the pod → webhook boundary — the typed markers (`IplessHostError`,
// ThrottleError) do not, so their MESSAGES are matched here as well as their shapes.
// =============================================================================

/** Whether the platform may re-attempt this failure on the payer's behalf. */
export type RetryVerdict = 'infra-retry' | 'quit'

/**
 * Where in a run's lifecycle the failure happened. Deliberately SMALL and CLOSED: this is
 * public API (`Run.failure.stage`), so every value has to stay meaningful for years, and a
 * value that carries no free text can be shown to anyone.
 *
 * NOT `Phasis` (src/types/progressus.ts). Phasis is the internal, runner-owned telemetry
 * vocabulary — fourteen values today, expected to grow as runners are added, and several
 * of them ('queued', 'done') can never be a failure stage. Publishing it would make every
 * new runner a public API change, and it has no value at all for "sshd never answered",
 * which sits between `provisioning` and `installing`. These five map ONTO Phasis; they are
 * not equal to it.
 *
 *   'provision' — acquiring a machine at all (Phasis: provisioning)
 *   'ssh'       — the machine exists but never became reachable (no Phasis equivalent)
 *   'bootstrap' — the machine is reachable; its runtime never came up (Phasis: pulling,
 *                 installing, warming)
 *   'download'  — fetching model weights onto the pod (Phasis: downloading)
 *   'execute'   — the job ran and failed on its own terms (Phasis: executing)
 */
export type FailureStage = 'provision' | 'ssh' | 'bootstrap' | 'download' | 'execute'

/** One row of the failure-mode table. */
export interface RetryPattern {
  /** Stable, human-readable name for the failure mode — used in tests and logs. */
  nomen: string
  /** Matches the recorded failure text. */
  pattern: RegExp
  /** May the platform ask again on the payer's credits? */
  verdict: RetryVerdict
  /**
   * Where it died, when the recorded text says so. ABSENT means we genuinely do not know —
   * an expired actum can have died anywhere — and an absent field says that honestly, where
   * a guessed stage would not.
   */
  stage?: FailureStage
}

/**
 * The failure-mode table, IN EVALUATION ORDER. First match wins.
 *
 * The 'quit' answers come first so a message that also happens to contain an infra word —
 * an execution error mentioning a timeout inside the trainer, say — is not mistaken for a
 * provisioning failure. That is the same two-pass precedence this file has always had; the
 * order here reproduces it exactly.
 */
export const FAILURE_MODES: readonly RetryPattern[] = [
  // ── Answers, not accidents ────────────────────────────────────────────────
  { nomen: 'insufficient-funds', pattern: /insufficient (funds|signa)|insufficient_signa/i, verdict: 'quit' },
  { nomen: 'content-refused', pattern: /content[_. ]refused|refused by the safety|CSAM/i, verdict: 'quit' },
  { nomen: 'config-error', pattern: /modus.*not found|not_found\.flow|unknown input|invalid aditus|validation failed/i, verdict: 'quit' },
  { nomen: 'forbidden', pattern: /forbidden|not authori[sz]ed|permission denied/i, verdict: 'quit' },
  // The job RAN. Whatever went wrong is about this request, not about the machine.
  { nomen: 'execution-error', pattern: /job failed|execution (error|failed)|CUDA|cuDNN|out of memory|OOM/i, verdict: 'quit', stage: 'execute' },

  // ── Failures BEFORE or AROUND the job — another machine is a real second chance ──
  // A pod that reached RUNNING but never published a public IP; abandoned for a fresh one.
  { nomen: 'ipless-host', pattern: /ip-less host|iplessHost/i, verdict: 'infra-retry', stage: 'provision' },
  // The pod booted but sshd never answered inside the readiness window.
  { nomen: 'ssh-not-ready', pattern: /SSH not ready|sshd did not become ready/i, verdict: 'infra-retry', stage: 'ssh' },
  // The provider could not give us a machine at all.
  { nomen: 'provision-failed', pattern: /pod provision failed|no capacity|provision.*failed/i, verdict: 'infra-retry', stage: 'provision' },
  // The pod was accepted but never posted a first status, or stopped posting. The pod LOCK
  // is "a machine is ours and reachable" (expiryReaper), so a pod that went silent after it
  // had already been locked got past provisioning and SSH: the runtime is what never spoke.
  { nomen: 'silent-pod', pattern: /never reported in|no status post within the first-heartbeat deadline/i, verdict: 'infra-retry', stage: 'bootstrap' },
  // The run outlived its deadline without the pod ever reporting back. No stage: the outer
  // deadline elapsing says WHEN, never WHERE.
  { nomen: 'actum-expired', pattern: /Actum expired|pod never reported back/i, verdict: 'infra-retry' },
  // Every candidate pod was download-throttled below the usable floor.
  { nomen: 'throttled', pattern: /throttl/i, verdict: 'infra-retry', stage: 'download' },
  // The runtime process never came up on an otherwise healthy pod.
  { nomen: 'runtime-startup', pattern: /comfyrunner did not become ready|comfyrunner not reachable|runtime startup timed out/i, verdict: 'infra-retry', stage: 'bootstrap' },

  // ── Modes the table had no row for at all (noema-390) ─────────────────────
  // These three were recorded verbatim on the MiniMax H3 bring-up and matched NOTHING here
  // and nothing in `classifyError` — so the caller got "Something went wrong" and the order
  // runner got the default verdict.
  //
  // Every row below carries verdict 'quit', which is EXACTLY the verdict each already got as
  // the unmatched default. They are appended at the END so no text that matched a row before
  // can match a different one now: this file's retry behaviour is unchanged, by construction.
  // Whether a disk-full download or an SSH-exhausted launch SHOULD be re-attempted is a retry
  // decision, and retry behaviour is noema-391's, not this change's.
  //
  // The pod ran out of disk fetching weights (`wget … returned non-zero exit status 3`), or
  // otherwise could not get them down. Recorded on the first run to reach the weight fetch.
  { nomen: 'model-download-failed', pattern: /model download failed|no space left on device|disk (is )?full|failed to download (the )?(model|weights)/i, verdict: 'quit', stage: 'download' },
  // Every provisioning attempt was abandoned without ever reaching a host we could log into
  // (SecurePodClient._launchTrainingPod). Recorded on the first t2v attempt.
  { nomen: 'ssh-exhausted', pattern: /without reaching an SSH-reachable host/i, verdict: 'quit', stage: 'ssh' },
  // The provisioning budget ran out mid-bootstrap (SecurePodClient._bootstrapAndLaunch).
  { nomen: 'bootstrap-budget', pattern: /bootstrap stopped before command/i, verdict: 'quit', stage: 'bootstrap' },
]

/**
 * Failures that happened BEFORE or AROUND the job rather than inside it. Every one of
 * these leaves the request itself untested, so another machine is a real second chance.
 * DERIVED from {@link FAILURE_MODES} — the table is the source of truth.
 */
export const INFRA_RETRY_PATTERNS: readonly RetryPattern[] =
  FAILURE_MODES.filter(row => row.verdict === 'infra-retry')

/**
 * Failures that are answers, not accidents.
 * DERIVED from {@link FAILURE_MODES} — the table is the source of truth.
 */
export const QUIT_PATTERNS: readonly RetryPattern[] =
  FAILURE_MODES.filter(row => row.verdict === 'quit')

/** True for the typed ip-less-host marker, which carries no distinctive message of its own
 *  when it is re-thrown across a boundary. */
function hasIplessMarker(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { iplessHost?: unknown }).iplessHost === true
}

/** Extract the text a verdict is read from. Accepts an Error, an API-style error with a
 *  `message`, or the recorded failure string itself. */
export function failureText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return String(err)
}

/** The first table row that recognises this failure, or undefined. */
function matchFailureMode(err: unknown): RetryPattern | undefined {
  const text = failureText(err)
  return FAILURE_MODES.find(row => row.pattern.test(text))
}

/**
 * The verdict for one failure. Defaults to 'quit': a failure mode we do not recognise
 * is not re-attempted on someone's credits — retryability is opt-in, by table.
 */
export function retryVerdict(err: unknown): RetryVerdict {
  if (hasIplessMarker(err)) return 'infra-retry'
  return matchFailureMode(err)?.verdict ?? 'quit'
}

/**
 * Where this failure happened, or undefined when the recorded text does not say.
 *
 * Undefined is a real answer, not a gap to be filled: guessing a stage would be the same
 * mistake as asserting a refund nobody checked. A caller that gets no stage knows the
 * platform does not know, which is worth more than a plausible wrong one.
 */
export function failureStage(err: unknown): FailureStage | undefined {
  if (hasIplessMarker(err)) return 'provision'
  return matchFailureMode(err)?.stage
}
