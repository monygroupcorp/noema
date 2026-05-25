# Intella schema — specification

**Date:** 2026-05-25
**Status:** draft, locking the shape before catalogue migration.
**Scope:** the canonical record for every model weight crystal knows about — LoRAs, base checkpoints, VAEs, ControlNets, embeddings, upscalers, audio/video/LLM weights. North star for the migration from the legacy `loraModels` collection and any other model tables.

## 1. Concept

> "Intella" — Latin singular present participle of `intelligo` (to perceive, to understand). A *shape with a weight*: one trainable artifact the platform can load onto a `Materia` (studio) to participate in a `Modus` (workflow).

One Intella row = one model artifact + everything the platform needs to find it, fetch it, attribute it, gate it, and present it.

**One row covers many concerns** that are tempting to split into separate collections:
- **Identity** (who is this, what version)
- **Provenance** (where did it come from, what's it derived from)
- **Attribution** (who gets paid when it's used)
- **Access** (who's allowed to use/see it)
- **Activation** (how it gets invoked in a workflow — LoRA trigger words, ControlNet inputs)
- **Artifact** (where the bytes live)
- **Discovery** (how it surfaces in Mod • Explore / `/arm` model picker)
- **Quality** (denormalized usage + ratings, eventually consistent)
- **Moderation** (review state, blocked flag)
- **License** (usage terms)
- **Lifecycle** (deprecation, supersedence)

Keeping these on one row pays for itself: every read path that touches a model (compilation, royalty hooks, explore browse, training pipeline) reaches for the same shape and never has to join.

## 2. Use case → field matrix

The eleven concerns mapped to which platform feature touches each. This is the read-path inventory the spec has to satisfy.

| concern | fields | read by |
|---|---|---|
| Identity + versioning | `id`, `versio`, `contentHash` | every read |
| Type taxonomy | `genus`, `architectura`, `parametri` | dispatch, royalty, display |
| Authorship | `authorAnimaIds[]`, `royaltySplits?`, `corpusId?`, `parentRoyaltyShare?`, `canonica` | `modelRoyaltyHook` |
| Access | `access` (discriminated), `listing` | `findByTrigger`, `triggerMap`, Mod • Explore admission |
| Activation (LoRA) | `params.trigger`, `params.slug`, `params.defaultWeight`, `params.recommendedWeightRange`, `params.baseIntellaId` | `loraResolver`, prompt compile |
| Artifacts | `sources[]` (uri + provenance), `dest` (primary), `artifacts[]` (multi-file when needed), `sizeGb` | Compiler `_resolveModels`, comfyrunner downloader |
| Display | `nomen`, `description`, `tags[]`, `previewUris[]`, `category` | Mod • Explore, `/arm` picker |
| Quality | `usageCount`, `rating: {avg, count}`, `lastUsed` | Mod • Explore sort/rank |
| Moderation | `contentRating`, `blocked`, `reviewState` | every read (filter); admin tools (write) |
| License | `license`, `usageTerms` | upload UI, marketplace (future), download path |
| Lifecycle | `natum`, `mutatum`, `deprecatedAt?`, `supersedesIntellaId?`, `supersededByIntellaId?` | every read (filter deprecated) |

## 3. The shape

Two discriminated unions in the type — `genus` (params shape per type) and `access` (kind + relevant fields per access mode).

```ts
// ── Discriminated by genus ──────────────────────────────────────────────────
interface IntellaBase {
  id: string
  nomen: string                 // human-readable display name
  versio: string                // semver-ish; "1.0.0" / "2.1.0" / etc.
  contentHash?: string          // sha256 of the primary artifact bytes; null until verified
  architectura: string          // 'sd1.5' | 'sdxl' | 'flux' | 'kontext' | 'illustrious' | 'llm' | ...
  parametri: number             // parameter count or size class; 0 when unknown

  // Provenance + lineage
  importedFrom?: {              // present when this Intella came from outside the platform
    source: 'huggingface' | 'civitai' | 'r2' | 'user-upload' | 'platform-training'
    originalAuthor?: string     // free-form (URL, handle, or animaId-ish)
    sourceUri?: string          // canonical link back (HF repo, Civitai page, etc.)
    importedAt: Date
  }
  parentIntellaId?: string      // direct parent for fine-tunes / derivatives
  canonica: boolean             // true = platform-canonical (always available, royalties to platform)

  // Authorship (see §5)
  authorAnimaIds: string[]      // 0..N; empty for canonica:true platform models
  royaltySplits?: Record<string, number>   // animaId → percentage; must sum to 100 when present
  parentRoyaltyShare?: number   // % of THIS model's royalties that flow to the parent's authors (derivative chain)
  corpusId?: string             // FK → Corpus (training dataset; corpus has its own author for dataset royalties)

  // Access + listing (see §6)
  access: Access                // discriminated union
  listing: 'discoverable' | 'unlisted' | 'hidden'

  // Artifacts (see §7)
  sources: Array<{ provenance: string; uri: string }>   // ordered by preference
  dest: string                                          // primary artifact's path on the studio's volume
  artifacts?: Array<{ role: string; uri: string; dest: string; sizeGb?: number }>  // optional satellites
  sizeGb: number                                        // total size on disk (primary + artifacts)

  // Display + discovery (see §8)
  description?: string
  tags?: Array<{ tag: string; source: 'user' | 'admin' | 'auto'; score?: number }>
  category?: string             // broad bucket: 'style' | 'character' | 'concept' | 'photo' | 'anime' | ...
  thumbnailUri?: string
  previewUris?: string[]
  examplePrompts?: string[]

  // Quality (denormalized; eventually consistent)
  usageCount?: number
  rating?: { avg: number; count: number }
  lastUsed?: Date

  // Moderation
  contentRating?: 'sfw' | 'suggestive' | 'explicit'
  blocked?: boolean
  reviewState?: 'pending' | 'approved' | 'rejected'
  moderationNotes?: string

  // License
  license?: 'cc0' | 'cc-by' | 'cc-by-nc' | 'cc-by-sa' | 'proprietary' | 'custom'
  usageTerms?: string           // free-form when license = 'custom'

  // Lifecycle
  natum: Date
  mutatum?: Date
  deprecatedAt?: Date
  supersedesIntellaId?: string  // points at the older version this replaces
  supersededByIntellaId?: string // points at the newer version that replaces this
}

// Per-genus params (the discriminated half) ────────────────────────────────
interface LoraParams {
  trigger: string                                    // comma-separated aliases; "milady,mld,milady-style"
  slug: string                                       // unique filename stem; what goes in <lora:slug:weight>
  defaultWeight: number                              // 0.0–2.0
  recommendedWeightRange?: [number, number]
  baseIntellaId: string                              // FK → the base checkpoint this LoRA fits
  cognates?: Array<{ word: string; replaceWith: string }>   // trigger aliases (legacy concept; aliases stuffed into `trigger` instead is also fine)
}

interface CheckpointParams {
  // Base models: no special activation; identified solely by id + architectura.
  // Kept as an explicit empty shape so the discriminator narrows correctly.
}

interface VaeParams {
  // VAE: like a checkpoint, no triggers, often loaded alongside a base.
  pairedBaseIntellaId?: string  // optimal base pairing hint
}

interface ControlNetParams {
  preprocessor?: string         // 'canny' | 'depth' | 'openpose' | ...
  baseIntellaId: string         // which base architecture this CN was trained for
}

interface EmbeddingParams {
  trigger: string               // textual inversion trigger
  baseIntellaId: string
}

interface UpscalerParams {
  factor: 2 | 4 | 8 | number
}

interface AudioModelParams { /* TBD when we ship audio gen */ }
interface VideoModelParams { /* TBD when we ship video gen */ }
interface LlmParams {
  contextWindow?: number        // tokens
  family?: 'gpt' | 'claude' | 'llama' | 'mistral' | string
}

// The union ────────────────────────────────────────────────────────────────
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

Notes on the discriminant:
- `genus` is the wire-level discriminant. Code reading `params` MUST narrow first.
- All `params` blocks are required even when empty (`CheckpointParams = {}`) — keeps the union tight and prevents "is `params` present" checks at read sites.
- `LoraParams.cognates` is preserved for legacy parity; new entries should prefer comma-separated aliases inside `trigger`.

## 4. Genus taxonomy (which fields matter when)

| genus | activation | requires `baseIntellaId` | `architectura` example | typical `sizeGb` |
|---|---|---|---|---|
| `lora` | `<lora:slug:weight>` in prompt | yes | flux / sdxl / etc. | 0.1–2 |
| `model` | implicit (workflow's base) | no | flux / sdxl | 4–20 |
| `vae` | implicit pairing | no (hint via `pairedBaseIntellaId`) | flux / sdxl | 0.1–1 |
| `controlnet` | per-workflow node input | yes | sdxl | 1–6 |
| `embedding` | trigger word in prompt | yes | sdxl | <0.1 |
| `upscaler` | post-process node | no | n/a | 0.1–0.5 |
| `audio`/`video`/`llm` | TBD | — | — | varies |

## 5. Authorship & royalty model

**Goal:** every gen that uses a model surfaces royalty to whoever earned it. Multiple authors, derivative chains, and dataset providers all attribute.

### Royalty flow on a guest gen

```
                ┌─── modelRoyaltyHook ───┐
execution_spend ┤                        ├─ Σ split → authorAnimaIds[] (per `royaltySplits`)
                │                        ├─ if parentRoyaltyShare → recurse into parent.authorAnimaIds[]
                │                        ├─ if corpusId → corpus.authorAnimaIds[] (dataset cut)
                │                        └─ if canonica:true → platform anima
                └────────────────────────┘
```

### Fields

- **`canonica: boolean`** — platform-canonical models route royalties to the platform anima. `authorAnimaIds[]` is empty (or solely the platform).
- **`authorAnimaIds: string[]`** — 0..N anima IDs receiving the model's royalty. Empty when `canonica` (royalties to platform anima env var).
- **`royaltySplits?: Record<string, number>`** — animaId → percentage. Sums to 100 when present. Absent ≡ even split across `authorAnimaIds`.
- **`parentRoyaltyShare?: number`** — derivatives owe a slice to their parent's authors. E.g., a fine-tune sets `parentRoyaltyShare: 25` and 25% of THIS model's royalties recurse into the parent's `authorAnimaIds[]`. Caps recursion at one hop in v1; deeper chains compute lazily by walking `parentIntellaId`.
- **`corpusId?: string`** — FK to the training dataset. Corpus has its own author rail (see corpus spec); dataset cut is a separate royalty event downstream of `modelRoyaltyHook`.

### Invariants

- `canonica: true` ⇒ `authorAnimaIds` must be empty *or* contain only the platform anima id.
- `royaltySplits` present ⇒ every key is in `authorAnimaIds` and values sum to exactly 100.
- `parentRoyaltyShare` present ⇒ `parentIntellaId` present.
- Deprecated models still pay royalties on use; only deletion stops the flow (and we don't delete).

## 6. Access & listing rules

Two orthogonal axes: **who can use it** (`access`) and **who can see it exists** (`listing`).

### `access` — usage authorization

```ts
type Access =
  | { kind: 'public' }                                              // anyone can use
  | { kind: 'unlisted' }                                            // anyone with the slug/link can use; not on Explore
  | { kind: 'private'; ownerAnimaId: string; sharedWith?: string[] } // explicit allowlist
  | { kind: 'group'; groupId: string }                              // FK → future Coetus; group's members can use
```

- **public** — `findByTrigger` returns it for any caller. `Explore` surfaces it.
- **unlisted** — only retrievable by exact slug. Trigger-resolver returns it ONLY if the prompt names its slug explicitly (no fuzzy match). Useful for: my-private-uploads-that-I-might-share-via-link, beta drops.
- **private** — owner + optional `sharedWith` allowlist. Trigger-resolver returns it only when the calling anima is in `{ownerAnimaId, ...sharedWith}`. Conflict resolution in `loraResolver` already prefers private-owned over public for the same trigger.
- **group** — defers to a future `Coetus` (group) type; for now, the resolver can hard-code well-known groups (e.g., a Telegram chat's admin set already lives in `Hospitium.adminAnimaIds`).

### `listing` — discoverability axis

```ts
type Listing = 'discoverable' | 'unlisted' | 'hidden'
```

- **discoverable** — appears in Mod • Explore browse + `/arm` picker. Requires `access: 'public'`.
- **unlisted** — does NOT appear in browse, but accessible if the user knows the slug. Independent of `access` (you can have a private+unlisted, public+unlisted, etc.).
- **hidden** — does not appear anywhere; not in browse, slug doesn't resolve. Used for deprecated-but-still-on-disk + moderation-blocked models. `blocked: true` implies `listing: 'hidden'`.

### Invariants

- `access.kind === 'private'` ⇒ `listing !== 'discoverable'` (private things don't appear in public browse).
- `blocked === true` ⇒ `listing === 'hidden'` (defensive; readers should ALSO check `blocked`).
- `access.kind === 'public'` is the only kind that can be `listing: 'discoverable'`.

## 7. Artifacts

Most models = one `.safetensors`. Some are multi-file (a checkpoint + its config; a LoRA + its textual inversion sidecar).

```ts
sources: Array<{ provenance: string; uri: string }>  // ordered fallback list for the PRIMARY artifact
dest: string                                         // where the primary lands on the studio's volume
artifacts?: Array<{                                   // optional satellites — sidecar files
  role: string                                        // 'config' | 'textual-inversion' | 'preprocessor' | 'safety-checker' | ...
  uri: string                                         // where to fetch this satellite
  dest: string                                        // path on the volume
  sizeGb?: number
}>
sizeGb: number                                       // total of primary + all satellites
```

**Why not one Intella per file?** Because they share royalty + access + lifecycle. A LoRA's sidecar config is conceptually *part of* the LoRA. Splitting them into separate Intellae would require joining on every read.

**Multi-source `sources[]`** = fallback list. Compiler tries `sources[0]`, then `sources[1]` if download fails. Useful when we mirror to R2 but keep HF as a fallback during migration.

## 8. Display + discovery

These fields feed Mod • Explore (browse), `/arm` model picker (search), and individual model detail views.

- **`description`** — free-form markdown, displayed in detail view.
- **`tags[]`** — structured `{tag, source, score?}`. `source: 'admin'` for curated taxonomy, `'user'` for user submissions, `'auto'` for inferred. Score for ranking when multiple users submit the same tag.
- **`category`** — broad bucket; faceted on Explore.
- **`thumbnailUri`** — single image for grid views.
- **`previewUris[]`** — sample outputs for the detail view carousel.
- **`examplePrompts[]`** — copy-pasteable prompts that work well with this model.

All deferrable in the migration's first pass (we can populate from legacy where it exists, leave empty otherwise; populated lazily as the explore UI lands).

## 9. Quality + moderation

### Quality (denormalized counters)

- **`usageCount`** — incremented by the `execution_spend` writer when a gen uses this model. Cached counter; not auth-of-record.
- **`rating: {avg, count}`** — user ratings, optional v1 (UI for it lands with Explore).
- **`lastUsed`** — sort key for eviction policies later.

### Moderation

- **`contentRating`** — `'sfw' | 'suggestive' | 'explicit'`. Defaults to `'sfw'` for canonical, `undefined` (= untriaged) for user uploads.
- **`blocked: boolean`** — admin kill switch. Trigger resolver MUST exclude `blocked: true` models. Implies `listing: 'hidden'`.
- **`reviewState: 'pending' | 'approved' | 'rejected'`** — user-uploaded models enter `'pending'`; admin moves to `'approved'` or `'rejected'`. Pending models are usable by owner only (functionally an access narrowing) until approved.
- **`moderationNotes`** — admin-facing free text.

## 10. License

- **`license`** — enum first, free-form `'custom'` escape hatch.
- **`usageTerms`** — populated when `license: 'custom'`, displayed on the detail view.

Legacy `monetization` block (priceUSD, forSale, rental) is **deferred**: we'll add a `pricing?` block in a follow-up sprint when we actually ship the marketplace. Migrating legacy data with monetization can stash the raw block on a `legacyMonetization` field for later re-import without losing data.

## 11. Lifecycle

- **`natum`** — created.
- **`mutatum`** — updated. Every write touches this.
- **`deprecatedAt`** — optional; soft-deprecation timestamp. Trigger-resolver still returns deprecated models (so old gens reproduce) but Explore filters them out.
- **`supersedesIntellaId`** + **`supersededByIntellaId`** — version chain. UI can offer "this model has a newer version" prompts.

Hard-delete is not part of the lifecycle — models persist for reproducibility. Moderation `blocked: true` is the only sustained way to take a model out of circulation.

## 12. Privacy boundary

What's safe to expose to non-owners (Mod • Explore, public API):
- Everything on a `public + discoverable` Intella.
- For unlisted: the Intella is fetchable by slug but doesn't appear in any list.
- For private/group: the Intella is invisible to non-members (Explore filters out; trigger resolver excludes).

The legacy `accessControl: ObjectId[]` (an explicit allowlist cache) maps to `access.sharedWith`. The legacy `ownedBy` becomes `access.ownerAnimaId`.

Never exposed publicly even on public models: `moderationNotes`, `reviewState`, raw `legacyMonetization` block.

## 13. Legacy → crystal mapping

The legacy `loraModels` collection from `src/core/services/db/loRAModelDb.js`. This is the migration's North Star.

| legacy field | crystal field | notes |
|---|---|---|
| `_id` (ObjectId) | `id` (string) | hex-string the ObjectId; preserves identity |
| `slug` | `params.slug` | LoRA-only; comma-separated aliases go into `trigger`, this stays the canonical filename stem |
| `name` | `nomen` | |
| `triggerWords[]` | `params.trigger` | join with commas — `triggerWords.join(',')` |
| `cognates[]` | `params.cognates` | preserved verbatim |
| `replaceWith` | dropped | redundant with cognate replaceWith; warn in migration log if non-empty and not in any cognate |
| `defaultWeight` | `params.defaultWeight` | |
| `modelType`, `strength` | dropped | unused; log values for forensics if non-default |
| `checkpoint` (string like 'FLUX') | `architectura` AND `params.baseIntellaId` | architectura = lower-cased; baseIntellaId = canonical base intella for that architecture (a lookup the migration script bakes in) |
| `trainedFrom.{trainingId,captionSetId,tool,steps}` | `corpusId` (when we can resolve) + stash in `importedFrom` | the corpus reference is best-effort; raw block preserved otherwise |
| `tags[]` | `tags[]` | shape compatible |
| `description` | `description` | |
| `examplePrompts[]` | `examplePrompts[]` | |
| `previewImages[]` | `previewUris[]` | rename only |
| `usageCount` | `usageCount` | |
| `rating: {avg, count}` | `rating` | shape compatible |
| `visibility` ('public'/'private'/'unlisted') | `listing` (and informs `access.kind`) | unlisted → `listing: 'unlisted'`; private → `listing: 'unlisted'` + access private |
| `permissionType` ('public'/'private'/'licensed') | maps onto `access.kind` | 'licensed' → defer; for v1 treat as 'private' with `sharedWith` from `accessControl` |
| `accessControl: ObjectId[]` | `access.sharedWith` | only meaningful when access.kind === 'private' |
| `createdBy` | `authorAnimaIds[0]` | when only createdBy known |
| `ownedBy` | `access.ownerAnimaId` | when access.kind === 'private' |
| `collectionId` | dropped for v1 | revisit when we model Collections in crystal |
| `monetization` | stashed in `legacyMonetization` field | not in canonical schema; preserved for marketplace sprint |
| `importedFrom.{source, url, originalAuthor, importedAt}` | `importedFrom` | shape compatible |
| `publishedTo.{huggingfaceRepo, uploadedAt}` | stashed in `importedFrom` (provenance) | symmetric to legacy import; we don't model "published to" as a first-class field yet |
| `moderation.{flagged, issues, reviewedBy, reviewedAt}` | `blocked` (= flagged) + `reviewState` (heuristic) + `moderationNotes` (join `issues`) | |
| `createdAt` | `natum` | |

### Migration strategy from this mapping

1. Transform function `legacyToIntella(legacyDoc): Intella` — pure, tested against representative fixtures (one of each access type, one with cognates, one with multi-checkpoint, one with monetization, etc.).
2. Lookup table `checkpointToBaseIntellaId: Record<string, string>` — seeded from our canonical intellae (FLUX → intella.flux-base, SDXL → intella.sdxl-base, etc.).
3. Dry-run script — read all legacy, transform, write to a scratch crystal DB, count diffs vs source. Iterate.
4. Real migration — same script, `--commit` flag, batch + idempotent upsert (by `id`).

## 14. What this spec deliberately does NOT cover

- **Marketplace pricing** — `monetization`-style fields. Preserved in `legacyMonetization` during migration; re-imported when the marketplace sprint defines its own schema.
- **Coetus (groups)** — `access.kind: 'group'` references a FK we haven't built yet. Migration sets `access.kind: 'private'` for anything that was group-scoped in legacy.
- **Collection grouping** — legacy `collectionId`. Dropped for v1.
- **Weight migration ops** — moving the actual `.safetensors` bytes off ComfyUI Deploy onto our R2/S3. Independent project; `sources[]` lets URI shift later without schema change.
- **Multi-base LoRAs** — a single LoRA that works on multiple architectures. Modeled as separate Intellae for v1 (one per base); revisit if a single record becomes worth it.

## 15. Open questions to revisit when migrating

1. **Cognate dedup** — legacy has both `triggerWords` and `cognates` (which can replace into a different trigger). Our resolver treats `triggerWords` and cognate-`word` as equivalent map keys. Migration should walk both and produce a flat comma-list in `params.trigger`. Worth testing the resolver against a record with cognates after migration.
2. **`canonica` flip for imported models** — legacy distinguishes platform-canonical via `createdBy === <platform>` heuristics. We should make this explicit in the transform.
3. **Empty `authorAnimaIds[]`** — for community LoRAs that have `createdBy` but no royalty agreement, do we credit them, or treat as `canonica`? Default: credit `createdBy`; admin can flip per-row.
4. **Trigger-word collision** at scale — once we have thousands of LoRAs, common English words (`'cat'`, `'red'`, `'detail'`) probably trigger multiple LoRAs. The resolver's "most-recent-public" tiebreak is in place but a real Explore UX should let users disambiguate.
