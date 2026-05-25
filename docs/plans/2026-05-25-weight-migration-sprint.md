# Weight migration — sprint plan

**Date:** 2026-05-25
**Predecessors:** chunk migration (`docs/spec/intella-schema-revisions-queue.md`), scope (`docs/spec/weight-migration-scope.md`)
**Goal:** Mirror all 245 LoRA weights from their current hosts (ComfyUI Deploy, Civitai, HF, already-at-miladystation, one outlier) onto `models.miladystation2`. Stamp eager `contentHash` and real `sizeGb` during the pass. Update `noema_fake.intellae` records to point at the new URIs.

**Followed by:** type-refactor sprint (`src/types/intelligendi.ts` v1 → spec-v2 shape), then production cutover.

---

## What's known (locked from prior sprints)

- 245 records to mirror. Buckets:
  - **25 already-at-miladystation** — metadata-only (provenance label fix; verify HEAD; eager hash)
  - **44 at Civitai** — pilot 5, observe rate limits, then bulk
  - **12 at HuggingFace** — straight pull (no auth needed for public)
  - **163 at ComfyUI Deploy** — lookup by slug via CD API
  - **1 outlier URL** — manual triage
- **`contentHash` policy: eager** — sha256 computed in flight; stamped on Intella record
- **Upload paths mirror ComfyUI's structure** — `models/loras/<slug>.safetensors`, `models/checkpoints/<slug>.safetensors`, etc. The migration's existing `dest` field already matches.
- **Total bytes in flight:** ~89 GB download + ~89 GB upload
- **Source DB for records:** `noema_fake.intellae` (set during chunk migration). Production cutover is a separate step.

---

## What I'm guessing at — flag these explicitly

Every `[GUESS]` is a placeholder waiting for your correction.

| concern | `[GUESS]` | what I need from you |
|---|---|---|
| CD API endpoint | `https://api.comfydeploy.com/v1/private-files/by-slug/<slug>` returning `{ downloadUrl: '...' }` | actual URL + endpoint shape |
| CD auth header | `Authorization: Bearer ${COMFY_DEPLOY_API_KEY}` env var | actual auth scheme + env name |
| miladystation2 SDK | S3-compatible (Cloudflare R2 default) via `@aws-sdk/client-s3` | confirm R2 / S3 / something else |
| miladystation2 bucket | `models-miladystation2` | actual bucket name |
| miladystation2 endpoint | `https://<account-id>.r2.cloudflarestorage.com` | actual endpoint URL |
| miladystation2 credentials | env: `MS2_ACCESS_KEY_ID` / `MS2_SECRET_ACCESS_KEY` / `MS2_ENDPOINT` | actual env var names |
| Civitai pilot batch size | 5 records before observing 429 patterns | confirm or override |
| Public miladystation URL pattern | `https://models.miladystation2.net/<dest>` (matches the legacy `miladystation` URLs seen in the chunk dry-run) | confirm |

The script will fail loud with helpful messages on each `[GUESS]` until they're filled in.

---

## Sprint items (8, ~2 days clean)

### 1. Pre-flight: refresh `noema_fake.intellae` with the three field-preservation patches (~1h)

Three small `legacyToIntella` cleanups identified during chunk-migration but held per direction:

- Map legacy `version: string` → `versio` (currently hardcoded `"1.0.0"`; 216 records affected, 88%)
- Preserve `migratedFrom` block on `legacy.migratedFrom` (6 records)
- Preserve `rewardStats` block on `legacy.rewardStats` (3 records)

Plus add the held lookup variants (`SDXL 1.0` → SDXL base, `Flux.1 D` → FLUX base) and the `legacy_migration` source enum value.

Re-run `migrate-loras-chunk.ts --n 245 --commit` to refresh `noema_fake.intellae` with the patched transform.

**Tests:** extend `legacyToIntella.test.ts` with three fixtures for the new preserved fields.

### 2. miladystation2 uploader (~3h)

`src/migrations/weights/ms2Uploader.ts` — thin wrapper over `@aws-sdk/client-s3` for the R2 [GUESS] endpoint.

```ts
export interface Ms2Uploader {
  exists(dest: string): Promise<boolean>
  upload(dest: string, body: ReadableStream | Buffer, sizeBytes: number): Promise<{ uri: string }>
  head(dest: string): Promise<{ sizeBytes: number; contentHash?: string } | null>
}
```

