// =============================================================================
// BehaviourEvent — a non-run visitor action, bolted onto the crystal as plain
// infrastructure, the same way WideEvent is (see src/lib/wide.ts): neither is
// a declined Latin noun, because neither is a domain primitive a flow or a
// studio reasons about. It is observability, scoped by ADR-0001 to stay out
// of the crystal's own vocabulary.
// =============================================================================
//
// WideEvent answers "what happened to a run" (completed/failed). BehaviourEvent
// answers "what did a visitor do on the way to, or instead of, a run" — the
// events that let the corpus show where someone stopped. Both are keyed the
// same way (ownerKeyOf(AuctorKey)) so the two tables can be joined by owner.
//
// PRIVACY INVARIANTS (see docs/legal/privacy-policy.md §2g/§2h):
//   - No IP address ever appears on this type or is passed to buildBehaviourEvent.
//   - No raw user-agent string ever appears on this type. `device` is always a
//     DeviceBucket, derived (deriveDeviceBucket) and discarded from its raw input
//     before this type is constructed. The one place a raw UA is persisted at all
//     is the existing Querela bug-report path (src/types/Querela.ts) — unrelated
//     to this type and not touched by it.
// =============================================================================

import type { DeviceBucket } from '../lib/deviceBucket.js'
import type { AuctorKey } from '../flow/types.js'
import { ownerKeyOf } from '../crystal/ownerKey.js'

/**
 * The non-run event vocabulary. Deliberately small and closed — a new kind is
 * a code change here, not a free-form string a caller can invent, so the
 * corpus can never silently grow an event the privacy policy doesn't describe.
 */
export const BEHAVIOUR_EVENT_KINDS = ['catalog_view', 'quote', 'sign_in', 'funding_attempt'] as const
export type BehaviourEventKind = typeof BEHAVIOUR_EVENT_KINDS[number]

/** Per-kind metadata whitelist — small, non-identifying, no free text. */
export interface BehaviourEventMeta {
  /** catalog_view / quote: which modus the visitor was browsing or pricing. */
  modusId?:  string
  /** sign_in: how the session was established. */
  method?:   'telegram' | 'wallet' | 'email' | 'password' | 'federated'
  /** funding_attempt: the package/amount the visitor started checkout for. */
  packageId?: string
}

export interface BehaviourEvent {
  kind:       BehaviourEventKind
  ts:         string
  /** Opaque pseudonymous key — see src/crystal/ownerKey.ts. Never a raw secret. */
  ownerKey:   string
  /** Present only for the animaId identity kind — an internal id, not a bearer secret. */
  animaId?:   string
  byType:     'animaId' | 'commitment' | 'bursaToken'
  platform?:  string
  device:     DeviceBucket
  meta?:      BehaviourEventMeta
}

export function buildBehaviourEvent(
  kind: BehaviourEventKind,
  auctor: AuctorKey,
  device: DeviceBucket,
  opts: { platform?: string; meta?: BehaviourEventMeta } = {},
): BehaviourEvent {
  return {
    kind,
    ts: new Date().toISOString(),
    ownerKey: ownerKeyOf(auctor),
    ...('animaId' in auctor ? { animaId: auctor.animaId } : {}),
    byType: 'animaId' in auctor ? 'animaId' : 'bursaToken' in auctor ? 'bursaToken' : 'commitment',
    ...(opts.platform ? { platform: opts.platform } : {}),
    device,
    ...(opts.meta ? { meta: opts.meta } : {}),
  }
}
