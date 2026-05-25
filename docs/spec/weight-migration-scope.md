# Weight migration — sizing & scope

**Date:** 2026-05-25
**Status:** scoping doc, derived from chunk-migration findings against the live legacy catalogue (N=245).
**Successor to:** `docs/spec/intella-schema.md` + `intella-schema-revisions-queue.md`
**For:** the future sprint that moves `.safetensors` bytes off ComfyUI Deploy (and other current hosts) onto `models.miladystation2`.

---

## TL;DR

- **245 LoRA records** in the legacy `noema.loraModels` catalogue.
- **Estimated total disk:** ~92 GB (per-architecture defaults; real bytes likely 50–200% of this).
- **Already at miladystation:** 25 records (~3 GB) — **no move needed**, just metadata cleanup to mark provenance correctly.
- **Movable:** 56 records (~17 GB) — bytes live at civitai (44) or huggingface (12); HEAD + reupload.
- **Lost / unresolvable:** 163 records (~75 GB) — no URL in legacy. Either rummage through old infra to find them, or accept the loss.
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
| `no_url` (orphans + unattributed) | 163 | 67% | ~75 GB | No URL anywhere in legacy. Records exist with metadata (slug, triggers, checkpoint) but no link to the bytes. **Most of the catalogue.** |

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

### Bucket 5: `no_url` (163 records, ~75 GB) — **the hard one**

These records have no resolvable byte source in legacy. Three sub-cases to investigate:

1. **Files exist in ComfyUI Deploy storage but the URL wasn't recorded** — the legacy runtime probably resolved bytes via slug + a deployment-side convention. If ComfyUI Deploy still has them, we can pull (via API or filesystem access) using slug as the key.
2. **Files are on a previous server** — disk we no longer have, backup we can find.
3. **Files are gone** — the catalogue entry exists but the bytes don't. The slug + triggerWords are catalogue metadata only.

**Recommendation:** before deciding, scan ComfyUI Deploy storage for files matching the 163 slugs. The intersection tells us how many are recoverable. If most are recoverable, this is just a download. If most aren't, we accept the loss + either drop the records or keep them as catalogue-metadata-only entries with a `blocked: true` flag.

**Effort:** unknown until ComfyUI Deploy storage is enumerated.

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

Three tiers of work:

1. **Trivial — rehost the 25 already-at-miladystation records** (metadata only, ~minutes)
2. **Mirror the 56 retrievable records** (Civitai + HF; ~14 GB; sequential pull + reupload; ~few hours)
3. **Investigate the 163 no-URL records** — scan ComfyUI Deploy storage by slug, decide drop-or-recover. **This is the gate; depending on what we find, the sprint is 1 day or 1 week.**

Plus the small follow-up patches:

4. **`version` → `versio` mapping** (216 records affected; tiny code change)
5. **`migratedFrom` + `rewardStats` preservation** (9 records affected; tiny code change)

---

## Open questions for the next sprint

1. **ComfyUI Deploy filesystem/API access** — do we have credentials + a method to enumerate stored .safetensors files by slug? If yes, the 163 no-URL bucket becomes recoverable. If no, that's the gate.
2. **Civitai API rate limits** — does the user account have enough quota for a 44-LoRA bulk download? Otherwise we batch over time.
3. **`models.miladystation2` write access + path convention** — what's the upload path / bucket structure? Migration needs to know.
4. **`contentHash` policy** — stamp during migration (slower, accurate) or stamp lazily by the comfyrunner after first download (faster, eventual consistency)? Spec §3 says lazy; weight migration is a chance to do it eagerly while we have the bytes.
