// =============================================================================
// Erasure — GDPR Art. 17 right-to-erasure types (noema-025).
// =============================================================================
//
// DELETE /v1/me pseudonymize-and-tombstones the caller's OWN account: sever the
// person (PII on the Anima) while RETAINING the anonymized financial rows. Two small
// contracts live here — the erased-account denylist (session revocation) and the
// receipt the endpoint returns.
// =============================================================================

/**
 * ErasedDenylistStore — the erased-account (session-revocation) denylist, keyed by `animaId`.
 *
 * noema sessions are stateless HS256 JWTs verified by signature only, so tombstoning an Anima
 * does NOT invalidate a live token on its own. This tiny store is the missing revocation seam:
 * `eraseMe` ADDS the erased `animaId`; `verifyJwt` CONSULTS it and rejects any session whose
 * subject is on it (a 401/invalid). It is erasure/ban-scoped ONLY — NOT a general
 * "logout-all-devices"/stolen-token system (that remains a separate security-posture item).
 * Small by construction (only erased/banned souls), so a membership check stays cheap/indexed.
 */
export interface ErasedDenylistStore {
  /** Add an `animaId` to the denylist. Idempotent — re-adding an already-listed soul is a no-op. */
  add(animaId: string): Promise<void>
  /** Whether this `animaId` has been erased/banned → its sessions must be rejected. */
  has(animaId: string): Promise<boolean>
}

/**
 * ErasureReceipt — the truthful result of an erasure. Reports per-collection hard-delete counts
 * and the tombstone/retention stamps. Deliberately does NOT claim "everything deleted": the
 * financial ledger + published works are RETAINED (anonymized via the tombstone), so the copy
 * never overclaims (the privacy-truthfulness bar noema-108 set).
 */
export interface ErasureReceipt {
  /** The opaque anchor retained (non-identifying once the Anima is tombstoned). */
  animaId: string
  /** When the tombstone/erasure was applied (ISO instant). */
  erasedAt: string
  /** Retention horizon for the tombstone anchor = erasedAt + 7y (ISO instant). */
  retentionUntil: string
  /** Per-collection rows hard-deleted (identity/content — no retention duty). */
  deleted: {
    personae: number
    credenta: number
    consuetudines: number
    memoriae: number
    provinciae: number
    petitiones: number
    colloquia: number
    dicta: number
  }
  /**
   * The load-bearing retention truths surfaced to the caller (and the confirmation copy):
   * the financial ledger and published works SURVIVE, anonymized via the tombstone.
   */
  retained: {
    /** Signum/deposita/reditus rows left entirely untouched (immutable tax/accounting record). */
    financialLedger: 'untouched'
    /** Published works stay live; author ref is non-identifying via the tombstone (no rewrite). */
    publishedWorks: 'anonymized-in-place'
  }
}
