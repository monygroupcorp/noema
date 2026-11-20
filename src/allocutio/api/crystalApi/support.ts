// Module-level constants and pure helpers shared by the CrystalApi layers. The exported
// functions that were always part of the public surface are re-exported from CrystalApi.ts.

import type { Phasis } from '../../../types/progressus.js'
import type { Generatio } from '../../../types/consuetudo.js'
import type { Intellarum, Intella, IntellaContentRating } from '../../../types/intelligendi.js'
import type { StudioHandle } from '../../../crystal/Conductor.js'
import type { AuctorKey } from '../../../flow/types.js'
import type { Actum } from '../../../types/actum.js'
import { materiaStudioStatus } from '../../lexicon/status/aggregate.js'
import { Errors } from '../errors.js'
import type { ActivityKind, ActivityDoor } from '../types.js'
import type { ProvinciaResKind } from '../../../types/provincia.js'
import { makeLogger } from '../../../lib/logger.js'
import { grantConditionsLive, type GrantSafeguards } from '../../../crystal/modelLicense.js'
import type { CatalogSort, StudioView, ModelCard, TeeSessionView } from '../CrystalApi.js'

/**
 * The activity `kind` table: modusId → what the run produced.
 *
 * A TABLE, not a prefix rule — flows dispatched to a pod carry essentia-derived ids
 * (`flux-schnell`, …) that no prefix classifies. `Modus.verbum` is likewise not a
 * classifier here: `describe` cannot separate captioning from decomposition, and
 * training's `compose` is a self-declared fallback. Anything absent from this table
 * is reported as `generation` — an honest catch-all, not a guess about the flow.
 */
export const ACTIVITY_KIND_BY_MODUS: Readonly<Record<string, ActivityKind>> = {
  'modus.aitoolkit-training': 'training',
  'modus.dataset-caption': 'caption',
  'modus.dataset-decompose': 'decompose',
}

/** The activity kind for a modusId. Unknown flows are generations. */
export function activityKindFor(modusId: string): ActivityKind {
  return ACTIVITY_KIND_BY_MODUS[modusId] ?? 'generation'
}

