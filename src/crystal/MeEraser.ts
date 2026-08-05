// =============================================================================
// MeEraser — GDPR Art. 17 right-to-erasure for the CALLER'S OWN account (noema-025).
// =============================================================================
//
// The single, auditable home for the erasure act — the destructive twin of MeExporter.
// Its model is PSEUDONYMIZE-AND-TOMBSTONE, not hard-erase (operator rulings 2026-08-01):
// sever the PERSON while RETAINING the anonymized financial rows.
//
//   1. DENYLIST FIRST — add the animaId to the erased-account denylist so any live session
//      JWT is rejected immediately (stop further authenticated activity before mutating).
//   2. TOMBSTONE the Anima — the pseudonymization act: sever nomen/custos/wallet PII, mark
//      `erased`, stamp `retentionUntil = erasedAt + 7y` on the anchor. The opaque `id` stays
//      as the non-identifying key the immutable ledger + Stripe dispute resolver resolve against.
//   3. HARD-DELETE the pure identity/content collections (no retention duty): personae,
//      credenta, consuetudines, memoriae, provinciae, petitiones, colloquia (+ their dicta).
//
// DELIBERATELY UNTOUCHED (the load-bearing NON-actions — a reviewer checks these hold):
//   • The FINANCIAL LEDGER — `Signum`/`signa`, `solutiones`, `deposita` (incl. the wallet
//     ab/ad fields), and `reditus` are NEVER mutated. No ledger store is even wired into this
//     class, so it CANNOT touch them. Pseudonymization is achieved by the tombstone alone; the
//     `animaId` FK on those rows becomes an opaque, non-identifying key. This preserves the
//     append-only immutability contract AND keeps `stripeWebhook → findByTestis → animaId`
//     resolving to the tombstoned shell (a post-erasure chargeback still processes).
//   • PUBLISHED WORKS (intellae/editiones/scholia/canonica) — kept live with their existing
//     `animaId` author/owner ref and `Editio.owners[]` revenue split INTACT (no rewrite; the
//     tombstone makes the ref non-identifying). Royalties keep accruing to the tombstoned,
//     unclaimable anchor. The ONLY erasure-driven change for authorship is a FRONTEND render
//     guard (tombstoned author → "anonymous creator") — not a backend mutation, not here.
//   • The ZK ANONYMITY SET — `arcanum_leaves`, `nullifiers`, the arcanum/tessera Signa. These
//     are identity-free by invariant; no store touching them is wired here, so erasure cannot
//     reach or corrupt the anon set.
//
// IDEMPOTENT BY CONSTRUCTION — every step is `add`/`updateOne`/`deleteMany`, so re-running erase
// on a partially-erased account completes cleanly (never double-deletes, never errors).
//
// Kept OFF the ~100-method CrystalApi facade on purpose (like MeExporter): the irreversible
// money/PII surface lives in one small reviewable place. CrystalApi.eraseMe merely delegates.
// =============================================================================

import { ownerKeyOf } from './ownerKey.js'
import type { ErasedDenylistStore, ErasureReceipt } from '../types/erasure.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:me-erase')

/** Retention window for the tombstone anchor (operator ruling 2026-08-01). */
export const ERASURE_RETENTION_YEARS = 7

// ── Narrow structural deps — the minimal erase seams MeEraser needs. It never depends on the
//    full store interfaces, so the destructive surface stays tiny (mirror MeExporter). Each is
//    satisfied by the concrete Mongo store wired in index.ts. ─────────────────────────────────
interface AnimaTombstone {
  tombstone(animaId: string, stamp: { erasedAt: Date; retentionUntil: Date }): Promise<void>
}
interface PersonaeErase { deleteByAnima(animaId: string): Promise<number> }
interface CredentaErase { deleteByAnima(animaId: string): Promise<number> }
interface ConsuetudinumErase { deleteByAnima(animaId: string): Promise<number> }
interface MemoriaeErase { deleteByAnima(animaId: string): Promise<number> }
interface ProvinciaeErase { deleteByOwner(animaId: string): Promise<number> }
interface PetitionesErase { deleteByAnima(animaId: string): Promise<number> }
interface ColloquiaErase {
  listIdsByOwner(ownerKey: string): Promise<string[]>
  deleteByOwner(ownerKey: string): Promise<number>
}
interface DictaErase { deleteByColloquia(colloquiumIds: string[]): Promise<number> }

