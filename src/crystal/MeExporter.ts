// =============================================================================
// MeExporter — assemble the CALLER'S OWN account data into one self-scoped bundle.
// =============================================================================
//
// The single, auditable home for the GDPR self-export egress (T1-export). Its ONLY
// job is to gather the caller's rows across the owner-scoped finders into a structured
// JSON bundle and (optionally) host it behind a short-lived, unguessable signed GET URL.
//
// SELF-SCOPED BY CONSTRUCTION — the safety invariant this whole class exists to hold:
//   • Every finder is keyed by the caller's own identity. We derive the three possible
//     discriminants ONCE (`animaId` / `commitment` / `ownerKey`) and only ever call a
//     finder with the caller's own key — never a raw argument that could widen scope.
//   • `animaId`-only finders are simply SKIPPED for anon (`commitment`/`bursaToken`)
//     callers — an anon soul holds no identified PII, so those collections are
//     legitimately empty for it (not an error, not force-attributed).
//   • We NEVER pass an `undefined` discriminant into a query (that would match rows with
//     a missing field → a cross-user leak). Finders whose key isn't present on this
//     caller are guarded out entirely.
//
// DELIBERATELY EXCLUDED (see plan noema-024 + ADR-0013 §7):
//   • `Reditus` — the platform's identity-free USD revenue book; NOT the caller's data.
//   • The ZK anonymity set (`arcanum_leaves`/`arcanum_nullifiers`) — identity-free by
//     invariant; never queried here. (`Signum.history` returns only the caller's OWN
//     notes — `{animaId}` never matches an arcanum Signum, `{commitment}` matches only
//     the caller's own `testis`-keyed notes.)
//   • Password hashes / any other user's secrets — `credenta.findByAnimaId` strips the
//     hash at the DB; nothing else reads a secret store.
//
// Kept OFF the ~100-method CrystalApi facade on purpose: the sensitive egress logic lives
// in one small reviewable place instead of growing the money/PII surface.
// =============================================================================

import { createHash, randomUUID } from 'node:crypto'
import type { AuctorKey } from '../flow/types.js'
import { ownerKeyOf } from './ownerKey.js'
import type { ObjectStore } from './R2Uploader.js'
import type { Appearance, Generatio, Binding } from '../types/consuetudo.js'
import type { Personae } from '../types/persona.js'
import type { Credentum } from '../types/credentum.js'
import type { Provinciae } from '../types/provincia.js'
import type { Intellae } from '../types/intelligendi.js'
import type { Editiones, Editio } from '../types/editio.js'
import type { Memoria } from '../types/anima.js'
import type { Colloquium, Dictum } from '../types/colloquium.js'
import type { Vestigia } from '../types/vestigium.js'
import type { Bursa } from '../types/bursa.js'
import type { Signa } from '../types/significandi.js'
import type { Depositum } from '../types/catena.js'
import type { ActumIndex } from '../types/actumIndex.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:me-export')

// ── The minimal owner-scoped read slices MeExporter needs (structural — it never
//    depends on the full store interfaces, so the egress surface stays tiny). ────────
interface ConsuetudinumRead {
  resolveAppearance(owner: AuctorKey): Promise<Appearance | undefined>
  resolveGeneratio(owner: AuctorKey): Promise<Generatio | undefined>
  listBindings(owner: AuctorKey): Promise<Binding[]>
}
interface PersonaeRead { findByAnimaId(animaId: string): Promise<Personae> }
interface CredentaRead { findByAnimaId(animaId: string): Promise<Omit<Credentum, 'passwordHash'> | null> }
interface ProvinciaeRead { listByOwner(animaId: string): Promise<Provinciae> }
interface ActumIndexRead { findFor(key: AuctorKey): Promise<ActumIndex[]> }
interface IntellaeRead { listByOwner(ownerKey: string): Promise<Intellae> }
interface EditionesRead { listByAuthor(by: Editio['by']): Promise<Editiones> }
interface MemoriaeRead { findByAnima(animaId: string): Promise<Memoria | null> }
interface ColloquiaRead { findByAnima(animaId: string): Promise<Colloquium[]> }
interface DictaRead { listByColloquium(colloquiumId: string): Promise<Dictum[]> }
interface VestigiaRead { forIdentity(auctorKey: AuctorKey, limit?: number): Promise<Vestigia> }
interface BursariumRead {
  listByOwner(animaId: string): Promise<Bursa[]>
  findByToken(token: string): Promise<Bursa | null>
}
interface SignorumRead { history(by: { animaId: string } | { commitment: string }): Promise<Signa> }
interface DepositaRead { list(filter?: Partial<Pick<Depositum, 'status' | 'animaId'>>): Promise<Depositum[]> }

