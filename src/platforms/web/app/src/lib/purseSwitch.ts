// The one place a page decides whether the ZK bearer purse may be offered.
//
// `GET /arcanum/config` carries `enabled` (ANON_PURSE_ENABLED). Four pages read it — /pricing,
// the landing's anonymity panel, /funding and /vault — and each of them used to derive "is the
// purse off" for itself. Two of the four got it right and two did not: /pricing and the landing
// treated an unresolved fetch as off, while /funding read `enabled === false` and /vault required
// a loaded config, so both of them rendered the purse as a live feature for the whole window
// before the config arrived — which is the first paint of every visit — and /vault kept rendering
// it after a failed fetch, underneath its own "couldn't reach the anonymous-credit service"
// warning.
//
// The rule, stated once so a fifth page cannot get it wrong: UNKNOWN AND UNREACHABLE BOTH READ
// AS OFF. The honest failure for a privacy claim is to under-claim a protection, never to promise
// one we cannot confirm is switched on. Only an explicit `enabled: true` turns the offer on.

/** The `enabled` field as a page holds it: `null`/`undefined` while unread or unreachable. */
export type PurseSwitch = { enabled?: boolean } | null | undefined;

/**
 * True when no page may offer the purse as available — the switch says off, or nothing has said
 * it is on yet. Pass the config object, or `undefined` before the first response.
 */
export function purseIsOff(config: PurseSwitch): boolean {
  return config?.enabled !== true;
}