/** Read a string field off a free-form record, or undefined when it is absent/not a string. */
export function str(rec: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = rec?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/**
 * The door for one run: id references into the canonical asset stores, read off the
 * Actum the row points at. A field the run did not produce is ABSENT — never guessed.
 *
 * Generations have no server-side artifact record to point at today (there is no
 * by-actum lookup on the trace store), so they carry at most the first media URL
 * already present in `exitus` — the same key-agnostic first-http(s)-value rule the
 * trace hook uses. Returns undefined when nothing is resolvable.
 */
export function activityDoorFor(
  kind: ActivityKind,
  aditus: Record<string, unknown> | undefined,
  exitus: Record<string, unknown> | undefined,
): ActivityDoor | undefined {
  const door: ActivityDoor = {}
  if (kind === 'training') {
    const modelId = str(exitus, 'loraId')
    const datasetId = str(aditus, 'dataset') ?? str(aditus, 'datasetId')
    if (modelId) door.modelId = modelId
    if (datasetId) door.datasetId = datasetId
  } else if (kind === 'caption') {
    const captionsetId = str(exitus, 'captionsetId')
    const datasetId = str(aditus, 'dataset') ?? str(aditus, 'datasetId')
    if (captionsetId) door.captionsetId = captionsetId
    if (datasetId) door.datasetId = datasetId
  } else if (kind === 'decompose') {
    const datasetId = str(aditus, 'dataset') ?? str(aditus, 'datasetId')
    const captionsetId = str(aditus, 'captionset') ?? str(aditus, 'captionsetId')
    if (datasetId) door.datasetId = datasetId
    if (captionsetId) door.captionsetId = captionsetId
  } else {
    const mediaUrl = Object.values(exitus ?? {}).find(
      (v): v is string => typeof v === 'string' && /^https?:\/\//.test(v),
    )
    if (mediaUrl) door.mediaUrl = mediaUrl
  }
  return Object.keys(door).length > 0 ? door : undefined
}

export const log = makeLogger('crystal-api')

export const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'

/** How long a provisioned TEE session may sit without /runner/ready before the
 *  watchdog fails it and kills the pod. Covers the confidential-CVM multi-minute
 *  boot and up to 3 RunPod WS-probe re-provision rounds (~5 min each). */
export const TEE_READY_WATCHDOG_MS = Number(process.env.TEE_READY_WATCHDOG_MS ?? 20 * 60_000)

/** TTL of a presigned read link for a private output. Long enough to load a page and open the
 *  original; short enough that a copied link is not a durable handle to private media. */
export const PRIVATE_PRESIGN_TTL_SECONDS = 15 * 60

/** The public-bucket prefix a publication's own copy of a private output is written under,
 *  keyed by the Editio (`editiones/<editioId>/<n>.<ext>`). The same prefix `BucketAdapter` hosts
 *  its media under, and for the same reason: these are publication-owned bytes, so a retract can
 *  recompute the key and delete them. */
export const PUBLICATION_COPY_PREFIX = 'editiones'

/** The cause recorded on a run the owner stops themselves (`POST /v1/runs/:id/cancel`, and each
 *  piece a collection cancel settles). It is only ever the cause when nothing more specific was
 *  recorded first — `completor.fail` keeps a cause already on the record and drops the caller's. */
export const CANCELLED_BY_OWNER = 'cancelled by the run owner'

/** Port keys a flow may use for its negative prompt (first present one is filled). */
export const NEGATIVE_PORT_KEYS = ['negative_prompt', 'negativePrompt', 'negative']

/** The gated ADULT `contentRating` set (noema-091). {suggestive, explicit} are hidden from the model
 *  catalog unless the caller has spicyMode on; {untriaged, sfw} (and unrated) are always visible. */
export const ADULT_CONTENT_RATINGS: ReadonlySet<IntellaContentRating> = new Set<IntellaContentRating>(['suggestive', 'explicit'])

export const CATALOG_SORTS: ReadonlySet<string> = new Set<string>(['newest', 'name', 'genus'])

/**
 * How many times a Muse session write re-reads and re-applies before giving up.
 *
 * Three, because the contention this absorbs is two writes overlapping — a roll
 * landing while the floor is being steered — and each retry starts from a read
 * taken after the previous winner landed. A caller that loses three in a row is
 * up against sustained write pressure, which is a retryable answer to give back
 * rather than a loop to keep spinning.
 */
export const MUSE_SESSION_SAVE_ATTEMPTS = 3

/** Normalise an untrusted `sort` value to a supported ordering. */
export function normalizeCatalogSort(sort: string | undefined): CatalogSort {
  return sort !== undefined && CATALOG_SORTS.has(sort) ? (sort as CatalogSort) : 'newest'
}

/**
 * The pool the public model catalog reads from: everything publicly visible — platform-canonical
 * intellae plus models users have published. Stores that implement `publicCatalog` serve it
 * directly; stores that do not (fakes, read-only registries) fall back to the canonical set, so a
 * registry never has to grow a method to keep working.
 */
export async function readPublicCatalog(registry: Intellarum, safeguards: GrantSafeguards): Promise<Intella[]> {
  const pool = registry.publicCatalog ? await registry.publicCatalog() : await registry.canonical()
  // A model under a licence we hold by conditional grant (MiniMax H3) leaves the public catalog
  // while the grant's conditions are not live: the grant does not cover us then.
  return pool.filter((i) => grantConditionsLive(i.license, safeguards))
}

/** Order a catalog page. Applied BEFORE any `limit` slice, so paging returns the intended page.
 *  `name` compares case-insensitively; `newest` is `natum` descending (undefined `natum` sorts
 *  last). `Array.prototype.sort` is stable, so equal keys keep their store order. */
export function sortCatalog(intellae: Intella[], sort: CatalogSort): Intella[] {
  const natumMs = (i: Intella): number => (i.natum ? new Date(i.natum).getTime() : Number.NEGATIVE_INFINITY)
  const copy = [...intellae]
  if (sort === 'name') return copy.sort((a, b) => a.nomen.toLowerCase().localeCompare(b.nomen.toLowerCase()))
  if (sort === 'genus') return copy.sort((a, b) => String(a.genus).localeCompare(String(b.genus)))
  return copy.sort((a, b) => natumMs(b) - natumMs(a))
}

/**
 * Layer the owner's account-level defaults under the cast-time aditus:
 * cast-time input > affines (per-modus) > generatio (cross-cutting) > modus defaults.
 * Only DECLARED ports (`modus.aditus`) are filled — a stale default never injects an
 * unknown input. `style` augments (prepends to) the final prompt rather than overriding it.
 */
export function applyAccountDefaults(
  ports: Record<string, unknown>,
  aditus: Record<string, unknown>,
  affines: Record<string, unknown> | undefined,
  generatio: Generatio | undefined,
): Record<string, unknown> {
  const account: Record<string, unknown> = {}
  // generatio (lowest account tier): fill a negative-prompt port if the flow has one.
  if (generatio?.negativePrompt) {
    const key = NEGATIVE_PORT_KEYS.find((k) => k in ports)
    if (key) account[key] = generatio.negativePrompt
  }
  // affines override generatio within the account tier — declared ports only.
  if (affines) {
    for (const [k, v] of Object.entries(affines)) if (k in ports) account[k] = v
  }
  // ── Lever (c): spicy-aware default-negative seam (noema-091) ────────────────
  // A future PLATFORM-injected SFW-forcing default negative (distinct from the user's OWN
  // `generatio.negativePrompt` handled above) would be assembled HERE, and MUST be relaxed/skipped
  // when spicy mode is on. Tracked `src/` has NO such platform default today, so this is a present-day
  // NO-OP against tracked code — a platform SFW default, if any, lives in the gitignored
  // `src/private/compliance/` layer this item cannot see or verify. The gate is structured now so any
  // future default is born spicy-aware; nothing is invented here to then "relax".
  if (generatio?.spicyMode !== true) {
    // (no tracked platform SFW-forcing default negative to inject yet — see the noema-091 PR notes)
  }
  // Cast-time input wins over every account default.
  const out = { ...account, ...aditus }
  // Default style prepends to the resolved prompt (augments, does not override).
  if (generatio?.style && typeof out.prompt === 'string' && out.prompt.length > 0) {
    out.prompt = `${generatio.style}, ${out.prompt}`
  }
  return out
}

/**
 * Keep the first item for each url and drop the rest.
 *
 * A media item's identity is the reference stored on it, not the uuid minted beside it: the
 * uuid is fresh every time, so two mints of one url are two items that nothing can tell apart
 * afterwards. Order is the caller's — first occurrence wins, so the earliest `addedAt` and the
 * earliest contributor are what the dataset keeps.
 */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)))
}

