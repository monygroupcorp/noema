// =============================================================================
// modelLicense — base-model → { family, license } classification (compliance)
// =============================================================================
//
// `familia` is the COMPATIBILITY axis (architecture — which base flow a LoRA stacks
// on). LICENSE is a DIFFERENT axis that `familia` collapses, and the collapse is
// license-critical: FLUX.1-schnell (Apache 2.0, commercial ✅) and FLUX.1-dev (BFL
// Non-Commercial, ❌) are the SAME `familia:'flux'`. So the family key cannot carry
// the license — we classify both here and record them separately on the Intella.
//
// Ground truth: the Model license register in docs/legal/compliance-landscape.md
// plus the per-seed license notes in seeds/intellae.ts. Commercial-catalog use
// requires a ✅ (`commercial:'yes'`); everything else is fail-closed.
//
// ENFORCEMENT SPLIT (`docs/spec/model-import.md`): a PRIVATE import is always allowed —
// personal, non-commercial use of a non-commercially-licensed model is fine. The
// license is enforced only at PUBLIC PROMOTION (the shared catalog is a commercial
// surface): only `commercial:'yes'` auto-promotes; 'no'/'conditional'/'unknown' are
// refused (fail-closed) pending a held license / manual clearance.
// =============================================================================

/** Catalog-eligibility verdict for a license. Only 'yes' clears the public (commercial) catalog. */
export type CommercialVerdict = 'yes' | 'no' | 'conditional' | 'unknown'

/** A base-model classification: the compat family (null = no base flow → not importable) + license id. */
export interface BaseClassification {
  familia: string | null
  /** A stable license id (see LICENSE_COMMERCIAL). 'unknown' when we can't vouch for it. */
  license: string
}

/**
 * Commercial-catalog verdict per license id. Fail-closed: an id not listed here is 'unknown'
 * (NOT auto-catalog-eligible). Grounded in docs/legal/compliance-landscape.md §"Model license
 * register" + the seed license notes.
 */
const LICENSE_COMMERCIAL: Record<string, CommercialVerdict> = {
  'apache-2.0': 'yes',
  'mit': 'yes',
  'openrail-m': 'yes',            // SD1.5 / SDXL — ✅ with flow-down use restrictions (T&C-bound)
  'fair-ai-public': 'yes',        // Pony Diffusion (Fair AI Public License 1.0-SD)
  'flux-1-dev-nc': 'no',          // BFL FLUX.1 [dev] Non-Commercial — ❌ unless separately licensed
  'flux-2-dev-nc': 'no',          // BFL FLUX.2 [dev] + [klein] 9B Non-Commercial (only klein 4B is Apache)
  'closed': 'no',                 // FLUX.1 pro / API-only — not self-hostable
  'cc-by-nc': 'no',               // any non-commercial Creative Commons variant
  'minimax-h3': 'no',             // MiniMax H3 — restrictive in the US; ❌ unless separately
                                  // licensed. Mony Group LLC holds a US operating licence
                                  // (rth 2026-09-01), so the CANONICAL H3 seeds carry an
                                  // explicit commercialUse:'yes'. This entry governs THIRD-PARTY
                                  // imports, which our grant does not cover — keep it 'no'.
  'stability-community': 'conditional',  // SD3/3.5, SDXL-Turbo — revenue/entity thresholds; verify
  'krea-community': 'conditional',       // Krea 2 Community — commercial only for entities <$1M revenue
  'unknown': 'unknown',
}

/** Catalog-eligibility verdict for a license id (fail-closed to 'unknown'). */
export function licenseCommercial(license: string | undefined): CommercialVerdict {
  if (!license) return 'unknown'
  return LICENSE_COMMERCIAL[license] ?? 'unknown'
}

/**
 * The PUBLIC-CATALOG admission policy over a commercial verdict — the single place the "may this
 * list publicly?" decision lives. 'yes' AND 'conditional' pass: conditional licenses (SD3/3.5,
 * Krea 2 <$1M) are fine while we're under their revenue/entity thresholds — a company-wide
 * trailing-12mo USD revenue TRIPWIRE (see `licenseTripwire.ts` + `CONDITIONAL_CAP_USD` below)
 * watches that revenue against the tightest active cap and alerts before we cross it, so counsel
 * can pre-negotiate an enterprise license (ADR-0012). 'no'/'unknown' are refused (fail-closed)
 * pending an admin license clearance (see the backfill path).
 */
