# Intella schema — specification

**Date:** 2026-05-25 (v2)
**Status:** locked shape; catalogue migration writes against this.
**Scope:** the canonical record for every model weight crystal knows about — LoRAs, base checkpoints, VAEs, ControlNets, embeddings, upscalers, audio/video/LLM weights. North star for the migration from the legacy `loraModels` collection.

**v2 changes (post-review):** triggerWords as a real array, three-rail royalty model (author/owner/importer) with ownership transfers, single-axis access (the legacy public/private/listed mess consolidated), basis-point splits, `architectura` inherits from the base for LoRAs, slug uniqueness, single-hop parent cap, `publicProjection` for read-path safety, `legacyMonetization` escape hatch.

---

## 1. Concept

> "Intella" — Latin singular present participle of `intelligo` (to perceive, to understand). A *shape with a weight*: one trainable artifact the platform can load onto a `Materia` (studio) to participate in a `Modus` (workflow).

One Intella row = one model artifact + everything the platform needs to find it, fetch it, attribute it, gate it, and present it.

**Concerns one row covers** (tempting to split into separate collections; resist):
- Identity / versioning
- Provenance / lineage
- Attribution (**3 rails**: author, owner, importer — see §5)
- Access (single axis — see §6)
- Activation (LoRA `triggerWords[]`, ControlNet inputs)
- Artifact (primary + sidecar files)
- Discovery (Mod • Explore, `/arm` picker)
- Quality (denormalized, eventually consistent)
- Moderation (review state, blocked override)
- License
- Lifecycle (deprecation, supersedence, ownership transfers)

Keeping these together: every read path (compile, royalty, browse, training pipeline) reaches for the same shape, never joins.

---

## 2. Use case → field matrix

The read-path inventory the spec has to satisfy.

| concern | fields | read by |
|---|---|---|
| Identity | `id`, `versio`, `contentHash` | every read |
| Type taxonomy | `genus`, `architectura` (base-only), `paramCount` | dispatch, royalty, display |
| Authorship (rail 1) | `authorAnimaIds[]`, `authorRoyaltySplits?` | `modelRoyaltyHook` |
| Ownership (rail 2) | `ownerAnimaId?`, `ownershipHistory[]`, `transferable` | `modelRoyaltyHook`, transfer endpoint |
| Importer (rail 3) | `importerAnimaId?` | `modelRoyaltyHook` |
| Derivative | `parentIntellaId?`, `parentRoyaltyShare?` | `modelRoyaltyHook` |
| Corpus | `corpusId?` | dataset royalty (separate event, off-Intella) |
| Access | `access` (discriminated union) | `findByTrigger`, `triggerMap`, Explore |
| Activation (LoRA) | `params.triggerWords[]`, `params.slug`, `params.defaultWeight`, `params.baseIntellaId`, `params.recommendedWeightRange?` | `loraResolver`, prompt compile |
| Artifacts | `sources[]`, `dest`, `artifacts?[]`, `sizeGb` | `_resolveModels`, comfyrunner |
| Display | `nomen`, `description`, `tags[]`, `previewUris[]`, `category` | Explore, picker |
| Quality | `usageCount`, `rating?`, `lastUsed` | Explore sort |
| Moderation | `contentRating`, `blocked`, `reviewState` | every read (filter); admin tools (write) |
| License | `license`, `usageTerms?` | upload UI, marketplace, download path |
| Lifecycle | `natum`, `mutatum`, `deprecatedAt?`, `supersedes?`, `supersededBy?` | every read |

---

## 3. The shape

Two discriminated unions: `genus` (typed `params` per type) and `access` (single axis, replaces the legacy 3-key mess).

