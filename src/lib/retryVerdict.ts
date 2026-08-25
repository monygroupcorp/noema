// =============================================================================
// retryVerdict — is this failure worth asking the provider again for?
// =============================================================================
//
// `classifyError` answers "what do we SAY to the user". This answers the separate,
// structural question "may we ASK AGAIN", and it is the only place that decision is
// made. Two verdicts, and the split is about WHERE the failure happened, not how bad
// it reads:
//
//   'infra-retry' — the job never ran. Provisioning, connectivity, or the runtime
//                   startup gave out before the work began, so nothing about the
//                   request itself is known to be wrong and a fresh machine is a
//                   materially different attempt.
//   'quit'        — asking again cannot help, or the job DID run and failed on its
//                   own terms. An execution error inside the training is NOT retried
//                   automatically: a job that ran and failed is a real answer.
//
// The lists are DATA, deliberately. A new provider failure mode is one row in
// INFRA_RETRY_PATTERNS plus one assertion, never a new parser.
//
// The input is the recorded failure string (`Actum.error`) because that is what
// survives the pod → webhook boundary — the typed markers (`IplessHostError`,
// ThrottleError) do not, so their MESSAGES are matched here as well as their shapes.
// =============================================================================

/** Whether the platform may re-attempt this failure on the payer's behalf. */
export type RetryVerdict = 'infra-retry' | 'quit'

/** One row of the verdict table: a named failure mode and how to recognise it. */
export interface RetryPattern {
  /** Stable, human-readable name for the failure mode — used in tests and logs. */
  nomen: string
  /** Matches the recorded failure text. */
  pattern: RegExp
}

/**
 * Failures that happened BEFORE or AROUND the job rather than inside it. Every one of
 * these leaves the request itself untested, so another machine is a real second chance.
 */
export const INFRA_RETRY_PATTERNS: readonly RetryPattern[] = [
  // A pod that reached RUNNING but never published a public IP; abandoned for a fresh one.
  { nomen: 'ipless-host', pattern: /ip-less host|iplessHost/i },
  // The pod booted but sshd never answered inside the readiness window.
  { nomen: 'ssh-not-ready', pattern: /SSH not ready|sshd did not become ready/i },
  // The provider could not give us a machine at all.
  { nomen: 'provision-failed', pattern: /pod provision failed|no capacity|provision.*failed/i },
  // The pod was accepted but never posted a first status, or stopped posting.
  { nomen: 'silent-pod', pattern: /never reported in|no status post within the first-heartbeat deadline/i },
  // The run outlived its deadline without the pod ever reporting back.
  { nomen: 'actum-expired', pattern: /Actum expired|pod never reported back/i },
  // Every candidate pod was download-throttled below the usable floor.
  { nomen: 'throttled', pattern: /throttl/i },
  // The runtime process never came up on an otherwise healthy pod.
  { nomen: 'runtime-startup', pattern: /comfyrunner did not become ready|comfyrunner not reachable|runtime startup timed out/i },
]

/**
 * Failures that are answers, not accidents. Listed explicitly (and consulted FIRST) so a
 * message that also happens to contain an infra word — an execution error mentioning a
 * timeout inside the trainer, say — is not mistaken for a provisioning failure.
 */
export const QUIT_PATTERNS: readonly RetryPattern[] = [
  { nomen: 'insufficient-funds', pattern: /insufficient (funds|signa)|insufficient_signa/i },
  { nomen: 'content-refused', pattern: /content[_. ]refused|refused by the safety|CSAM/i },
  { nomen: 'config-error', pattern: /modus.*not found|not_found\.flow|unknown input|invalid aditus|validation failed/i },
  { nomen: 'forbidden', pattern: /forbidden|not authori[sz]ed|permission denied/i },
  // The job RAN. Whatever went wrong is about this request, not about the machine.
  { nomen: 'execution-error', pattern: /job failed|execution (error|failed)|CUDA|cuDNN|out of memory|OOM/i },
]

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

/**
 * The verdict for one failure. Defaults to 'quit': a failure mode we do not recognise
 * is not re-attempted on someone's credits — retryability is opt-in, by table.
 */
export function retryVerdict(err: unknown): RetryVerdict {
  if (hasIplessMarker(err)) return 'infra-retry'
  const text = failureText(err)
  for (const row of QUIT_PATTERNS) {
    if (row.pattern.test(text)) return 'quit'
  }
  for (const row of INFRA_RETRY_PATTERNS) {
    if (row.pattern.test(text)) return 'infra-retry'
  }
  return 'quit'
}