/** Shown to an anonymous caller connecting a BYO token — linking a named third-party account
 *  to an anonymous purse is a self-inflicted correlation. Their choice; we surface it. */
export const DEANON_WARNING =
  'Connecting a Civitai/HuggingFace token links your account there to this anonymous session on ' +
  'our backend. This weakens your anonymity. Use a token scoped to only what you need, and rotate it regularly.'

export function toStudioView(h: StudioHandle, budget: bigint): StudioView {
  const m = h.materia
  // No pod yet (async provisioning): status comes from the session (Modo) — `claiming`/
  // `warming` → `provisioning`; the pod fields are absent until it binds.
  if (!m) {
    return { studioId: h.studioId, status: modoStudioStatus(h.modo), budgetImpetus: budget.toString() }
  }
  return {
    studioId: h.studioId,
    ...(m.externusId ? { podId: m.externusId } : {}),
    // Once bound, liveness is the pod's (Materia) truth, not the Modo's — a reaped pod
    // leaves a stale-`idle` Modo. Shared mapping with /v1/me/status so both agree.
    status: materiaStudioStatus(m),
    ...(m.gpu ? { gpu: m.gpu } : {}),
    ...(m.runtime ? { runtime: m.runtime } : {}),
    ...(m.imageRef ? { imageRef: m.imageRef } : {}),
    ...(m.warmUntil ? { warmUntil: new Date(m.warmUntil).toISOString() } : {}),
    budgetImpetus: budget.toString(),
    ...(m.costPerHr !== undefined ? { costPerHr: m.costPerHr } : {}),
    ...(m.impetusPerSecond !== undefined ? { impetusPerSecond: m.impetusPerSecond.toString() } : {}),
  }
}

/** Map a Modo's session status to the studio-facing vocabulary (the pre-pod, async case). */
export function modoStudioStatus(modo: { status: string }): string {
  return modo.status === 'terminated' ? 'terminated'
    : (modo.status === 'claiming' || modo.status === 'warming') ? 'provisioning'
    : 'idle'
}

/** Build a Provincia `ornatus` (glyph/color) from create/patch input, over an existing one.
 *  Returns undefined when nothing is set (so an empty object is never persisted). */
export function ornatusOf(
  input: { glyph?: string; color?: string },
  base?: { glyph?: string; color?: string },
): { glyph?: string; color?: string } | undefined {
  const glyph = input.glyph ?? base?.glyph
  const color = input.color ?? base?.color
  if (glyph === undefined && color === undefined) return undefined
  return { ...(glyph !== undefined ? { glyph } : {}), ...(color !== undefined ? { color } : {}) }
}

