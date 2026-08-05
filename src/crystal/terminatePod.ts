import { makeLogger } from '../lib/logger.js'

const log = makeLogger('pod:terminate')

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

/**
 * Terminate a RunPod pod — stop then delete.
 * Errors are caught and logged; callers can rely on this being a best-effort fire-and-forget.
 */
export async function terminatePod(apiKey: string, podId: string): Promise<void> {
  const headers = { Authorization: `Bearer ${apiKey}` }
  try {
    await fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
      method: 'POST', headers,
    }, 15_000).catch(() => {})

    const res = await fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: 'DELETE', headers,
    }, 15_000)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      log.warn('pod delete failed', { podId, status: res.status, body: text })
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