export interface MeExporterDeps {
  store: ObjectStore
  consuetudinum: ConsuetudinumRead
  personae: PersonaeRead
  credenta: CredentaRead
  provinciae: ProvinciaeRead
  actumIndex: ActumIndexRead
  intellae: IntellaeRead
  editiones: EditionesRead
  memoriae: MemoriaeRead
  colloquia: ColloquiaRead
  dicta: DictaRead
  vestigiorum: VestigiaRead
  bursarium: BursariumRead
  signorum: SignorumRead
  deposita: DepositaRead
}

/** The self-scoped bundle. Every array is the caller's OWN rows; identity-scoped
 *  collections are `[]`/`null` for an anon caller that legitimately has none. */
export interface ExportBundle {
  manifest: {
    kind: 'noema-account-export'
    version: 1
    exportedAt: string
    /** Opaque owner key the bundle was scoped to (never a raw bearer secret). */
    ownerKey: string
    /** Which discriminant identified the caller (for the reader's context). */
    scopedBy: 'animaId' | 'commitment' | 'bursaToken'
  }
  account: { appearance: Appearance | null; generatio: Generatio | null; bindings: Binding[] }
  personae: Personae
  credentum: Omit<Credentum, 'passwordHash'> | null
  projects: Provinciae
  runs: ActumIndex[]
  models: Intellae
  editions: Editiones
  memoria: Memoria | null
  colloquia: Colloquium[]
  dicta: Dictum[]
  vestigia: Vestigia
  purses: Bursa[]
  signa: Signa
  deposita: Depositum[]
}

export interface ExportResult {
  /** Short-lived, unguessable signed GET URL to the hosted bundle. The ONLY handle the
   *  caller ever receives — the raw object key is deliberately NOT returned, so the response
   *  cannot be turned into a stable/reconstructable path to the PII bundle. */
  url: string
  /** Seconds until the signed URL expires. */
  expiresIn: number
  /** Size of the serialized JSON bundle in bytes. */
  bytes: number
}

/** Default signed-URL lifetime (15 min) — long enough to click-download, short enough
 *  that a leaked link lapses fast. Overridable per call. */
const DEFAULT_EXPIRES_IN = 900

export class MeExporter {
  constructor(private readonly deps: MeExporterDeps) {}

