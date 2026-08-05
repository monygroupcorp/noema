// =============================================================================
// agentCardFetcher — fetches + caches agent card metadata from CAMEL agent
// runtime hosts. Ported from legacy `src/core/services/agents/agentCardFetcher.js`.
// =============================================================================
//
// Preserves the legacy contract exactly: `GET https://{issuerDomain}/agents/{tokenId}/card`,
// a 5-minute in-memory cache, per-issuer base override via `AGENT_CARD_URL_OVERRIDE`
// (a JSON map of issuerDomain → base URL), a 10s timeout, and **null-on-any-failure**
// (network error, non-2xx, bad JSON, missing `profile`) — this never throws, so a
// caller can call it unconditionally without a try/catch.

export interface AgentCardProfile {
  name?: string
  description?: string
  image?: string
}

export interface AgentCard {
  profile: AgentCardProfile
  collection?: unknown
  agentId?: unknown
}

type FetchFn = typeof fetch

interface CacheEntry {
  data?: AgentCard
  expiresAt?: number
  promise?: Promise<AgentCard | null>
}

const TTL_MS = 300_000 // 5 minutes
const _cache = new Map<string, CacheEntry>()

/**
 * Fetches an agent card from `https://{issuerDomain}/agents/{tokenId}/card`.
 * Never throws — returns `null` on any non-2xx response or network/parse error.
 *
 * @param opts.fetchFn - injectable fetch, defaults to global `fetch` (tests only).
 */
export async function fetchAgentCard(
  issuerDomain: string,
  tokenId: string,
  opts: { fetchFn?: FetchFn } = {},
): Promise<AgentCard | null> {
  const fetchFn = opts.fetchFn ?? globalThis.fetch
  const key = `card:${issuerDomain}:${tokenId}`

  // 1. Cache warm hit.
  const entry = _cache.get(key)
  if (entry?.expiresAt && entry.expiresAt > Date.now()) {
    return entry.data ?? null
  }

  // 2. In-flight dedup.
  if (entry?.promise) return entry.promise

  // 3. Create and store the in-flight promise.
  const promise = _doFetch(issuerDomain, tokenId, key, fetchFn)
  _cache.set(key, { promise })
  return promise
}

function _resolveCardBase(issuerDomain: string): string {
  const overrideEnv = process.env.AGENT_CARD_URL_OVERRIDE
  if (overrideEnv) {
    try {
      const overrides = JSON.parse(overrideEnv) as Record<string, string>
      if (overrides[issuerDomain]) return overrides[issuerDomain].replace(/\/$/, '')
    } catch {
      // malformed override — fall through to the default host
    }
  }
  return `https://${issuerDomain}`
}

async function _doFetch(issuerDomain: string, tokenId: string, key: string, fetchFn: FetchFn): Promise<AgentCard | null> {
  const base = _resolveCardBase(issuerDomain)
  const url = `${base}/agents/${tokenId}/card`

  let response: Response
  try {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined
    response = await fetchFn(url, signal ? { signal } : {})
  } catch {
    _cache.delete(key)
    return null
  }

  if (!response.ok) {
    _cache.delete(key)
    return null
  }

  let result: AgentCard
  try {
    result = (await response.json()) as AgentCard
  } catch {
    _cache.delete(key)
    return null
  }

  if (!result || !result.profile) {
    _cache.delete(key)
    return null
  }

  _cache.set(key, { data: result, expiresAt: Date.now() + TTL_MS })
  setTimeout(() => _cache.delete(key), TTL_MS).unref()

  return result
}

/** Clears the module-level cache. Exposed for testing only. */
export function _clearCache(): void {
  _cache.clear()
}
