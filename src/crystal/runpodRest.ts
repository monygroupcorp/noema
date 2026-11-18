// =============================================================================
// runpodRest — the one place that knows where RunPod's REST API lives and what
// its pods look like on the wire.
// =============================================================================
//
// RunPod retired REST v1 (the `rest` subdomain, /v1) on 2026-11-15 and its host stopped
// resolving the next day. v2 (`api.runpod.io/v2`, OpenAPI at
// `https://api.runpod.io/v2/openapi.json`) differs in shape, not just in host:
//
//   - create takes ONE GPU type (`gpu: { id, count }`), not a preference list. RunPod
//     no longer searches for capacity, so the walk over candidates happens here.
//   - a CPU pod is `cpu: { id, vcpuCount }` (flavor + size), not `instanceIds`.
//   - a pod reports `status` (PROVISIONING / STARTING / RUNNING / EXITED / ERROR /
//     TERMINATED), not `desiredStatus`; SSH is `ssh.direct`, cost is `cost`.
//   - errors are RFC 9457 problem JSON: `{ title, status, detail, errors? }`.
//
// GraphQL (`api.runpod.io/graphql`) is a separate API and is untouched by this.
// =============================================================================

import { makeLogger } from '../lib/logger.js'

const log = makeLogger('runpod:rest')

export const RUNPOD_REST_BASE = 'https://api.runpod.io/v2'
export const RUNPOD_PODS_URL = `${RUNPOD_REST_BASE}/pods`
/** Retries of one candidate on a 429 or 5xx before the create gives up. */
const CREATE_TRANSIENT_RETRIES = 2
const CREATE_BACKOFF_MS = 2_000
const RETRY_AFTER_CAP_MS = 30_000

/** `Retry-After` in seconds, capped; the backoff base when it is absent or unreadable. */
function retryAfterMs(res: Response): number {
  const secs = Number(res.headers.get('retry-after'))
  return Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, RETRY_AFTER_CAP_MS) : CREATE_BACKOFF_MS
}

export const runpodPodUrl = (podId: string): string => `${RUNPOD_PODS_URL}/${podId}`

/** v2 `PodStatus`. */
export type RunPodStatus = 'PROVISIONING' | 'STARTING' | 'RUNNING' | 'EXITED' | 'ERROR' | 'TERMINATED'

interface RunPodSshEndpoint { host: string; port: number; username?: string }

/** The fields of a v2 `Pod` this codebase reads. */
export interface RunPodPod {
  id: string
  status?: RunPodStatus | string
  cost?: number
  dataCenterId?: string | null
  gpu?: { id?: string; count?: number } | null
  ssh?: { proxy?: RunPodSshEndpoint | null; direct?: RunPodSshEndpoint | null } | null
  runtime?: { ports?: Array<{ private?: number; public?: number | null; type?: string; ip?: string | null }> } | null
}

/**
 * Where the pod's sshd answers directly: `ssh.direct` when RunPod has published it, else the
 * live mapping for private port 22. The proxy endpoint is deliberately not used — it carries
 * an interactive shell only, and the bootstrap needs exec over a real connection.
 */