```ts
// ── IntellaBase: everything common across genuses ──────────────────────────
interface IntellaBase {
  id: string                      // UUID for new records; hex ObjectId for migrated legacy (different alphabets, never collide)
  nomen: string                   // display name
  versio: string                  // semver-ish: "1.0.0"
  contentHash?: string            // sha256 of primary artifact; stamped lazily by comfyrunner after first download
  paramCount?: number             // literal parameter count, when known (e.g., 12_000_000_000 for a 12B LoRA)
                                  //   — drop the legacy "size class" overload; sizeGb is the disk metric

  // ── Authorship: 3 distinct rails (see §5) ────────────────────────────────
  authorAnimaIds: string[]                          // immutable; original creators (empty for canonical platform models)
  authorRoyaltySplits?: Record<string, number>      // animaId → basis points (sum=10_000); absent = even split
  ownerAnimaId?: string                             // mutable; current rights holder; can be transferred/sold
  ownershipHistory?: OwnershipTransfer[]            // audit trail of transfers; append-only
  transferable: boolean                             // false for canonical platform models; true otherwise
  importerAnimaId?: string                          // who added this to crystal (HF/Civitai pulls); single, immutable
  parentIntellaId?: string                          // direct parent for derivatives
  parentRoyaltyShare?: number                       // basis points (0..10_000); single-hop only (v1 cap)
  corpusId?: string                                 // FK → Corpus (training dataset)
  canonica: boolean                                 // platform-canonical: all royalty rails routed to platform anima

  // ── Provenance ───────────────────────────────────────────────────────────
  importedFrom?: {
    source: 'huggingface' | 'civitai' | 'r2' | 'user-upload' | 'platform-training' | 'community'
    originalAuthor?: string       // free-form (URL, handle); does NOT imply an anima
    sourceUri?: string            // canonical link back
    importedAt: Date
  }

  // ── Access (single axis; see §6) ─────────────────────────────────────────
  access: Access                  // discriminated union

  // ── Artifacts ────────────────────────────────────────────────────────────
  sources: Array<{ provenance: string; uri: string }>   // ordered fallback for the primary
  dest: string                                          // primary path; defaultDestFor(genus, slug) is the convention
  artifacts?: Array<{ role: string; uri: string; dest: string; sizeGb?: number }>  // sidecars
  sizeGb: number                                        // total disk footprint; rounded to 0.001 (~MB precision)

  // ── Display ──────────────────────────────────────────────────────────────
  description?: string
  tags?: Array<{ tag: string; source: 'user' | 'admin'; score?: number }>   // 'auto' dropped pending an explicit producer
  category?: string               // 'style' | 'character' | 'concept' | 'photo' | 'anime' | ...
  thumbnailUri?: string
  previewUris?: string[]
  examplePrompts?: string[]       // RAW user-typed prompts (pre-resolver); resolver runs them like any other prompt

  // ── Quality (denormalized; eventually consistent) ────────────────────────
  usageCount?: number
  rating?: { avg: number; count: number }
  lastUsed?: Date

  // ── Moderation ───────────────────────────────────────────────────────────
  contentRating: 'untriaged' | 'sfw' | 'suggestive' | 'explicit'   // REQUIRED; defaults to 'untriaged' for uploads, 'sfw' for canonical
  blocked: boolean                // REQUIRED; admin kill switch. blocked=true overrides access (no one can use)
  reviewState?: 'pending' | 'approved' | 'rejected'
  moderationNotes?: string        // admin-facing, NEVER public

  // ── License ──────────────────────────────────────────────────────────────
  license?: 'cc0' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nd' | 'cc-by-nc-nd'
           | 'mit' | 'apache-2.0' | 'proprietary' | 'custom'
  usageTerms?: string             // populated when license='custom'

  // ── Lifecycle ────────────────────────────────────────────────────────────
  natum: Date
  mutatum?: Date
  deprecatedAt?: Date
  supersedesIntellaId?: string
  supersededByIntellaId?: string

  // ── Legacy preservation (escape hatch) ───────────────────────────────────
  legacyMonetization?: unknown    // raw block from legacy `monetization`; untyped; reshaped by marketplace sprint when it lands
  legacy?: Record<string, unknown> // any other legacy fields we want to preserve without giving them schema citizenship
}

// ── Ownership transfer record ──────────────────────────────────────────────
interface OwnershipTransfer {
  fromAnimaId?: string            // absent on initial assignment
  toAnimaId: string
  transferredAt: Date
  kind: 'transfer' | 'sale'
  saleValor?: bigint              // impetus paid (when kind='sale')
  saleSignumId?: string           // FK → Signum that paid for the sale
}

// ── Access: single axis. Replaces legacy {visibility, permissionType, accessControl} mess. ──
type Access =
  | { kind: 'public' }                                                  // anyone uses; appears in Explore
  | { kind: 'unlisted' }                                                // anyone with the slug uses; NOT in Explore
  | { kind: 'private'; ownerAnimaId: string; sharedWith?: string[] }    // explicit allowlist; not in Explore
  | { kind: 'group'; groupId: string }                                  // FK → Coetus (future); fallback policy: treat as private until Coetus ships
  | { kind: 'hidden' }                                                  // owner-initiated take-down; differs from admin `blocked: true`

// ── Per-genus params blocks (discriminated half) ───────────────────────────
interface LoraParams {
  triggerWords: string[]                            // array of activators; lowercased; the resolver lookup key
  slug: string                                      // UNIQUE across all Intellae; the <lora:slug:weight> identifier
  defaultWeight: number                             // 0.0–2.0
  recommendedWeightRange?: [number, number]
  baseIntellaId: string                             // FK → base checkpoint; canonical compatibility key
                                                    //   (LoRA inherits `architectura` from its base; no architectura on the LoRA itself)
}

interface CheckpointParams {
  architectura: string                              // 'sd1.5' | 'sdxl' | 'flux' | 'kontext' | 'illustrious' | ...
                                                    //   lowercase; admin-controlled enrollment; constants in `src/crystal/architecturae.ts`
}

interface VaeParams {
  pairedBaseIntellaId?: string                      // optimal base pairing
}

interface ControlNetParams {
  preprocessor?: string                             // 'canny' | 'depth' | 'openpose' | ...
  baseIntellaId: string                             // which base it was trained against
}

interface EmbeddingParams {
  trigger: string                                   // textual inversion is singular by convention
  baseIntellaId: string
}

interface UpscalerParams {
  factor: number                                    // 2, 4, 8, ...
}

interface AudioModelParams  { family?: string }     // TBD at audio-gen time
interface VideoModelParams  { family?: string }     // TBD at video-gen time
interface LlmParams         { contextWindow?: number; family?: string }  // 'gpt' | 'claude' | 'llama' | 'mistral' | ...

// ── The union ──────────────────────────────────────────────────────────────
export type Intella =
  | (IntellaBase & { genus: 'lora';        params: LoraParams        })
  | (IntellaBase & { genus: 'model';       params: CheckpointParams  })
  | (IntellaBase & { genus: 'vae';         params: VaeParams         })
  | (IntellaBase & { genus: 'controlnet';  params: ControlNetParams  })
  | (IntellaBase & { genus: 'embedding';   params: EmbeddingParams   })
  | (IntellaBase & { genus: 'upscaler';    params: UpscalerParams    })
  | (IntellaBase & { genus: 'audio';       params: AudioModelParams  })
  | (IntellaBase & { genus: 'video';       params: VideoModelParams  })
  | (IntellaBase & { genus: 'llm';         params: LlmParams         })
```