/** Which flat holding list each asset kind writes to. */
export const HOLDING_FIELD: Record<ProvinciaResKind, 'datasetIds' | 'modelIds' | 'collectionIds'> = {
  dataset: 'datasetIds',
  model: 'modelIds',
  collection: 'collectionIds',
}

/** Narrow an untrusted `kind` string to a ProvinciaResKind, or 400. */
export function resKind(kind: string): ProvinciaResKind {
  if (kind === 'dataset' || kind === 'model' || kind === 'collection') return kind
  throw Errors.inputMalformed(`unknown holding kind '${kind}' (expected dataset|model|collection)`)
}

/** micro-USD (bigint) → a fixed "D.dddddd" USD string (6 dp), exact, no float. */
export function microUsdToStr(micro: bigint): string {
  const whole = micro / 1_000_000n
  const frac = (micro % 1_000_000n).toString().padStart(6, '0')
  return `${whole}.${frac}`
}

/** name → global-unique slug candidate (lowercase, dash-joined alnum). */
export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Project an `Intella` (the load/resolve registry record) to a `ModelCard` — the owner-scoped
 *  `listMyModels` view. `basis` = the compat `familia`; `access` surfaces public/private status. */
export function toModelCardFromIntella(i: Intella): ModelCard {
  return {
    intellaId: i.id,
    nomen: i.nomen || i.id,
    genus: i.genus,
    ...(i.familia ? { basis: i.familia } : {}),
    ...(i.trigger ? { trigger: i.trigger } : {}),
    ...(i.description ? { description: i.description } : {}),
    access: i.access ?? (i.canonica ? 'public' : 'private'),
    ...(i.license ? { license: i.license } : {}),
    ...(i.commercialUse ? { commercialUse: i.commercialUse } : {}),
    ...(i.contentRating ? { contentRating: i.contentRating } : {}),
    ...(i.slug ? { slug: i.slug } : {}),
    ...(i.defaultWeight !== undefined ? { defaultWeight: i.defaultWeight } : {}),
    ...(i.samples?.length ? { samples: i.samples } : {}),
    ...(i.tags?.length ? { tags: i.tags } : {}),
  }
}

/** Has this run reached a terminal state? `completus`/`fractus` are final (types/actum.ts). */
export function isSettled(actum: Pick<Actum, 'status'>): boolean {
  return actum.status === 'completus' || actum.status === 'fractus'
}

export interface TeeSession {
  sessionId: string
  auctor: AuctorKey
  status: 'provisioning' | 'ready' | 'ended'
  /** Latest fine-grained phase (spec §6b) — live cold-start progress, not a persisted timeline. */
  phase?: Phasis
  error?: string
  gpuClass?: string
  budgetImpetus: bigint
  wgClientPublicKey: string
  /** Per-session secret the pod echoes on callbacks. NEVER surfaced on TeeSessionView. */
  runnerToken?: string
  /** Set once the pod echoed the right token — ratchets the session to strict enforcement. */
  runnerTokenConfirmed?: boolean
  podId?: string
  wsProbeAttempts: number
  serverPublicKey?: string
  endpoint?: string
  proxyUrl?: string
  tunnelIp?: string
  gpuHours?: number
  /** USD/hr from the provider — populated by TeeProvisioner at pod boot. Absent during local dev; billing skips. */
  costPerHrUsd?: number
  lastBilledGpuHours: number
  spentImpetus: bigint
  createdAt: Date
}

export function toTeeSessionView(s: TeeSession): TeeSessionView {
  return {
    sessionId: s.sessionId,
    status: s.status,
    ...(s.phase ? { phase: s.phase } : {}),
    ...(s.error ? { error: s.error } : {}),
    ...(s.serverPublicKey ? { serverPublicKey: s.serverPublicKey } : {}),
    ...(s.endpoint ? { endpoint: s.endpoint } : {}),
    ...(s.proxyUrl ? { proxyUrl: s.proxyUrl } : {}),
    ...(s.tunnelIp ? { tunnelIp: s.tunnelIp } : {}),
    ...(s.gpuHours !== undefined ? { gpuHours: s.gpuHours } : {}),
  }
}

export function _auctorMatch(a: AuctorKey, b: AuctorKey): boolean {
  if ('animaId' in a && 'animaId' in b) return a.animaId === b.animaId
  if ('commitment' in a && 'commitment' in b) return a.commitment === b.commitment
  return false
}
