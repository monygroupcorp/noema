# Weight migration — sizing & scope

**Date:** 2026-05-25
**Status:** scoping doc, derived from chunk-migration findings against the live legacy catalogue (N=245).
**Successor to:** `docs/spec/intella-schema.md` + `intella-schema-revisions-queue.md`
**For:** the future sprint that moves `.safetensors` bytes off ComfyUI Deploy (and other current hosts) onto `models.miladystation2`.

---

## TL;DR

- **245 LoRA records** in the legacy `noema.loraModels` catalogue.
- **Estimated total disk:** ~92 GB (per-architecture defaults; real bytes likely 50–200% of this).
- **All 245 recoverable** — bytes live in one of four places, all accessible:
  - **25 already at miladystation** (~3 GB): metadata-only fix
  - **44 at Civitai** (~7 GB): mirror via the public CDN
  - **12 at HuggingFace** (~7 GB): mirror via HF
  - **163 in ComfyUI Deploy storage** (~75 GB): mirror via the **CD API** (we have access)
  - 1 outlier URL — manual triage
- **Upload path convention:** `models.miladystation2` paths **mirror ComfyUI Deploy's structure** (LoRAs at `models/loras/<slug>.safetensors`, etc.). Migration `dest` field already matches.
- **`contentHash` policy: EAGER** — stamp sha256 during the mirror pass while we have the bytes in hand. No lazy backfill.
- **Other surprises:** 1 record with a non-CDN URL, 6 records with `migratedFrom` meta-migration data, 3 with `rewardStats` usage data, 216 with a legacy `version` field (currently dropped by migration — should map to `versio`).

---

## Distribution of byte sources across the catalogue

Source-of-truth bucket per legacy record (mutually exclusive, in order checked):