export function directSshOf(pod: RunPodPod): { host?: string; port?: number } {
  const direct = pod.ssh?.direct
  if (direct?.host && direct.port) return { host: direct.host, port: direct.port }
  const p22 = pod.runtime?.ports?.find(p => p.private === 22)
  return { host: p22?.ip ?? undefined, port: p22?.public ?? undefined }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Node's fetch reports a failed lookup as `TypeError('fetch failed')` with the cause one level down. */
function dnsCauseOf(err: unknown): { code: string; hostname?: string } | undefined {
  const cause = (err as { cause?: { code?: unknown; hostname?: unknown } } | undefined)?.cause
  const code = typeof cause?.code === 'string' ? cause.code : undefined
  if (code !== 'ENOTFOUND' && code !== 'EAI_AGAIN') return undefined
  return { code, hostname: typeof cause?.hostname === 'string' ? cause.hostname : undefined }
}

/**
 * fetch against RunPod with a timeout. A network failure is rethrown naming its cause: a host
 * that does not resolve says so, instead of arriving as a bare 'fetch failed'.
 */
export async function runpodFetch(fetchFn: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchFn(url, { ...init, signal: controller.signal })
  } catch (err) {
    const dns = dnsCauseOf(err)
    if (!dns) throw err
    const host = dns.hostname ?? new URL(url).hostname
    log.error('RunPod API host does not resolve', { host, code: dns.code, url })
    throw new Error(`RunPod API unreachable: DNS lookup for ${host} failed (${dns.code})`, { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

/** `"<status> <title>: <detail>"` from a v2 problem body, or the raw text when it is not one. */
export async function describeRunPodError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const p = JSON.parse(text) as { title?: string; detail?: string; errors?: unknown[] }
    if (p && (p.title || p.detail)) {
      const extra = Array.isArray(p.errors) && p.errors.length ? ` ${JSON.stringify(p.errors)}` : ''
      return `${res.status} ${p.title ?? ''}${p.detail ? `: ${p.detail}` : ''}${extra}`.trim()
    }
  } catch { /* not JSON */ }
  return `${res.status} ${text}`.trim()
}

/**
 * Create a pod from the first candidate body RunPod can place.
 *
 * RunPod v2 places exactly the GPU (or CPU flavor) named and never falls back, so a
 * preference list is walked here, one create per candidate, following the spec's retry
 * table: `400` (could not be placed) and `403` (no access to that pool) move on to the next
 * candidate; `429` waits out `Retry-After` and `5xx` backs off, both retrying the same
 * candidate a bounded number of times; `402` (no balance), `422` (malformed body) and every
 * other status throw at once, since another candidate would only repeat them. No `queue` is
 * ever sent, so a `202` (queued, no pod yet) is not a pod and is an error.
 */
export async function createRunPodPod(opts: {
  fetchFn: FetchLike
  apiKey: string
  candidates: Array<{ label: string; body: Record<string, unknown> }>
  timeoutMs: number
  what?: string
  /** Injected in tests; defaults to a real timer. */
  sleepFn?: (ms: number) => Promise<void>
}): Promise<RunPodPod> {
  const what = opts.what ?? 'pod'
  if (opts.candidates.length === 0) throw new Error(`RunPod ${what} provision failed: no candidates to try`)
  const refused: string[] = []
  const sleepFn = opts.sleepFn ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  for (const c of opts.candidates) {
    for (let retry = 0; ; retry++) {
      const res = await runpodFetch(opts.fetchFn, RUNPOD_PODS_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      }, opts.timeoutMs)
      if (res.status === 201 || res.status === 200) return await res.json() as RunPodPod
      if (res.status === 202) {
        throw new Error(`RunPod ${what} provision failed: request for '${c.label}' was queued (202), not placed`)
      }
      const reason = await describeRunPodError(res)
      const transient = res.status === 429 || res.status >= 500
      if (transient && retry < CREATE_TRANSIENT_RETRIES) {
        const waitMs = res.status === 429 ? retryAfterMs(res) : CREATE_BACKOFF_MS * 2 ** retry
        log.info('transient create failure, retrying the same candidate', { what, candidate: c.label, reason, waitMs })
        await sleepFn(waitMs)
        continue
      }
      if (res.status !== 400 && res.status !== 403) throw new Error(`RunPod ${what} provision failed: ${reason}`)
      log.info('candidate not placed, trying the next', { what, candidate: c.label, reason })
      refused.push(`'${c.label}': ${reason}`)
      break
    }
  }
  throw new Error(`RunPod ${what} provision failed: no candidate could be placed — ${refused.join('; ')}`)
}

/** Permanently terminate a pod. 404 counts as done: the pod is already gone. */
export async function deleteRunPodPod(fetchFn: FetchLike, apiKey: string, podId: string, timeoutMs: number): Promise<{ ok: boolean; reason?: string }> {
  const res = await runpodFetch(fetchFn, runpodPodUrl(podId), {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  }, timeoutMs)
  if (res.ok || res.status === 404) return { ok: true }
  return { ok: false, reason: await describeRunPodError(res) }
}
