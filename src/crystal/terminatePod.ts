import { makeLogger } from '../lib/logger.js'
import { deleteRunPodPod } from './runpodRest.js'

const log = makeLogger('pod:terminate')

/**
 * Terminate a RunPod pod. One DELETE permanently terminates it (REST v2); a pod already gone
 * counts as terminated.
 * Errors are caught and logged; callers can rely on this being a best-effort fire-and-forget.
 */
export async function terminatePod(apiKey: string, podId: string): Promise<void> {
  try {
    const { ok, reason } = await deleteRunPodPod(fetch, apiKey, podId, 15_000)
    if (!ok) {
      log.warn('pod delete failed', { podId, reason })
    } else {
      log.info('pod terminated', { podId })
    }
  } catch (err) {
    log.warn('pod terminate error', { podId, error: (err as Error).message })
  }
}

/**
 * List all pods on the account. Used for startup reconciliation.
 * Returns empty array on error so callers can proceed without crashing.
 */
export async function listRunPodPods(apiKey: string): Promise<Array<{ id: string; name: string; desiredStatus: string }>> {
  try {
    const res = await fetch(`https://api.runpod.io/graphql?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ myself { pods { id name desiredStatus } } }' }),
    })
    const data = await res.json() as { data?: { myself?: { pods?: Array<{ id: string; name: string; desiredStatus: string }> } } }
    return data.data?.myself?.pods ?? []
  } catch {
    return []
  }
}