### Key shape decisions

- **`id`**: UUIDs (v4) for new records; hex-stringified ObjectIds for migrated legacy records. Different alphabets and lengths, will never collide. Documented dual format.
- **`genus`** is the wire-level discriminant. Read sites MUST narrow before touching `params`.
- **`architectura`** lives on the *base* (`CheckpointParams.architectura`), NOT on LoRAs/ControlNets/embeddings. They inherit compatibility through `baseIntellaId`. Resolves the legacy bug where compat was a fuzzy string-match (`'FLUX'` vs `'flux'` vs `'Flux1-schnell'`).
- **`triggerWords: string[]`**: O(1) lookup per prompt token via the trigger map; no string-splitting at every read.
- **`slug`**: UNIQUE across all Intellae. Mongo enforces with a sparse unique index on `params.slug`. Migration deduplicates by appending `-v<N>` collisions.
- **`contentRating`** and **`blocked`** are REQUIRED (not optional) so every read can filter without `?.` gymnastics. Defaults at creation time.
- **`transferable: boolean`** is REQUIRED — `false` for `canonica: true` (platform-owned, can't be sold); `true` otherwise.

---

## 4. Genus taxonomy

| genus | activation | compat key | `architectura` lives on | typical `sizeGb` |
|---|---|---|---|---|
| `lora` | `<lora:slug:weight>` from `triggerWords` match | `params.baseIntellaId` | base (inherited) | 0.1–2 |
| `model` | implicit (workflow's base) | `params.architectura` | self | 4–20 |
| `vae` | paired (`params.pairedBaseIntellaId` hint) | n/a | base (inherited if paired) | 0.1–1 |
| `controlnet` | workflow node input | `params.baseIntellaId` | base (inherited) | 1–6 |
| `embedding` | trigger word in prompt | `params.baseIntellaId` | base (inherited) | <0.1 |
| `upscaler` | post-process node | n/a | n/a | 0.1–0.5 |
| `audio` / `video` | TBD | — | self (`params.family`) | varies |
| `llm` | chat workflow | n/a | self (`params.family`) | 2–70 |

---

## 5. Authorship & royalty — three rails

Every gen using an Intella fires up to five separate royalty signa. The model royalty hook produces them; the platform-skim hook still claws back its slice from royaltyValor as today.

### The three rails on the Intella itself

| rail | recipient | mutable? | rate (`src/ledger/rates.ts`) | when |
|---|---|---|---|---|
| **Author** | `authorAnimaIds` per `authorRoyaltySplits` | immutable | `MODEL_AUTHOR_RATE` (e.g. 10%) | always when non-canonica |
| **Owner** | `ownerAnimaId` | **transferable** | `MODEL_OWNER_RATE` (e.g. 5%) | when `ownerAnimaId` is set |
| **Importer** | `importerAnimaId` | typically not changed | `MODEL_IMPORTER_RATE` (e.g. 1%, the "baby royalty") | when `importerAnimaId` is set |

Plus two more (already / elsewhere):
- **Parent** — single hop only (v1). When `parentIntellaId` + `parentRoyaltyShare > 0`, the parent's `authorAnimaIds` get `parentRoyaltyShare` basis points of THIS gen's spend. (Not THIS model's payout — direct from the spend, so the math is concrete: `(spend × parentRoyaltyShare) / 10000` goes to parent authors.)
- **Corpus** — dataset author cut. Handled by Corpus, fired off `execution_spend` with `intellaId → corpusId` lookup. Out of this spec's scope.

### Why three rails and not "everyone in `authorAnimaIds`"

Originally we had one list. The user surfaced three distinct economic realities:

- **Author** is immutable — you trained it, you get author-royalty forever. Cannot be reassigned.
- **Owner** is the *current rights holder* — can be transferred, sold, or bequeathed. Initially the same anima as the (single-author case) author, but they diverge the moment ownership transfers.
- **Importer** rewards the platform-curation labor of pulling a model in from HF/Civitai and registering it. Small but persistent. Removes the perverse incentive where importing community LoRAs is unpaid work.

### Royalty splits

All splits use **basis points** (integers 0..10_000, sum to 10_000). Avoids float rounding bugs.

- `authorRoyaltySplits`: when multiple authors. Absent ⇒ even split. Present ⇒ keys must be subset of `authorAnimaIds`, values sum to 10_000.
- `parentRoyaltyShare`: single basis-point value (0..10_000); the slice of the gen's spend that flows to parent's authors.

### Ownership transfer

Transfer endpoint (separate sprint to build) takes `(intellaId, toAnimaId, kind, saleValor?)` and:
1. Authenticates current `ownerAnimaId`.
2. If `kind === 'sale'`, settles `saleValor` from buyer → seller via an explicit signum.
3. Updates `ownerAnimaId = toAnimaId`.
4. Appends to `ownershipHistory`.
5. Bumps `mutatum`.

`transferable: false` rejects this transaction. Canonical models can't be sold.

### Canonical models

`canonica: true` ⇒
- All royalty rails route to the platform anima (`PLATFORM_ANIMA_ID` env). `authorAnimaIds`, `ownerAnimaId`, `importerAnimaId` are IGNORED at hook time — they may be set for audit but don't affect routing.
- `transferable: false` — invariant; enforced at write time.

`canonica` is the single source of truth for "is this platform-owned." No more "or only contains platform anima" soft invariant.

### Invariants

1. `authorRoyaltySplits` present ⇒ keys ⊆ `authorAnimaIds`, values sum to 10_000.
2. `parentRoyaltyShare` present ⇒ `parentIntellaId` present.
3. `canonica: true` ⇒ `transferable: false`.
4. `ownershipHistory` is append-only; entries never edited or removed.
5. `ownerAnimaId` matches the last `toAnimaId` in `ownershipHistory` (when both present).
6. `importerAnimaId` is set by the upload/import endpoint at creation; not normally re-assignable (admin override allowed but rare).

---

## 6. Access — single axis

Legacy had three keys for what was conceptually one decision (`visibility`, `permissionType`, `accessControl`). We collapse to **one** discriminated union:

```ts
type Access =
  | { kind: 'public' }                                                  // anyone uses; appears in Explore
  | { kind: 'unlisted' }                                                // anyone with the slug uses; NOT in Explore
  | { kind: 'private'; ownerAnimaId: string; sharedWith?: string[] }    // explicit allowlist; not in Explore
  | { kind: 'group'; groupId: string }                                  // FK → Coetus (future); for now → behave as private with empty sharedWith
  | { kind: 'hidden' }                                                  // owner-initiated take-down (different from `blocked: true`)
```

### Authorization derived from `access.kind`

A caller can USE an Intella when the orchestration layer's check passes:

| access.kind | who can use |
|---|---|
| `public` | anyone |
| `unlisted` | anyone who can name the slug in a prompt or by-id lookup |
| `private` | `ownerAnimaId` + everyone in `sharedWith` |
| `group` | members of `groupId` (deferred — currently treated as private with empty sharedWith) |
| `hidden` | no one (until access is changed) |

### Discoverability derived from `access.kind`

Mod • Explore + `/arm` picker:

- Lists only `kind === 'public'` records.
- Filters out `blocked: true` and `deprecatedAt` records.
- Records with `reviewState: 'pending'` only visible to their `ownerAnimaId` (or admin).

### `blocked: true` — admin override

`blocked: true` ALWAYS denies usage, regardless of `access.kind`. Separate from `kind: 'hidden'`:

- `blocked: true` — admin/moderation block (content violation; legal request; takedown).
- `kind: 'hidden'` — owner-initiated soft hide (deprecating, taking offline temporarily).

Both deny usage. They differ in *who can lift them* (admin vs owner).

### Invariants

1. `access.kind === 'private'` ⇒ `ownerAnimaId` matches `Intella.ownerAnimaId` (the access-level owner is the rights-holder owner; we don't model "private but a different person is the rights owner").
2. `blocked: true` is checked BEFORE `access.kind`. Always rejects.
3. `kind: 'group'` falls back to private semantics until Coetus is built; UI may surface "this requires group access (coming soon)."

---

## 7. Artifacts

```ts
sources: Array<{ provenance: string; uri: string }>   // ordered fallback for the PRIMARY
dest: string                                          // primary's path; `defaultDestFor(genus, slug)` is the convention
artifacts?: Array<{ role: string; uri: string; dest: string; sizeGb?: number }>
sizeGb: number                                        // total (primary + satellites); rounded to 0.001
```

### `defaultDestFor(genus, slug)` convention

```ts
function defaultDestFor(genus: Genus, slug: string): string {
  switch (genus) {
    case 'lora':        return `models/loras/${slug}.safetensors`
    case 'model':       return `models/checkpoints/${slug}.safetensors`
    case 'vae':         return `models/vae/${slug}.safetensors`
    case 'controlnet':  return `models/controlnet/${slug}.safetensors`
    case 'embedding':   return `models/embeddings/${slug}.pt`
    case 'upscaler':    return `models/upscale_models/${slug}.pth`
    case 'audio':       return `models/audio/${slug}`
    case 'video':       return `models/video/${slug}`
    case 'llm':         return `models/llm/${slug}`
  }
}
```

Migrated records use the legacy `dest` if present, fall back to this function.

### Why one Intella per artifact bundle

Some models are multi-file (a checkpoint + its config + safety-checker). They belong together because they share royalty + access + lifecycle. Splitting them into separate Intellae would require joining on every read.

### `contentHash` population

- Stamped lazily: comfyrunner reports `{intellaId, contentHash}` after the first download verifies on disk.
- Webhook updates `Intella.contentHash` if absent or differs.
- A future drift-detection sweep can re-verify and re-stamp on demand.

---

## 8. Display + discovery

| field | role | populated when |
|---|---|---|
| `description` | markdown detail view | upload form / curator / migration |
| `tags[]` | structured tags `{tag, source, score?}` | admin curation + user submission |
| `category` | broad bucket; faceted on Explore | upload form / migration |
| `thumbnailUri` | grid thumbnail | first preview if not specified |
| `previewUris[]` | detail-view carousel | upload form / training pipeline |
| `examplePrompts[]` | **raw** prompts (pre-resolver) | curator / community |

Source `'auto'` is dropped from `tags[].source` until we have a specific producer to commit to (CLIP-derived, LLM-derived, etc.). When that lands, extend the enum.

---

## 9. Quality + moderation

### Quality (denormalized, eventually consistent)

- `usageCount` — incremented by the `execution_spend` writer when a gen actually uses this Intella. Not auth-of-record (replay against the ledger to rebuild if drifted).
- `rating: {avg, count}` — user ratings, ships with Explore UX.
- `lastUsed` — eviction signal for future cache-management work.

### Moderation

- `contentRating` — required. Enum: `'untriaged' | 'sfw' | 'suggestive' | 'explicit'`.
  - User uploads default to `'untriaged'`.
  - Canonical models default to `'sfw'`.
  - Admin promotes to `'sfw'/'suggestive'/'explicit'` during review.
- `blocked` — required. Defaults to `false`. `true` is the admin kill switch.
- `reviewState` — `'pending' | 'approved' | 'rejected'`. User uploads enter `'pending'`. Functionally a usage narrowing: pending Intellae are usable by their owner only (resolver excludes them for everyone else) until approved.
- `moderationNotes` — admin-facing only. NEVER serialized to public callers (see `publicProjection` in §12).

---

## 10. License

Closed enum with `'custom'` escape hatch:

```ts
license?: 'cc0' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'cc-by-nc-sa' | 'cc-by-nd' | 'cc-by-nc-nd'
       | 'mit' | 'apache-2.0' | 'proprietary' | 'custom'
usageTerms?: string   // free-form, required when license === 'custom'
```

Marketplace pricing (legacy `monetization` block: `priceUSD`, `forSale`, `rental.expiresAfterHours`, `licenseTerms`) is preserved verbatim on `legacyMonetization` and re-imported by the marketplace sprint when it ships.

---

## 11. Lifecycle

- `natum` — created.
- `mutatum` — touched. Every write bumps this.
- `deprecatedAt` — soft-deprecation. Trigger resolver still returns deprecated Intellae for reproducibility; Explore filters them out.
- `supersedesIntellaId` / `supersededByIntellaId` — version chain. UI may offer "newer version available" prompts.
- `ownershipHistory` — append-only audit of every transfer. See §5.

Hard delete is not part of the lifecycle — Intellae persist for reproducibility. `blocked: true` is the only ongoing exclusion mechanism.

---

## 12. Privacy boundary — `publicProjection(intella): PublicIntella`

The schema-layer answer to "what's safe to expose."

```ts
function publicProjection(i: Intella): PublicIntella {
  const {
    moderationNotes,        // admin-only
    legacyMonetization,     // raw; reshape via marketplace
    legacy,                 // generic legacy stash
    reviewState,            // not relevant to consumers
    ownershipHistory,       // audit trail; expose ownership current only
    ...rest
  } = i
  return rest as PublicIntella
}
```

Every public-facing read path (Explore, `/v1/intellae/:id`, share links) MUST funnel through `publicProjection`. The crystal-internal read sites (royalty hooks, transfer endpoint, admin tools) consume the full `Intella` directly.

`PublicIntella` is a derived type — same as `Intella` minus the stripped fields. TypeScript enforces the omission so a slip in the projection function fails to compile.

---

## 13. Legacy → crystal mapping

The legacy `loraModels` collection (`src/core/services/db/loRAModelDb.js`) gives us our migration's North Star.

| legacy field | crystal field | notes |
|---|---|---|
| `_id` (ObjectId) | `id` (hex string) | preserves identity from outside refs |
| `slug` | `params.slug` | unique constraint enforced; collisions → `-v2` suffix |
| `name` | `nomen` | |
| `triggerWords: string[]` | `params.triggerWords` | **direct passthrough**; lowercased on read into the trigger map |
| `cognates[{word, replaceWith}]` | merged into `params.triggerWords` | each cognate's `word` joins the array; `replaceWith` discarded (resolver already maps trigger → slug) |
| `replaceWith` | dropped | redundant; warn in migration log if non-empty |
| `defaultWeight` | `params.defaultWeight` | |
| `modelType` / `strength` | dropped | unused; log values for forensics |
| `checkpoint: 'FLUX' \| 'SDXL' \| 'SD1.5' \| 'KONTEXT' \| 'ILLUSTRIOUS'` | `params.baseIntellaId` | lookup table: `'FLUX' → 'intella.flux-base'` etc. Migration script bakes the table; new bases extend it. |
| (none) | `architectura` | inherited via `baseIntellaId` at read time |
| `trainedFrom.{trainingId, captionSetId, tool, steps}` | `corpusId` (best-effort) + `legacy.trainedFrom` | corpus FK resolved if possible; raw block preserved on `legacy` |
| `tags[]` | `tags[]` | shape compatible; `'auto'` source values rewritten to `'admin'` since we dropped 'auto' |
| `description` | `description` | |
| `examplePrompts[]` | `examplePrompts[]` | raw passthrough |
| `previewImages[]` | `previewUris[]` | rename only |
| `usageCount` | `usageCount` | |
| `rating: {avg, count}` | `rating` | shape compatible |
| `visibility` + `permissionType` + `accessControl` | consolidated into `access` | **collision rule**: see "Access consolidation" below |
| `createdBy` | `authorAnimaIds[0]` + `ownerAnimaId` (initial) | createdBy is the original creator AND initial owner |
| `ownedBy` (if diverges from createdBy) | `ownerAnimaId` | overrides createdBy as initial owner |
| `collectionId` | `legacy.collectionId` | revisit when Collections land in crystal |
| `monetization` (full block) | `legacyMonetization` (verbatim) | marketplace sprint re-imports |
| `importedFrom.{source, url, originalAuthor, importedAt}` | `importedFrom` | shape compatible; `source` enum check |
| `publishedTo.{huggingfaceRepo, uploadedAt}` | `legacy.publishedTo` | not first-class |
| `moderation.{flagged, issues, reviewedBy, reviewedAt}` | `blocked` (= flagged) + `reviewState` heuristic + `moderationNotes` (issues joined) | |
| `createdAt` | `natum` | |
| (none) | `importerAnimaId` | when `importedFrom.source !== 'platform-training'`, set to `createdBy` (the user who imported); else absent |
| (none) | `transferable` | `!canonica` — derived from canonica during migration |
| (none) | `canonica` | `true` when `createdBy === PLATFORM_ANIMA_ID`; else `false` |
| (none) | `contentRating` | `'untriaged'` for everything legacy unless `moderation.flagged === false` AND reviewed → `'sfw'` |
| (none) | `ownershipHistory` | Synthetic initial entry: `[{toAnimaId: ownerAnimaId, transferredAt: natum, kind: 'transfer'}]` |

### Access consolidation (the legacy 3-key mess)

Legacy had three overlapping fields. Mapping by exhaustive case:

| `visibility` | `permissionType` | `accessControl` | crystal `access` |
|---|---|---|---|
| `'public'` | `'public'` | — | `{kind: 'public'}` |
| `'public'` | `'private'` | — | **collision** — defer to permissionType: `{kind: 'private', ownerAnimaId: ownedBy ?? createdBy}` |
| `'public'` | `'licensed'` | `ObjectId[]` | `{kind: 'private', ownerAnimaId, sharedWith: accessControl-as-animaIds}` (license model not yet built; allowlist semantics) |
| `'private'` | (any) | (any) | `{kind: 'private', ownerAnimaId, sharedWith: accessControl-as-animaIds ?? []}` |
| `'unlisted'` | `'public'` | — | `{kind: 'unlisted'}` |
| `'unlisted'` | `'private'` | — | `{kind: 'private', ...}` (private wins; not on Explore anyway) |
| absent | absent | — | `{kind: 'public'}` (default; safest for migrated public LoRAs) |

**Rule of thumb:** `permissionType` wins over `visibility` when they disagree. Document collision events in the migration log.

### Migration strategy

1. **Transform function** `legacyToIntella(legacyDoc): Intella` — pure; tested against fixtures (one of each access shape, one with cognates, one with monetization, one platform-canonical, one user-uploaded private, one with ownership-divergence between createdBy/ownedBy).
2. **Lookup tables** — `checkpointToBaseIntellaId`, `platformAnimaIds` (for canonica detection). Baked into the migration script.
3. **Dry-run script** — read all legacy, transform, write to a scratch crystal DB, count diffs vs source. Iterate. Log every collision case.
4. **Real migration** — same script, `--commit` flag. Idempotent upsert by `id`. Batched.

---

## 14. Out of scope (deferred)

- **Marketplace pricing** — `legacyMonetization` preserves the data; marketplace sprint defines a typed `pricing?` block and reshapes.
- **Coetus (groups)** — `access.kind: 'group'` parks as private until Coetus ships.
- **Collections** — legacy `collectionId` stashed on `legacy`; revisit when crystal models collections.
- **Weight migration ops** — moving `.safetensors` bytes off ComfyUI Deploy → R2/S3. Separate project. `sources[]` lets URIs migrate without schema changes.
- **Multi-base LoRAs** — one LoRA usable across multiple architectures. Modeled as multiple Intellae for v1 (one per base).
- **`tags[].source: 'auto'`** — drop until we commit to a specific auto-producer.
- **Deep parent-royalty chains** — single-hop only in v1. Multi-hop deferred.

---

## 15. Resolved questions (from v1 review)

| original issue | resolution |
|---|---|
| triggerWords array vs comma-string | array (`string[]`) |
| Royalty splits 100% precision | basis points (sum 10_000) |
| parentRoyaltyShare math | single-hop only; flat slice of gen's spend |
| listing/unlisted name collision | dropped `listing`; merged into `access` |
| canonica vs authorAnimaIds redundancy | canonica is source of truth; routes all rails to platform |
| architectura vs baseIntellaId redundancy | architectura on base only; LoRAs inherit |
| slug uniqueness | unique sparse index; collisions → `-v2` |
| id format dual | UUID (new) + ObjectId-hex (migrated); never collide |
| legacyMonetization missing from type | added as `unknown` escape hatch |
| publicProjection unspecified | added as schema-level function |
| author vs owner vs importer | three rails (this v2's headline change) |
| ownership transfer | `ownershipHistory[]`, `transferable` flag |
| importer royalty | `importerAnimaId` + `MODEL_IMPORTER_RATE` |
| 3 legacy access keys | one `access` discriminated union + collision table |

---

## 16. Still open (revisit when implementing)

1. **`MODEL_AUTHOR_RATE` / `OWNER_RATE` / `IMPORTER_RATE` exact values** — placeholder 10/5/1%, but real numbers want product input.
2. **Per-genus royalty rates** — should an LLM Intella have a higher or lower author rate than an image LoRA? Probably no for v1.
3. **`access.kind: 'group'` semantics** — current parks as private with empty sharedWith. The Coetus type design will inform whether group membership is a static list or a dynamic query.
4. **`tags[].source: 'auto'` producer** — dropped pending a concrete plan.
5. **Multi-author conflict policy** — when `authorAnimaIds.length > 1`, who can edit metadata? Single-owner model means `ownerAnimaId` controls writes; authors are immutable contributors. v1 lives with that.
6. **Deprecation cascades** — when a base checkpoint is deprecated, what happens to LoRAs that point at it via `baseIntellaId`? They become hard-to-use but the records persist. Worth a separate policy note when the deprecation sprint lands.