export function isCatalogEligible(verdict: CommercialVerdict | undefined): boolean {
  return verdict === 'yes' || verdict === 'conditional'
}

// ── Conditional-license revenue caps (the tripwire's registry) ───────────────────────────────
//
// A `conditional` license admits a model to the public catalog only while the COMPANY-WIDE
// trailing-12-month USD revenue stays under a ceiling (ADR-0012). This is a property of *us*, not
// of the model's usage — so every conditional cap is compared against the SAME single scalar `R`
// (see docs/spec/conditional-license-revenue.md, "The crystal reduction"). This registry maps a
// conditional license id → that ceiling, in WHOLE US DOLLARS. Keeping it beside LICENSE_COMMERCIAL
// keeps modelLicense.ts the one source of "what does this license permit, and at what ceiling".

/**
 * USD revenue ceiling per conditional license id (WHOLE dollars). Only licenses that resolve to
 * `conditional` belong here; 'yes' licenses have no cap, and 'no'/'unknown' never reach the catalog
 * so never bind. **[counsel]** the Stability figure/semantics (revenue-or-headcount) must be
 * confirmed against the current Stability Community License before this is treated as authoritative.
 */
export const CONDITIONAL_CAP_USD: Record<string, number> = {
  'krea-community': 1_000_000,        // ADR-0012: commercial only for entities <$1M total revenue, trailing 12mo
  'stability-community': 1_000_000,   // SD3/3.5, SDXL-Turbo — entity revenue threshold [counsel: verify exact figure]
}

/** The USD cap (whole dollars) a license binds at, or undefined if the license carries no cap. */
export function conditionalCapUsd(license: string | undefined): number | undefined {
  if (!license) return undefined
  return CONDITIONAL_CAP_USD[license]
}

/**
 * The tightest (minimum) USD cap among the given active conditional license ids — the binding cap.
 * Returns null when NONE of them carry a cap (the tripwire is then dormant: ∞ ceiling). Licenses
 * with no cap entry are ignored. The minimum wins because the strictest license is the one we'd
 * breach first.
 */
export function bindingCapUsd(licenses: Iterable<string>): number | null {
  let min: number | null = null
  for (const lic of licenses) {
    const cap = CONDITIONAL_CAP_USD[lic]
    if (cap === undefined) continue
    if (min === null || cap < min) min = cap
  }
  return min
}

/** The doc-shaped subset the active-cap query reads off a stored model (a runtime Intella satisfies it). */
export interface CatalogLicenseView {
  commercialUse?: CommercialVerdict
  license?: string
  access?: 'public' | 'private'
  canonica?: boolean
}

/**
 * From a set of stored models, the DISTINCT conditional license ids that are ACTUALLY reachable in
 * the public (commercial) catalog — i.e. publicly listed (`access:'public'` OR `canonica:true`),
 * catalog-eligible, verdict `conditional`, and carrying a known cap. This is the set the tripwire
 * feeds to `bindingCapUsd`. A model whose `commercialUse` isn't stored is classified on the fly from
 * its `license` so a legacy record that only carries a license id still counts. Private/unlisted
 * conditional models don't bind (they're not on the commercial surface).
 */
export function activeConditionalLicenses(models: Iterable<CatalogLicenseView>): string[] {
  const active = new Set<string>()
  for (const m of models) {
    const verdict = m.commercialUse ?? licenseCommercial(m.license)
    if (verdict !== 'conditional') continue
    const isPublic = m.access === 'public' || m.canonica === true
    if (!isPublic) continue
    if (!m.license || CONDITIONAL_CAP_USD[m.license] === undefined) continue
    active.add(m.license)
  }
  return [...active]
}

/**
 * A short, user-facing note on what a model's license means for the owner — surfaced on a training
 * receipt, an import result, and the model card, so the "why can't I list this?" answer travels
 * WITH the model. Frames it as use vs listing: everything is usable privately; only some may be
 * promoted to the public (commercial) catalog.
 */
export function licenseNote(commercialUse: CommercialVerdict | undefined, license?: string): string {
  const lic = license && license !== 'unknown' ? ` (${license})` : ''
  switch (commercialUse) {
    case 'yes':
      return `✅ Commercially listable${lic} — you can publish this to the public catalog.`
    case 'conditional':
      return `⚠️ Conditionally listable${lic} — the license has revenue/entity thresholds; usable privately and publishable while under them.`
    case 'no':
      return `🔒 Private use only — trained on a non-commercial base${lic}. Usable in your own flows, but not listable on the public catalog.`
    default:
      return `🔒 Private use only for now — the base license${lic} is unverified. Usable privately; listing needs a license review.`
  }
}

