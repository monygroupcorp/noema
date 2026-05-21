/**
 * Maps low-level infra error messages to user-facing copy.
 * Used in TelegramAllocutio and ExecuteFlow to avoid exposing raw exception text.
 */
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
    return "Couldn't start a GPU pod — RunPod may be at capacity. Try again in a minute."

  if (/SSH not ready/i.test(msg) || /sshd did not become ready/i.test(msg))
    return "Pod started but SSH was unreachable. Your credits weren't charged — try again."

  if (
    /comfyrunner did not become ready/i.test(msg) ||
    /comfyrunner not reachable/i.test(msg)
  )
    return "Runtime startup timed out. Your credits weren't charged — try again."

  if (/comfyrunner.*job failed/i.test(msg) || /execution.*failed/i.test(msg))
    return "Generation failed on the pod. Your credits weren't charged — try again."

  if (/throttl/i.test(msg))
    return "Couldn't get a fast enough GPU — the provider was throttling downloads on every pod we tried. Your credits weren't charged — try again shortly."

  if (/timeout|timed out|expired/i.test(msg))
    return "The job timed out. The pod is being shut down — try again."

  return "Something went wrong. Please try again."
}
