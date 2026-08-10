# Intella schema — specification

**Date:** 2026-05-25 (v2)
**Status:** locked shape; catalogue migration writes against this.
**Scope:** the canonical record for every model weight crystal knows about — LoRAs, base checkpoints, VAEs, ControlNets, embeddings, upscalers, audio/video/LLM weights. North star for the migration from the legacy `loraModels` collection.

**v2 changes (post-review):** triggerWords as a real array; **single-rail royalty (5% per model, capped at 10% across the workflow) to `ownerAnimaId`**; **imported models are "authorless"** — `authorAnimaIds: []`, importer becomes owner; single-axis access (the legacy public/private/listed mess consolidated); basis-point everywhere; `architectura` inherits from the base for LoRAs; slug uniqueness; single-hop parent royalty; `publicProjection` for read-path safety; `legacyMonetization` escape hatch; ownership transfer endpoint deferred to v2 (schema present).

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
| Authorship (credit) | `authorAnimaIds[]` (empty for authorless imports; informational) | display, lineage |
| Ownership (royalty recipient) | `ownerAnimaId?`, `ownershipHistory[]`, `transferable` | `modelRoyaltyHook`, transfer endpoint (v2) |
| Importer (audit) | `importerAnimaId?` (records who pulled it from HF/Civitai; NOT a payment rail) | display, audit |
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

  // ── Authorship + ownership (see §5) ──────────────────────────────────────
  // Single royalty rail (5% per model, capped at 10% across the workflow) routes
  // to ownerAnimaId. authorAnimaIds is informational (credit, lineage, display);
  // importerAnimaId is informational (audit). Neither drives payment.
  authorAnimaIds: string[]                          // original creators (empty = authorless / imported); credit/lineage only
  ownerAnimaId?: string                             // current rights holder; receives the per-model royalty
  ownershipHistory?: OwnershipTransfer[]            // append-only audit; v1 carries only the initial-assignment entry
  transferable: boolean                             // false for canonica; true otherwise (v2 enforces at the transfer endpoint)
  importerAnimaId?: string                          // who added this to the catalogue; audit only, NOT a payment rail
  parentIntellaId?: string                          // direct parent for derivatives
  parentRoyaltyShare?: number                       // basis points (0..10_000); flat slice of THIS gen's spend to parent's ownerAnimaId; single-hop
  corpusId?: string                                 // FK → Corpus (training dataset)
  canonica: boolean                                 // platform-canonical: royalty routes to PLATFORM_ANIMA_ID, ignoring author/owner/importer

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
  sizeGb: number                                        // total disk footprint; rounded to 0.001 (~MB precision).
                                                        //   Required — bulletin/wait estimates depend on it.
                                                        //   Migrated records: per-architecture defaults (FLUX≈0.5, SDXL≈0.15,
                                                        //   SD1.5≈0.1, KONTEXT≈0.5, Illustrious≈0.15); weight-migration backfills real bytes.

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

## 5. Royalty model — one rail per model, capped across the workflow

### How it works

Every gen pays a **model royalty surcharge** on top of compute cost. Per model:

```
royaltyPerModel = min(MODEL_ROYALTY_RATE, MODEL_ROYALTY_CAP / N) × X
```

where:
- `X` = compute cost (= `seconds × impetusPerSecond` = `baseImpetus`)
- `N` = number of distinct intellae used in the gen
- `MODEL_ROYALTY_RATE = 5%` (per model when uncapped)
- `MODEL_ROYALTY_CAP = 10%` (total surcharge across all models in the workflow)

User pays `X + (total surcharge)`. The surcharge funds the per-model signa.

### Worked examples

| N models | per-model | total surcharge | user pays |
|---|---|---|---|
| 1 | 5% × X | 5% × X | 1.05 × X |
| 2 | 5% × X | 10% × X | 1.10 × X |
| 3 | 3.33% × X | 10% × X | 1.10 × X |
| 4 | 2.5% × X | 10% × X | 1.10 × X |
| 5 | 2.0% × X | 10% × X | 1.10 × X |

Cap binds at N ≥ 3. Each model still gets its share, just diluted.

### Who receives it — single rail to `ownerAnimaId`

Per model, the entire surcharge slice goes to **the current `ownerAnimaId`** as one signum. No internal split between author/owner/importer rails — there's just the owner stream.