// The family+license table, ORDERED most-specific-first. Each row: a matcher over the lowercased
// base string, the compat `familia` (null = no base flow, reject), and the license id. Order is
// load-bearing (variant checks before the bare family; 'kontext'/'flux2' before 'flux').
const BASE_TABLE: Array<{ test: (t: string) => boolean; familia: string | null; license: string }> = [
  // FLUX.1 Kontext — a FLUX.1-family edit model on the shared FLUX base stack (existing flux.1
  // LoRAs apply). Must precede 'flux' ("Flux.1 Kontext" ⊃ 'flux') so it keeps its own NC license
  // instead of falling through to the bare-flux row.
  { test: (t) => t.includes('kontext'), familia: 'flux', license: 'flux-1-dev-nc' },
  // FLUX.2 — a new family (before 'flux'). Variant AND SIZE drive the license (confirmed against the
  // FLUX.2 [klein] 4B HF card + bfl.ai): ONLY klein 4B is Apache 2.0 (✅); klein 9B and [dev] are the
  // FLUX Non-Commercial License (❌ — our seed INTELLA_FLUX2_KLEIN_9B is the 9B, so it is NC). A klein
  // with no stated size is fail-closed to NC (the restrictive default); a bare flux2 → unknown.
  { test: (t) => isFlux2(t) && t.includes('klein') && is4b(t), familia: 'flux2', license: 'apache-2.0' },
  { test: (t) => isFlux2(t) && (t.includes('klein') || isDev(t)), familia: 'flux2', license: 'flux-2-dev-nc' },
  { test: (t) => isFlux2(t), familia: 'flux2', license: 'unknown' },
  // FLUX.1 — the license hinges on the VARIANT. schnell = Apache ✅, dev = Non-Commercial ❌.
  { test: (t) => isFlux(t) && isSchnell(t), familia: 'flux', license: 'apache-2.0' },
  { test: (t) => isFlux(t) && isDev(t), familia: 'flux', license: 'flux-1-dev-nc' },
  // Bare FLUX with no variant stated → we cannot assume schnell. Unknown (fail-closed).
  { test: (t) => isFlux(t), familia: 'flux', license: 'unknown' },
  // SDXL family (architecturally sdxl → stacks on the sdxl base flow).
  { test: (t) => t.includes('pony'), familia: 'sdxl', license: 'fair-ai-public' },
  { test: (t) => t.includes('illustrious') || t.includes('noobai'), familia: 'sdxl', license: 'unknown' },
  { test: (t) => isSdxl(t) && (t.includes('turbo') || t.includes('lightning')), familia: 'sdxl', license: 'stability-community' },
  { test: (t) => isSdxl(t), familia: 'sdxl', license: 'openrail-m' },
  // SD 1.5.
  { test: (t) => t.includes('sd1.5') || t.includes('sd 1.5') || t.includes('sd-1.5') || t.includes('sd15') || t.includes('v1-5'), familia: 'sd15', license: 'openrail-m' },
  // Newer self-hosted families with a base flow.
  { test: (t) => t.includes('chroma'), familia: 'chroma', license: 'apache-2.0' },
  { test: (t) => t.includes('krea'), familia: 'krea2', license: 'krea-community' },
  { test: (t) => t.includes('z-image') || t.includes('zimage') || t.includes('z image'), familia: 'zimage', license: 'apache-2.0' },
  // SD 2.x / SD 3.x — real models, but NO base flow yet → not importable (familia null).
  { test: (t) => t.includes('sd3') || t.includes('sd 3') || t.includes('sd2') || t.includes('sd 2'), familia: null, license: 'stability-community' },
]

/** Every `familia` BASE_TABLE can produce (nulls dropped) — the authoritative familia vocabulary the
 *  resolver keys on. Exported so other tables that must AGREE with it can be checked against it. */
export const BASE_FAMILIAE: ReadonlySet<string> = new Set(
  BASE_TABLE.map(r => r.familia).filter((f): f is string => f !== null),
)