| bucket | count | % | est. size | what it means |
|---|---|---|---|---|
| `miladystation` (already at our CDN) | 25 | 10% | ~3 GB | URL in `importedFrom.url` resolves to `*miladystation*`. **No move needed.** Migration to-do: set `sources[0].provenance = 'miladystation'` on these records (currently labels them as whatever `importedFrom.source` says). |
| `civitai` (Civitai's CDN) | 44 | 18% | ~7 GB | URL points at Civitai. Bytes are there now; permanence unknown (Civitai can pull). **Pull + reupload to miladystation.** |
| `huggingface` (via `publishedTo.huggingfaceRepo`) | 12 | 5% | ~7 GB | We published these to HF after training. Bytes are at HF. **HEAD-request to get real size, then pull + reupload.** |
| `other_url` | 1 | <1% | unknown | One record with a URL that doesn't match any known CDN pattern. Manual review. |
| `no_url` (bytes in ComfyUI Deploy storage) | 163 | 67% | ~75 GB | No URL in legacy because the legacy runtime resolved bytes via slug + a ComfyUI Deploy convention. Bytes are still in CD storage; **recoverable via the CD API** using `slug` as the lookup key. |

Estimated sizes are derived from per-architecture defaults in the migration script (FLUX≈0.5 GB, SDXL/Illustrious/Pony≈0.15 GB, SD1.5≈0.1 GB, KONTEXT≈0.5 GB). Real bytes likely vary 50–200%.

---

## What "weight migration" actually means by bucket

### Bucket 1: `miladystation` (25 records, ~3 GB) — **metadata-only**

Bytes are already at our CDN. The catalogue record's `importedFrom.url` already points there. Migration just needs to:

- Set `sources[0].provenance = 'miladystation'` (currently inherits from `importedFrom.source`, which is `'civitai'` or similar — the import SOURCE, not the current HOST)
- Verify URL HEAD returns 200
- (Optional) Stamp `contentHash` from a `sha256sum` of the file

**Effort:** trivial. A `--rehost-already-mirrored` flag on the migration script.

### Bucket 2: `civitai` (44 records, ~7 GB) — **mirror then update URI**

For each:
1. HEAD the civitai URL → get real `sizeGb` and `Content-Length`
2. GET the bytes (may need rate limits + Civitai API key)
3. PUT to `models.miladystation2/<dest-path>/<slug>.safetensors`
4. Update the record's `sources[]`:
   - `sources[0] = { provenance: 'miladystation', uri: '<new miladystation URL>' }`
   - `sources[1] = { provenance: 'civitai', uri: '<original>' }` (fallback)
5. Stamp `contentHash`, real `sizeGb`

**Effort:** moderate. Sequential download is fine at this scale; ~7 GB at typical bandwidth is < 1 hour. Civitai rate limits may apply.

### Bucket 3: `huggingface` (12 records, ~7 GB) — **mirror then update URI**

Same shape as civitai. HF is more bandwidth-friendly (no auth needed for public, generous limits). The 12 platform-trained records published their weights to HF; we pull them back.

**Effort:** moderate. Same workflow as civitai.

### Bucket 4: `other_url` (1 record) — **manual review**

One record with an unusual URL. Triage manually.

### Bucket 5: `no_url` (163 records, ~75 GB) — **mirror via ComfyUI Deploy API**

Legacy runtime resolved bytes via `slug` + a ComfyUI Deploy convention rather than recording a URL. Bytes are still in CD storage; CD has an API we have access to.

For each:
1. Query CD API with `slug` (or whatever CD's identifier-by-slug endpoint is)
2. Download the bytes
3. Compute `sha256` while streaming (eager `contentHash` policy)
4. PUT to `models.miladystation2/<dest>` — `dest` already follows ComfyUI's path convention (`models/loras/<slug>.safetensors`)
5. Update the record:
   - `sources[0] = { provenance: 'miladystation', uri: '<new miladystation URL>' }`
   - `sources[1] = { provenance: 'comfyuideploy', uri: '<original CD reference>' }` (fallback)
   - `contentHash = <sha256>`
   - `sizeGb = <real bytes / 1e9, rounded to 0.001>`

**Effort:** moderate. 163 files × ~75 GB sequential pull through CD's API; depends on CD's bandwidth + rate limits. Sequential is fine; parallel only if CD permits.

This was the gate that just opened. With CD API access confirmed, **the full 245-record catalogue is recoverable** — no records lost.

---

## Other legacy fields the migration is currently dropping

Surfaced by surveying distinct keys across the 245-record catalogue. Worth a follow-up patch before any production cutover:

| legacy field | count | recommendation |
|---|---|---|
| `version` (string like `"v3"`, `"v2.1"`) | 216 (88%) | Map to `versio` instead of the hardcoded `"1.0.0"` the migration currently writes. Preserves model versioning history. |
| `migratedFrom` (block from earlier meta-migration) | 6 | Preserve verbatim on `legacy.migratedFrom`. Currently dropped. |
| `rewardStats` (usage/reward aggregates) | 3 | Preserve verbatim on `legacy.rewardStats`. Currently dropped. May contain royalty-relevant data we want to import into the new ledger. |
| `disabled` (boolean) | 0 in legacy | Field exists in schema but unused. Skip. |

**Effort:** trivial. Three more cases in `legacyToIntella`'s "legacy preservation" block.

---

## Bottom-line scope for the weight-migration sprint

Five tiers of work, fully scoped (no gates):

1. **Trivial — rehost the 25 already-at-miladystation records** (metadata only, ~minutes)
2. **Mirror the 44 Civitai records** (~7 GB; rate-limit-defensive batching since limits are unknown — pilot 5 first, observe, then bulk)
3. **Mirror the 12 HuggingFace records** (~7 GB; sequential pull + reupload; ~hour)
4. **Mirror the 163 CD records** via the CD API (~75 GB; the bulk of the bytes; sequential pull through CD)
5. **Triage the 1 outlier URL** (a few minutes)

Plus the small follow-up patches:

6. **`version` → `versio` mapping** (216 records affected; tiny code change in `legacyToIntella`)
7. **`migratedFrom` + `rewardStats` preservation** (9 records affected; tiny code change)

### Bytes-in-flight estimate

| bucket | est. bytes | upload bytes |
|---|---|---|
| miladystation (metadata only) | 0 download | 0 upload |
| Civitai | ~7 GB | ~7 GB |
| HuggingFace | ~7 GB | ~7 GB |
| ComfyUI Deploy | ~75 GB | ~75 GB |
| outlier | unknown | unknown |
| **Total** | **~89 GB** | **~89 GB** |

Roughly a day of sequential pull-and-push at typical bandwidth, longer if CD rate-limits us. Worth parallelizing where the source CDN permits.

### `contentHash` policy: eager

Every byte that passes through the mirror script gets sha256-d in flight and stamped on the Intella record. No lazy backfill. By the end of the sprint every record has both real `sizeGb` and `contentHash`.

---

## Resolutions to v1 open questions (2026-05-25)

| was open | resolved |
|---|---|
| ComfyUI Deploy access | **Yes** — we have the CD API. 163 no-URL bucket recoverable via slug lookup. |
| Civitai rate limits | **Unknown** — pilot 5 records, observe headers/429s, then batch defensively. |
| `models.miladystation2` upload convention | **Mirror ComfyUI's path structure** — `models/loras/<slug>.safetensors`, `models/checkpoints/<slug>.safetensors`, etc. The migration's `dest` field already matches. |
| `contentHash` policy | **Eager** — compute during mirror pass while bytes are in flight. No lazy backfill. |

## Still genuinely open (sprint-time decisions)

1. **Parallelism per source** — Civitai unknown; HF/CD permit parallel pulls but at what concurrency? Start sequential, dial up cautiously.
2. **Retry/resume policy** — if the script dies mid-mirror, do we restart from scratch or resume from `contentHash != null`? Resume is easy with the idempotent upsert; mostly a config flag.
3. **CD records' `sources[1]` fallback** — the original CD reference. Worth keeping for a transitional period (if our mirror has a hiccup, runtime can fall back); decommission when miladystation is proven stable.