Honors `--dry-run` (returns the URL it would write to without writing). Idempotent: `exists()` short-circuits re-upload when the dest already has matching content (compare sha256 from miladystation's `x-amz-meta-sha256` if we set it on upload).

**Tests:** unit tests against a mock S3 client (`@aws-sdk/lib-storage`'s in-memory testing utilities).

### 3. Bucket adapters — common interface, four implementations (~4h)

`src/migrations/weights/sources/` — one file per source bucket, all conforming to:

```ts
export interface SourceAdapter {
  /** Find the byte source for one record. Returns a readable stream + the
   *  declared size (from Content-Length when reachable). */
  fetch(intella: IntellaV2): Promise<{ stream: ReadableStream; declaredSizeBytes?: number } | null>
  /** Name surfaced in `sources[].provenance` after the mirror. */
  readonly provenance: string
}
```

Four adapters:
- `MiladystationAdapter` — no-op fetch (it's already where it needs to be); the orchestrator skips download for this bucket and just refreshes metadata
- `CivitaiAdapter` — fetches from `importedFrom.url`; pilot 5 before bulk; respects `Retry-After` on 429
- `HuggingfaceAdapter` — fetches from synthesized HF URL (`https://huggingface.co/<repo>/resolve/main/<slug>.safetensors`); no auth for public
- `ComfyDeployAdapter` — looks up bytes via `[GUESS] CD API endpoint` using `intella.params.slug` as the key; auth via `[GUESS] COMFY_DEPLOY_API_KEY` env

**Tests:** unit tests per adapter against mock fetch responses; one integration test per adapter that hits a sentinel URL the adapter can confirm we have the right contract.

### 4. Mirror orchestrator (~4h)

`scripts/mirror-loras-weights.ts` — per-record state machine.

For each record in `noema_fake.intellae`:

```
1. Pick adapter based on existing `sources[0].provenance` (or fall back to inferring from URL)
2. fetch() → readable stream + declaredSize
3. Stream through sha256 hasher AND through ms2 uploader (single pass, no temp file)
4. After upload: real bytes counted, sha256 computed
5. Update Intella record:
   - sources[0] = { provenance: 'miladystation', uri: <new ms2 URL> }
   - sources[1] = (original source preserved for fallback)
   - contentHash = <sha256>
   - sizeGb = <real bytes / 1e9>, rounded to 0.001
   - mutatum = new Date()
```

CLI:
```
npx tsx scripts/mirror-loras-weights.ts \
  [--bucket=ms|civitai|hf|cd]   # only mirror this bucket
  [--limit=N]                    # cap; useful for pilot runs
  [--dry-run]                    # no downloads, no uploads, no writes
  [--resume]                     # skip records where contentHash is already set
  [--concurrency=N]              # default 1 (sequential); dial up cautiously
```

State: idempotent. A second `--resume` pass skips records with a stamped `contentHash`. Mid-stream death is safe: the upload either landed (we'll see it on resume via `exists()`) or it didn't (we re-do).

**Logging:** per-record `[bucket] slug — OK (sizeMB, sha256-prefix)` or `[bucket] slug — FAIL (reason)`. Aggregate at end.

### 5. Pilot run — Civitai (5 records) + CD (5 records) (~1h)

Before bulking, run the orchestrator with `--bucket=civitai --limit=5`. Observe rate-limit behavior, validate the upload pattern lands the bytes at `models.miladystation2/models/loras/<slug>.safetensors` correctly.

Same for `--bucket=cd --limit=5`.

If any pilot fails, fix before running bulk.

### 6. Bulk mirror — all 245 records (~6h wall time depending on bandwidth)

```bash
npx tsx scripts/mirror-loras-weights.ts --bucket=ms       # 25 metadata-only
npx tsx scripts/mirror-loras-weights.ts --bucket=hf       # 12 HF
npx tsx scripts/mirror-loras-weights.ts --bucket=civitai  # 44 Civitai
npx tsx scripts/mirror-loras-weights.ts --bucket=cd       # 163 CD (the bulk)
```

Run one bucket at a time so failures are bucket-scoped. Each leaves `noema_fake.intellae` with `sources[0].provenance = 'miladystation'` for everything that succeeded.

### 7. Verification pass (~1h)

Query `noema_fake.intellae` for completeness:

```
- Records with sources[0].provenance === 'miladystation': should be 245 (or 245 - failures)
- Records with contentHash unset: should be 0 (every record passed through the hasher)
- Records with sizeGb === <per-arch default>: should be 0 (every record has real bytes counted)
- Records still pointing at civitai/hf/cd in sources[0]: should be 0 (or = failure count)
```

Spot-check 10 records by downloading from the new `sources[0].uri` and verifying the sha256 matches `contentHash`.

### 8. Production cutover (separate plan, NOT in this sprint)

When verification looks clean, the equivalent upserts land in `production.intellae`. That requires:
- The `src/types/intelligendi.ts` v1 → spec-v2 refactor (so production runtime can read the new shape)
- A separate cutover plan with rollback steps

Out of scope here. This sprint ends with `noema_fake.intellae` containing the truth.

---

## Out of scope

- Production cutover (separate sprint after the type refactor)
- Trigger-resolver upgrade (separate sprint; tracked in revisions queue)
- Mod • interactive add/explore UX (depends on this sprint completing)
- `/arm` wizard (depends on Mod •)
- Decommissioning the legacy `noema.loraModels` collection (do not touch — kept as fallback indefinitely)
- Discord adapter (deprioritized)

---

## Open questions (sprint-time tuning, not gating)

1. **Parallelism per source** — sequential is the safe default. Civitai might 429 us at any concurrency; HF and CD might tolerate higher. Try `--concurrency=2` after the pilot if conservative.
2. **Retry policy** — 3 attempts per record with exponential backoff (1s, 5s, 25s)? Per-bucket override?
3. **`sources[1]` retention** — keep the original CD/Civitai/HF URL as fallback indefinitely, or strip after 30 days of clean mirror operation? Keep indefinitely is safer.
4. **`legacyMonetization` records** — there's 1. Worth checking that record's `sources[]` lands correctly given its unusual shape.

---

## Definition of done

- All 245 records in `noema_fake.intellae` have `sources[0].provenance === 'miladystation'` (or recorded failure with explicit reason)
- All 245 have real `contentHash` and real `sizeGb`
- 10 spot-checked records: download from `sources[0].uri` matches stored `contentHash`
- The mirror script is re-runnable safely (idempotent, resumable)
- Migration log captured for the run, surfaces every failure with `(slug, bucket, error)`
- All `[GUESS]` markers in this doc resolved with real values during item 1

---

## Estimate

| item | time |
|---|---|
| 1. Pre-flight transform patches | 1h |
| 2. miladystation2 uploader | 3h |
| 3. Source adapters (4) | 4h |
| 4. Orchestrator script | 4h |
| 5. Pilot runs | 1h |
| 6. Bulk mirror (wall time) | ~6h |
| 7. Verification | 1h |
| **Total dev time** | **~14h** + ~6h wall time |

Roughly 2 days clean (1 day building, ~6h mirroring, half-day verifying + buffer).