export interface MeEraserDeps {
  denylist: ErasedDenylistStore
  animae: AnimaTombstone
  personae: PersonaeErase
  credenta: CredentaErase
  consuetudinum: ConsuetudinumErase
  memoriae: MemoriaeErase
  provinciae: ProvinciaeErase
  petitiones: PetitionesErase
  colloquia: ColloquiaErase
  dicta: DictaErase
}

/** erasedAt + N years, in UTC (calendar-correct; leap years handled by Date). */
function addYears(from: Date, years: number): Date {
  const d = new Date(from.getTime())
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d
}

export class MeEraser {
  constructor(private readonly deps: MeEraserDeps) {}

  /**
   * Pseudonymize-and-tombstone the given identified soul. Self-only by construction: the caller
   * (CrystalApi.eraseMe) only ever passes the AUTHENTICATED caller's own `animaId`, so a caller
   * can never erase another owner. Returns a truthful receipt (retained financial ledger +
   * published works are reported honestly — never "everything deleted").
   */
  async erase(animaId: string): Promise<ErasureReceipt> {
    const d = this.deps
    const erasedAt = new Date()
    const retentionUntil = addYears(erasedAt, ERASURE_RETENTION_YEARS)
    const ownerKey = ownerKeyOf({ animaId })

    // 1. DENYLIST FIRST — revoke live sessions before mutating anything. Even if a later step
    //    fails, the account is already locked out (and a re-run is idempotent).
    await d.denylist.add(animaId)

    // 2. TOMBSTONE — the pseudonymization act (sever PII, stamp the 7y retention window). The
    //    opaque animaId anchor survives so the untouched financial ledger keeps resolving.
    await d.animae.tombstone(animaId, { erasedAt, retentionUntil })

    // 3. HARD-DELETE the pure identity/content collections. Colloquia → gather ids, delete their
    //    dicta (keyed by colloquiumId) FIRST so no orphan messages survive, then the colloquia.
    const colloquiumIds = await d.colloquia.listIdsByOwner(ownerKey)
    const dicta = await d.dicta.deleteByColloquia(colloquiumIds)
    const [personae, credenta, consuetudines, memoriae, provinciae, petitiones, colloquia] =
      await Promise.all([
        d.personae.deleteByAnima(animaId),
        d.credenta.deleteByAnima(animaId),
        d.consuetudinum.deleteByAnima(animaId),
        d.memoriae.deleteByAnima(animaId),
        d.provinciae.deleteByOwner(animaId),
        d.petitiones.deleteByAnima(animaId),
        d.colloquia.deleteByOwner(ownerKey),
      ])

    // 4. FINANCIAL LEDGER + published works + ZK set — untouched by construction (no store wired).

    const receipt: ErasureReceipt = {
      animaId,
      erasedAt: erasedAt.toISOString(),
      retentionUntil: retentionUntil.toISOString(),
      deleted: { personae, credenta, consuetudines, memoriae, provinciae, petitiones, colloquia, dicta },
      retained: { financialLedger: 'untouched', publishedWorks: 'anonymized-in-place' },
    }
    log.info('erased account (pseudonymize-and-tombstone)', {
      // animaId is an internal id, not a bearer credential — safe to log for the erasure audit trail.
      animaId,
      retentionUntil: receipt.retentionUntil,
      deleted: receipt.deleted,
    })
    return receipt
  }
}