  /**
   * Assemble the caller's own data across every export-list collection. Pure of R2 —
   * the safety-critical core, unit-tested for zero cross-user leakage.
   */
  async assemble(auctor: AuctorKey): Promise<ExportBundle> {
    const ownerKey = ownerKeyOf(auctor)
    const animaId = 'animaId' in auctor ? auctor.animaId : undefined
    const commitment = 'commitment' in auctor ? auctor.commitment : undefined
    const scopedBy: ExportBundle['manifest']['scopedBy'] =
      'animaId' in auctor ? 'animaId' : 'commitment' in auctor ? 'commitment' : 'bursaToken'

    const d = this.deps

    // Account settings — keyed by the full AuctorKey, valid for every caller kind.
    const [appearance, generatio, bindings] = await Promise.all([
      d.consuetudinum.resolveAppearance(auctor),
      d.consuetudinum.resolveGeneratio(auctor),
      d.consuetudinum.listBindings(auctor),
    ])

    // Owner-key-scoped: models (Bursa-capable owner key).
    const models = await d.intellae.listByOwner(ownerKey)

    // Runs: findFor internally scopes by animaId|commitment and returns [] for bursaToken.
    const runs = await d.actumIndex.findFor(auctor)

    // Vestigia: keyed by animaId|commitment ONLY — never call with a bursaToken (its query
    // maps to `commitment: undefined`, which would match foreign rows). Skip for bursaToken.
    const vestigia = animaId !== undefined || commitment !== undefined
      ? await d.vestigiorum.forIdentity(auctor)
      : []

    // Publications + arcanum credit notes: by {animaId} or {commitment}; none for bursaToken.
    const editionBy: Editio['by'] | undefined =
      animaId !== undefined ? { animaId } : commitment !== undefined ? { commitment } : undefined
    const editions = editionBy ? await d.editiones.listByAuthor(editionBy) : []
    const signumBy = animaId !== undefined ? { animaId } : commitment !== undefined ? { commitment } : undefined
    const signa = signumBy ? await d.signorum.history(signumBy) : []

    // ── Identified-only (animaId-keyed) collections — empty for anon souls. ──────────
    let personae: Personae = []
    let credentum: Omit<Credentum, 'passwordHash'> | null = null
    let projects: Provinciae = []
    let memoria: Memoria | null = null
    let colloquia: Colloquium[] = []
    let dicta: Dictum[] = []
    let deposita: Depositum[] = []
    let purses: Bursa[] = []

    if (animaId !== undefined) {
      ;[personae, credentum, projects, memoria, colloquia, deposita, purses] = await Promise.all([
        d.personae.findByAnimaId(animaId),
        d.credenta.findByAnimaId(animaId),
        d.provinciae.listByOwner(animaId),
        d.memoriae.findByAnima(animaId),
        d.colloquia.findByAnima(animaId),
        // MUST be list({animaId}) — the unfiltered list() returns EVERY user's deposits.
        d.deposita.list({ animaId }),
        d.bursarium.listByOwner(animaId),
      ])
      // Dicta are keyed by colloquiumId, so scope them to the caller's OWN colloquia only.
      const dictaLists = await Promise.all(colloquia.map(c => d.dicta.listByColloquium(c.id)))
      dicta = dictaLists.flat()
    } else if ('bursaToken' in auctor) {
      // An anon purse soul: its one purse, by token. No identified PII.
      const bursa = await d.bursarium.findByToken(auctor.bursaToken)
      purses = bursa ? [bursa] : []
    }

    return {
      manifest: {
        kind: 'noema-account-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        ownerKey,
        scopedBy,
      },
      account: { appearance: appearance ?? null, generatio: generatio ?? null, bindings },
      personae,
      credentum,
      projects,
      runs,
      models,
      editions,
      memoria,
      colloquia,
      dicta,
      vestigia,
      purses,
      signa,
      deposita,
    }
  }

  /**
   * Assemble → host the bundle in R2 under an owner-scoped, unguessable key → return a
   * short-lived signed GET URL. The store MUST be a dedicated PRIVATE bucket with no public
   * domain (wired from EXPORTS_R2, not the public outputs bucket) — then the signed URL is the
   * only handle and the expiry is a real control. The raw key is never returned to the caller.
   */
  async exportForCaller(auctor: AuctorKey, opts?: { expiresIn?: number }): Promise<ExportResult> {
    if (!this.deps.store.getSignedDownloadUrl) {
      throw new Error('object store cannot presign downloads — export unavailable')
    }
    const bundle = await this.assemble(auctor)
    const body = Buffer.from(JSON.stringify(bundle, bigintSafe, 2), 'utf8')

    // Owner-scoped namespace (hash the owner key so no raw id/secret lands in the path) +
    // a random object name → unguessable, non-enumerable.
    const scope = createHash('sha256').update(bundle.manifest.ownerKey).digest('hex').slice(0, 16)
    const key = `exports/${scope}/${randomUUID()}.json`
    await this.deps.store.put(key, body, 'application/json')

    const expiresIn = opts?.expiresIn ?? DEFAULT_EXPIRES_IN
    const url = await this.deps.store.getSignedDownloadUrl(key, { expiresIn })
    log.info('assembled account export', { scopedBy: bundle.manifest.scopedBy, bytes: body.byteLength })
    return { url, expiresIn, bytes: body.byteLength }
  }
}

/** JSON replacer — Signum/Depositum carry bigint amounts; serialize them as strings. */
function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}