/** Legacy v2 `params.baseIntellaId` → the compat `familia` the resolver keys on.
 *
 *  The v1→v2 LoRA migration (`src/migrations/loras/legacyToIntella.ts`) wrote the base into
 *  `params.baseIntellaId` and never populated `familia`. `MongoIntella.findByTrigger` /
 *  `triggerMap` key on `familia` with exact top-level equality, so those documents resolve to
 *  nothing. This table is the repair mapping.
 *
 *  Values MUST come from BASE_TABLE's vocabulary (see BASE_FAMILIAE — a hermetic test enforces it).
 *  `null` = no base flow exists for that architecture, so NO familia is correct (BASE_TABLE:193
 *  gives SD2/SD3 `familia: null` — the one entry that still uses it). An id absent from this map
 *  is an OPERATOR decision, never a worker/runtime guess — callers must report and skip it.
 *
 *  The migration's `baseIntellaId` values were never seeded as real catalog ids (see
 *  `scripts/migrations/2026_08_repair_lora_base_intella_id.ts`), so this table also carries the
 *  real catalog id each stale id was meant to name, mapped to the SAME `familia` — grouping gets
 *  fixed by repointing the pointer to a real id without moving what `familia` compat resolves to.
 */
export const FAMILIA_BY_BASE_INTELLA_ID: Record<string, string | null> = {
  'intella.flux-base':        'flux',
  'intella.sdxl-base':        'sdxl',
  'intella.illustrious-base': 'sdxl',   // BASE_TABLE:183 — illustrious/noobai collapse to sdxl
  'intella.pony-base':        'sdxl',   // BASE_TABLE:182 — pony is XL-derived, stacks on the sdxl flow
  'intella.sd15-base':        'sd15',
  'intella.kontext-base':     'flux',   // BASE_TABLE:168 — flux.1-family edit model, shares the flux base flow

  // Real catalog ids the four resolvable stale ids above repoint to. Same familia as their stale
  // counterpart — the repoint must not change what a record's compat familia resolves to.
  'intella.flux-schnell-fp8-scaled': 'flux',
  'intella.sdxl-base-1-0':           'sdxl',
  'intella.sd15-v1-5':               'sd15',
  'intella.flux-kontext-dev':        'flux',
}

/** True when `id` is a base intella this mapping KNOWS about. Callers must use this to tell "known
 *  base" apart from "unknown base, needs an operator decision"; `familiaFromBaseIntellaId` returns
 *  `null` for both an unknown id and a known-but-null one (see the SD2/SD3 `BASE_TABLE` row for the
 *  latter case, once a base-intella id maps to it).*/
export function isKnownBaseIntellaId(id: string | null | undefined): boolean {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(FAMILIA_BY_BASE_INTELLA_ID, id)
}

/** The compat `familia` for a legacy `params.baseIntellaId`, or `null` when there is none — which
 *  means EITHER the id is unknown OR it is known to have no base flow. Pair with
 *  `isKnownBaseIntellaId` to distinguish the two; never write on a `null` without that check. */
export function familiaFromBaseIntellaId(id: string | null | undefined): string | null {
  if (!isKnownBaseIntellaId(id)) return null
  return FAMILIA_BY_BASE_INTELLA_ID[id as string] ?? null
}

/**
 * Classify an external base-model string into its compat `familia` (null = no base flow) and its
 * license id. Exhaustive + ordered; anything unrecognised is `{ familia: null, license: 'unknown' }`.
 */
export function classifyBaseModel(base: string): BaseClassification {
  const t = (base ?? '').toLowerCase().trim()
  if (!t) return { familia: null, license: 'unknown' }
  for (const row of BASE_TABLE) {
    if (row.test(t)) return { familia: row.familia, license: row.license }
  }
  return { familia: null, license: 'unknown' }
}

// ── Classify a STORED model (reclassify path + backfill sweep share this) ────────────────────

/**
 * The doc-shaped subset a stored model carries that we can derive a license from — a runtime
 * `Intella` or a raw Mongo doc both satisfy it. Kept structural so the migration/sweep (which sees
 * plain BSON) and the API (which sees a typed `Intella`) call ONE classifier.
 */
export interface LicenseClassifiable {
  baseModel?: string
  provenance?: { base?: string } | null
  nomen?: string
  familia?: string | null
}

