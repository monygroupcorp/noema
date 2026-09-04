// =============================================================================
// classifyError — low-level infra error text → the one sentence a caller sees
// =============================================================================
//
// Used in TelegramAllocutio, ExecuteFlow and the `/v1` run projection, so one failure
// says one thing everywhere and no raw exception text is ever the user-facing copy.
//
// TWO RULES THIS FILE NOW KEEPS (noema-390):
//
//  1. The generic sentence is a LAST resort, not the answer for anything the platform
//     already identified. Three of the four MiniMax H3 bring-up failures — a full disk
//     during the weight download, a launch that never reached a reachable host, and a
//     runner that never came up — reached the caller as "Something went wrong" while the
//     server log named the cause. Before falling through, this asks the failure-mode
//     table WHERE the run died and says at least that much.
//
//  2. It does not assert accounting outcomes it cannot see. Several sentences used to end
//     "Your credits weren't charged". This function is handed one string and has no view
//     of the ledger: on the bring-up runs that happened to be true because the reservation
//     released, but it was asserted, never verified. A caller's balance is authoritative
//     and reachable (/status, GET /v1/me/balance); a confident wrong sentence is not.
// =============================================================================

import { failureStage, type FailureStage } from './retryVerdict.js'

/**
 * The sentences, named once. A matched branch below and the stage fallback return the
 * SAME string for the same condition, so the two paths cannot drift into two different
 * ways of describing one failure.
 */
const PROVISION_COPY = "Couldn't start a GPU pod — RunPod may be at capacity. Try again in a minute."
const SSH_COPY       = 'Pod started but SSH was unreachable — try again.'
const BOOTSTRAP_COPY = 'Runtime startup timed out — try again.'
const DOWNLOAD_COPY  = "Couldn't get the model weights onto the pod — try again."
const EXECUTE_COPY   = 'Generation failed on the pod — try again.'
const GENERIC_COPY   = 'Something went wrong. Please try again.'

/**
 * What each stage says when no branch above matched but the table still knows where the
 * run died. Total over `FailureStage`, so a new stage cannot be added without copy.
 */
const STAGE_COPY: Record<FailureStage, string> = {
  provision: PROVISION_COPY,
  ssh:       SSH_COPY,
  bootstrap: BOOTSTRAP_COPY,
  download:  DOWNLOAD_COPY,
  execute:   EXECUTE_COPY,
}

/** Maps low-level infra error messages to user-facing copy. */
export function classifyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)

  if (/insufficient funds/i.test(msg))
    return "You don't have enough credits. Use /status to check your balance."

  if (/modus.*not found/i.test(msg))
    return "This workflow isn't set up correctly. Please contact support."

  if (
    /RunPod pod provision failed/i.test(msg) ||
    /no capacity/i.test(msg) ||
    /provision.*failed/i.test(msg)
  )
    return PROVISION_COPY

  if (/SSH not ready/i.test(msg) || /sshd did not become ready/i.test(msg))
    return SSH_COPY

  if (
    /comfyrunner did not become ready/i.test(msg) ||
    /comfyrunner not reachable/i.test(msg)
  )
    return BOOTSTRAP_COPY

  if (/comfyrunner.*job failed/i.test(msg) || /execution.*failed/i.test(msg))
    return EXECUTE_COPY

  if (/throttl/i.test(msg))
    return "Couldn't get a fast enough GPU — the provider was throttling downloads on every pod we tried. Try again shortly."

  if (/timeout|timed out|expired/i.test(msg))
    return 'The job timed out. The pod is being shut down — try again.'

  // The last thing before giving up: the failure-mode table recognises modes none of the
  // branches above name (a full disk, an exhausted launch, a bootstrap budget), and its
  // stage is enough to say something true and specific. Only a failure the platform genuinely
  // did not identify reaches the generic sentence now.
  const stage = failureStage(msg)
  if (stage) return STAGE_COPY[stage]

  return GENERIC_COPY
}