| model origin | how the spec captures it | who gets the 5% |
|---|---|---|
| User trained on the platform | `authorAnimaIds: [trainer]`, `ownerAnimaId: trainer`, `importerAnimaId: undefined` | the trainer |
| User imported from HF/Civitai/etc. — **authorless** | `authorAnimaIds: []`, `ownerAnimaId: importer`, `importerAnimaId: importer` | the importer (= owner) |
| Platform-canonical | `canonica: true`, `authorAnimaIds: []`, `ownerAnimaId: undefined` | the platform anima (`PLATFORM_ANIMA_ID`) |

The "baby royalty" framing the earlier spec used for importers was a separate-rail design. Simpler truth: when an importer pulls a model into the catalogue, **they become its owner**, and the model is **authorless** (no on-platform creator earned the training labor). The full per-model surcharge then flows to them. UI displays this as "imported by @userX" rather than "by @userX."

`importerAnimaId` is retained on the schema for **audit** (record of who curated the catalogue entry) but is NOT a payment rail. The owner stream is the only model royalty stream.

### Complementary to modus royalty

This model royalty is one of two parallel royalty surfaces:

- **Model royalty** (this spec) — for the WEIGHTS used. Surcharge on compute, per Intella, capped at 10% workflow-wide. Recipient: `Intella.ownerAnimaId`. Emitted by `modelRoyaltyHook`.
- **Modus royalty** — for the WORKFLOW/SPELL used. Surcharge per custom modus, recipient: `Modus.auctor`. Emitted by `spellRoyaltyHook`.

Both exist independently and stack. A guest running a custom spell with a custom LoRA pays compute + model surcharge + modus surcharge. Each surcharge incentivizes a different kind of creative labor: training the weights, designing the workflow.

### Parent royalty (derivative chain)

Single-hop, separate from the per-model surcharge:

```
parentSurcharge = (parentRoyaltyShare / 10_000) × X
```

Flows direct to the parent's `ownerAnimaId`. Independent of the workflow cap. Default `parentRoyaltyShare = 0` (no derivative obligation).

### Canonical models

