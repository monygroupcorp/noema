// =============================================================================
// loadOfacBlocklist — read the OFAC SDN crypto-address list from disk
// =============================================================================
//
// The blocklist is a JSON array of 0x-prefixed wallet addresses (any case),
// synced from the authoritative OFAC SDN set by scripts/refresh-ofac-blocklist.ts.
// Kept as a plain file (not code) so it can be refreshed on a schedule without a
// deploy. Path comes from OFAC_BLOCKLIST_PATH; returns [] if the file is absent
// or malformed (the container decides the fail-open/closed policy, loudly).
// =============================================================================

import { readFileSync } from 'node:fs'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('ofac-blocklist')

export function loadOfacBlocklist(path: string): string[] {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      log.error('OFAC blocklist is not a JSON array', { path })
      return []
    }
    const addresses = parsed.filter((a): a is string => typeof a === 'string' && a.startsWith('0x'))
    log.info('OFAC blocklist loaded', { path, count: addresses.length })
    return addresses
  } catch (err) {
    log.error('OFAC blocklist load failed', { path, error: err instanceof Error ? err.message : String(err) })
    return []
  }
}