/**
 * Derive `{ license, commercialUse }` for an already-stored model from the most trustworthy base
 * string it carries. Priority: `baseModel` (the literal resolved training/import-time source of
 * truth — see docs/spec/model-base-provenance.md) > `provenance.base` (author-declared EXTERNAL
 * retrain lineage, e.g. 'FLUX.1-dev' — a different statement than `baseModel`) > `nomen`
 * (descriptive title, e.g. 'FLUX.1 Schnell (fp8 scaled)') > `familia` (the compat key — bare,
 * license-ambiguous: 'flux' can't tell schnell from dev, so it's the last resort → 'unknown').
 * A record written before `baseModel` existed simply lacks it and falls through the chain
 * unchanged — fail-closed, same as any other unclassifiable case here.
 *
 * This is the single source for BOTH the admin `reclassify` path (`CrystalApi.setModelLicense`) and
 * the license backfill sweep, so a model gets the same verdict whichever runs it. Fail-closed: an
 * unrecognised base yields `{ license:'unknown', commercialUse:'unknown' }` (NOT catalog-eligible).
 */
export function classifyModelLicense(m: LicenseClassifiable): { license: string; commercialUse: CommercialVerdict } {
  const base = m.baseModel || m.provenance?.base || m.nomen || m.familia || ''
  const license = classifyBaseModel(base).license
  return { license, commercialUse: licenseCommercial(license) }
}

// ── Origin-stated license (the imported artifact's OWN license may be stricter than its base) ──

/**
 * Map a HuggingFace `cardData.license` string to our license id. HF uses SPDX-ish ids
 * ('apache-2.0', 'mit', 'creativeml-openrail-m', 'cc-by-nc-4.0', 'other', …).
 */
export function hfLicenseToId(license: unknown): string {
  const l = String(license ?? '').toLowerCase()
  if (!l) return 'unknown'
  if (l.includes('apache')) return 'apache-2.0'
  if (l === 'mit') return 'mit'
  if (l.includes('openrail')) return 'openrail-m'
  if (l.includes('-nc') || l.includes('noncommercial') || l.includes('non-commercial')) return 'cc-by-nc'
  if (l.includes('flux-1-dev') || l.includes('flux.1-dev')) return 'flux-1-dev-nc'
  if (l.includes('stabilityai') || l.includes('stability')) return 'stability-community'
  return 'unknown'
}

/**
 * Civitai's per-model commercial permission. The field is either a legacy boolean or an array of
 * allowed uses (e.g. ["Image","Rent","Sell"] vs ["None"]). We only care whether ANY paid use is
 * permitted → a 'yes'/'no'/'unknown' verdict we fold into the final license decision.
 */
export function civitaiCommercial(model: Record<string, unknown>): CommercialVerdict {
  const raw = model.allowCommercialUse
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no'
  if (Array.isArray(raw)) {
    const uses = raw.map((u) => String(u).toLowerCase())
    if (uses.some((u) => ['sell', 'rent', 'rentcivit', 'image'].includes(u))) return 'yes'
    if (uses.length === 0 || uses.every((u) => u === 'none')) return 'no'
    return 'conditional'
  }
  return 'unknown'
}

/** Fold two verdicts, taking the MORE RESTRICTIVE (a derivative can't out-license its base). */
export function combineCommercial(a: CommercialVerdict, b: CommercialVerdict): CommercialVerdict {
  const rank: Record<CommercialVerdict, number> = { no: 0, conditional: 1, unknown: 2, yes: 3 }
  return rank[a] <= rank[b] ? a : b
}

// ── small predicates (shared, readable) ──────────────────────────────────────

function isFlux(t: string): boolean { return t.includes('flux') }
function isFlux2(t: string): boolean { return t.includes('flux.2') || t.includes('flux2') || t.includes('flux 2') }
function is4b(t: string): boolean { return t.includes('4b') || t.includes('4-b') || t.includes('4 b') }
function isSchnell(t: string): boolean { return t.includes('schnell') || /\bflux\.?1?\s*\[?s(chnell)?\]?\b/.test(t) || t.includes('.1 s') || t.includes('.1s') }
function isDev(t: string): boolean { return t.includes('dev') || t.includes('.1 d') || t.includes('.1d') || t.includes('[d]') }
function isSdxl(t: string): boolean { return t.includes('sdxl') || t.includes('sd_xl') || t.includes('sd-xl') || t.includes('stable-diffusion-xl') || t.includes('sd xl') }