`canonica: true` ⇒
- The per-model surcharge routes to `PLATFORM_ANIMA_ID`.
- `authorAnimaIds`, `ownerAnimaId`, `importerAnimaId` are IGNORED at hook time — they may be set for audit but don't affect routing.
- `transferable: false` (canonical can't be sold).

`canonica` is the single source of truth for "is this platform-owned." No more "or only contains platform anima" soft invariant.

#### Phantom anima as deflationary sink (operator policy)

`PLATFORM_ANIMA_ID` is an env value. Two intentional configurations:

1. **Unset / set to a sentinel (`'platform'`)** — the canonical royalty signum credits an anima that no one has a key for. Points leave the user's wallet, the signum is auditable, but the credits can never be spent. **Functionally point destruction** — deflationary pressure on the impetus economy, the platform's cut withdrawn from circulation.

2. **Set to a real anima id** — the canonical royalty signum credits that anima, who can spend its balance like any other. **Direct routing** — the platform operator collects the cut as live points.

Both are valid policies. (1) suits a closed economy where canonical-model use should shrink the points pool. (2) suits an operator who wants to compound the platform's cut into platform operations. Switching between them at runtime requires no schema change — just flip the env value.

For migrated orphan records that lack any provenance (no `createdBy`, no `importedFrom`, no `trainedFrom`, no `publishedTo`), the catalogue-migration `legacyToIntella` defaults them to `canonica: true`. Whether those records' royalty pays a real anima or is destroyed is the operator's runtime decision.

### Rate constants (`src/ledger/rates.ts`)

```ts
export const MODEL_ROYALTY_RATE = 500n   // basis points; 5% per model
export const MODEL_ROYALTY_CAP  = 1000n  // basis points; 10% total across the workflow
```

Basis points everywhere; integer math; no float rounding.

### Hook behavior (informational; lives in `modelRoyaltyHook`)

```
on execution_spend:
  intellae = distinct intellae used in this gen
  N        = intellae.length
  X        = event.payload.baseImpetus
  if N == 0: return []

  perModel = min(MODEL_ROYALTY_RATE, MODEL_ROYALTY_CAP / N) × X / 10_000

  for each intella in intellae:
    recipientAnimaId = intella.canonica
      ? PLATFORM_ANIMA_ID
      : intella.ownerAnimaId   // skip emit if unset (non-canonica with no owner — see invariant 3)
    emit signum {
      animaId: recipientAnimaId,
      forma: 'reward',
      valor: perModel,
      auctor: 'nexus:modelRoyalty',
      contextId: intella.id,    // per-intella attribution
    }

  // Parent rail (separate from the cap)
  for each intella with parentIntellaId + parentRoyaltyShare > 0:
    parent       = lookup(intella.parentIntellaId)
    parentValor  = (intella.parentRoyaltyShare / 10_000) × X
    recipient    = parent.canonica ? PLATFORM_ANIMA_ID : parent.ownerAnimaId
    emit signum { animaId: recipient, forma: 'reward', valor: parentValor,
                  auctor: 'nexus:modelRoyalty.parent', contextId: parent.id }
```

### Ownership transfer — schema present, endpoint deferred to v2

The schema supports transfers (`ownerAnimaId` mutable, `ownershipHistory[]` append-only, `transferable: boolean` gate) so v2 can ship transfers without a schema migration. **The transfer endpoint itself is NOT part of v1.**

Implications for v1:
- `ownerAnimaId` is set at creation; never changes until v2.
- `ownershipHistory[]` carries the single synthetic initial-assignment entry from migration; never grows.
- `transferable: boolean` is set per `canonica` — read but not enforced yet.

When v2 ships the transfer endpoint, the contract is:
1. Authenticate current `ownerAnimaId`.
2. If `kind === 'sale'`, settle `saleValor` from buyer → seller via an explicit signum.
3. Update `ownerAnimaId = toAnimaId`.
4. Append to `ownershipHistory`.
5. Bump `mutatum`.
6. `transferable: false` rejects the call.

### Invariants

1. `parentRoyaltyShare` present ⇒ `parentIntellaId` present.
2. `canonica: true` ⇒ `transferable: false` AND surcharge routes to `PLATFORM_ANIMA_ID`.
3. Non-canonica with no `ownerAnimaId`: surcharge is **dropped** for that model (no payment fires). Migration ensures `ownerAnimaId` is populated for non-canonica.
4. `ownershipHistory` is append-only.
5. `ownerAnimaId` matches the last `toAnimaId` in `ownershipHistory` (when both present).
6. `importerAnimaId` is set by the upload/import endpoint at creation; not normally re-assignable. NOT a payment rail.
7. `authorAnimaIds` is **empty** for authorless (imported) models. Non-empty only when the platform observed the training.

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
  - **URL imports arrive pre-derived**, not `'untriaged'`: `deriveImportContentRating`
    (`src/crystal/ModelImporter.ts`) maps the adult flag the origin publishes about itself to
    `'explicit'` (flagged) or `'sfw'` (flagged safe); an origin that publishes no such flag still
    yields `'untriaged'`. See `docs/spec/model-import.md` for the table and the numeric-level
    caveat. The derivation is a default only — a re-import never overwrites a rating already
    decided.
  - `'suggestive'` is not producible by any automated path today; it is a human-review value.
  - **No admin write surface exists yet.** `Intellarum` has no `setContentRating`, so a rating set
    at creation (or by a one-shot migration) cannot currently be corrected through the API. A
    triage seam mirroring `setLicense` → `CrystalApi.setModelLicense` is a known follow-up.
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
| `createdBy` + `importedFrom.source` (with `trainedFrom`/`publishedTo` heuristic fallback) | depends on source — see "Authorship branching" below | platform-trained vs HF/Civitai-imported map to different `authorAnimaIds`; missing source is inferred from training-pipeline / publish artifacts |
| `ownedBy` (if diverges from `createdBy`) | `ownerAnimaId` | overrides the default; explicit current rights holder |
| `collectionId` | `legacy.collectionId` | revisit when Collections land in crystal |
| `monetization` (full block) | `legacyMonetization` (verbatim) | marketplace sprint re-imports |
| `importedFrom.{source, url, originalAuthor, importedAt}` | `importedFrom` | shape compatible; `source` enum check |
| `publishedTo.{huggingfaceRepo, uploadedAt}` | `legacy.publishedTo` | not first-class |
| `moderation.{flagged, issues, reviewedBy, reviewedAt}` | `blocked` (= flagged) + `reviewState` heuristic + `moderationNotes` (issues joined) | |
| `createdAt` | `natum` | |
| (none) | `importerAnimaId` | when `importedFrom.source !== 'platform-training'`, set to `createdBy` (the user who imported); else absent. Audit only — NOT a payment rail. |
| (none) | `transferable` | `!canonica` — derived from canonica during migration |
| (none) | `canonica` | `true` when `createdBy === PLATFORM_ANIMA_ID`; else `false` |
| (none) | `contentRating` | `'untriaged'` for everything legacy unless `moderation.flagged === false` AND reviewed → `'sfw'` |
| (none) | `ownershipHistory` | Synthetic initial entry: `[{toAnimaId: ownerAnimaId, transferredAt: natum, kind: 'transfer'}]` |

### Authorship branching by `importedFrom.source`

`createdBy` in legacy means "the user who first registered this record." That's not the same thing as "who trained the weights" for community LoRAs. Mapping branches on origin:

| `importedFrom.source` | `authorAnimaIds` | `ownerAnimaId` | `importerAnimaId` | rationale |
|---|---|---|---|---|
| `'platform-training'` | `[createdBy]` | `ownedBy ?? createdBy` | absent | trainer trained on our platform; they ARE the author |
| `'huggingface'` / `'civitai'` / `'r2'` / `'user-upload'` / `'community'` | `[]` (**authorless**) | `ownedBy ?? createdBy` | `createdBy` | external author can't be attributed to an anima; importer becomes owner |
| absent + `trainedFrom` OR `publishedTo` set | `[createdBy]` (**heuristic**) | `ownedBy ?? createdBy` | absent | predates `importedFrom` field, but training-pipeline metadata or HF publish proves on-platform training; inferred platform-trained |
| absent / unknown (none of the above) | `[]` (defensive) | `ownedBy ?? createdBy` | `createdBy` | preserve owner stream; log warning for forensics |

For canonical platform-baked models (createdBy = PLATFORM_ANIMA_ID), the migration sets `canonica: true` and leaves `ownerAnimaId` undefined; the royalty hook routes to `PLATFORM_ANIMA_ID` directly.

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

- **Ownership transfer endpoint** — schema supports it (`ownerAnimaId` mutable, `ownershipHistory[]`, `transferable`); endpoint + sale settlement land in v2. v1 sets owner = author at creation and never changes it.
- **Marketplace pricing** — `legacyMonetization` preserves the data; marketplace sprint defines a typed `pricing?` block and reshapes.
- **Coetus (groups) with dynamic membership** — `access.kind: 'group'` parks as private until Coetus ships in v2. The eventual model is dynamic membership (a member of a Coetus is whoever the Coetus says, computed at access-check time, not a static snapshot on the Intella).
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
| author vs owner vs importer rails | **collapsed to one rail** — 5% per model to `ownerAnimaId`, capped at 10% workflow-wide; imported models are *authorless* (importer becomes owner); `importerAnimaId` retained for audit only |
| ownership transfer | `ownershipHistory[]`, `transferable` flag |
| importer royalty | folded into ownership — imported models are *authorless*, importer becomes owner, single 5% rail (capped 10% workflow-wide) |
| 3 legacy access keys | one `access` discriminated union + collision table |

---

## 16. Still open (revisit when implementing)

Resolved at v2 spec time (2026-05-25):

| was | resolution |
|---|---|
| Royalty rate values | **5% author / 5% owner / 1% importer**, uniform across genus |
| Per-genus royalty rate variance | **no**, same rates everywhere |
| `access.kind: 'group'` semantics | **dynamic membership**, deferred to v2 with Coetus |
| Ownership transfer flow | **deferred to v2**; schema present, endpoint not built |

Genuinely still open:

1. **`tags[].source: 'auto'` producer** — dropped from the enum pending a concrete plan (CLIP-derived? LLM-derived?). Re-add when we commit.
2. **Multi-author conflict policy** — when `authorAnimaIds.length > 1`, who can edit metadata? Single-owner model means `ownerAnimaId` controls writes; authors are immutable contributors. v1 lives with that.
3. **Deprecation cascades** — when a base checkpoint is deprecated, what happens to LoRAs that point at it via `baseIntellaId`? They become hard-to-use but the records persist. Worth a separate policy note when the deprecation sprint lands.
4. **Trigger-resolver upgrade for non-alphanumeric triggers** — real legacy data carries triggers like `artist:moriimee`, `1990s \(style\)`, `retro artstyle`. The current `loraResolver.ts` tokenizer can't reach them. Needs a substring-scan path with weight-modifier lookahead. Migration preserves the raw strings; resolver needs to grow. Tracked in `intella-schema-revisions-queue.md`.
