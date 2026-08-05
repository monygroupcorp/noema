# Intella schema — revisions queue

**What this is:** observations from real legacy data that the spec at `intella-schema.md` doesn't handle cleanly, captured so we revise it before committing the migration. Each item should land as a spec patch (or an explicit "accept the limitation, deal with it later") before the chunk migration runs with `--commit`.

**Source:** dry-run of `scripts/migrate-loras-chunk.ts --n 25` against the legacy `noema.loraModels` collection. 25 most-recently-used LoRAs.

---

## Observation 1 — trigger words with colons + escaped parens + spaces

**The data:** Legacy records carry trigger words like:
- `artist:moriimee` (colon)
- `1990s \(style\)` (escaped parens, spaces)
- `retro artstyle` (multi-word, space)

**The problem:** Our v1 prompt resolver (`src/crystal/loraResolver.ts`) tokenizes prompts with this regex:

```ts
const WORD_AND_WEIGHT_REGEX     = /^([a-zA-Z0-9_.-]+)(?::(\d*\.?\d+))?/
const SPLIT_KEEP_DELIMITERS     = /(\s+|[.,!?()[\]{}'"]+)/g
```

The character class for word tokens is `[a-zA-Z0-9_.-]` — colons aren't included. A prompt containing `artist:moriimee` parses as the token `artist` (the `:moriimee` falls off as trailing punctuation). The triggerMap key is `artist:moriimee` (lowercased); lookup fails.

Parens and spaces compound the issue: `1990s \(style\)` in a prompt gets split into `1990s`, `(`, `style`, `)` — none of which match the multi-word trigger.

**Options:**

1. **Migration normalizes triggers to resolver-friendly forms** — strip colons, drop multi-word triggers, log warnings. Lossy but keeps the resolver simple. Authors would have to use the simplified form.
2. **Resolver learns N-gram matching** — try multi-token sequences against the triggerMap. Heavier; needs window logic + scoring.
3. **Migration filters non-resolvable triggers out of `params.triggerWords`** but stashes the original on `legacy.originalTriggers` — explicit data loss with a path back when we improve the resolver.
4. **Accept the limitation** — these triggers exist in the catalogue but won't auto-resolve. Users invoke via `<lora:slug:weight>` explicit syntax instead. Slug is always alphanumeric and works.

**Recommendation:** option 3 — preserve the data on `legacy.originalTriggers`, drop only what the resolver can't handle from `params.triggerWords`. The resolver gets to be smarter later without re-migrating.

---

## Observation 2 — 60% of records lack `importedFrom.source`

**The data:** 15 of 25 records in the chunk have NO `importedFrom` block. They're older records from before the field was added.

**The problem:** The spec's authorship branching depends on `importedFrom.source`:
- `'platform-training'` → `authorAnimaIds = [createdBy]`
- everything else → authorless (importer becomes owner)

For records without source, the migration defensively treats them as imported/authorless. But many of those 15 are likely **platform-trained** — they just lack the explicit marker because they predate the field.

**The 15 affected records all share one `createdBy = 681a27d761a6acd963d084dd`** — the same curator. This curator's role is ambiguous from the data: were they the trainer? The importer? Both?

**Options:**

1. **Heuristic: if `trainedFrom` block is populated, treat as platform-trained.** Legacy `trainedFrom: {trainingId, captionSetId, tool, steps}` is a strong signal the LoRA was trained on-platform.
2. **Heuristic: if `publishedTo.huggingfaceRepo` is set, treat as platform-trained.** Records published to HF were likely trained here and pushed out.
3. **Manual curator review** — admin sweep marks each record explicitly.
4. **Accept the default** — all old records become authorless; the curator gets the importer/owner royalty for them. Not strictly correct but uniform.

**Recommendation:** option 1 + 2 combined as a fallback in `legacyToIntella`. If `importedFrom.source` is missing AND (`trainedFrom` OR `publishedTo`) is set, infer `'platform-training'`. This recovers attribution for the records that did pass through our training pipeline.

---

## Observation 3 — Civitai imports marked `visibility: private`

**The data:** All 10 Civitai imports in the chunk have `visibility: 'private'` in legacy → migrated to `access.kind: 'private'` with empty `sharedWith: []`.

**The problem:** Civitai LoRAs are public content. Importing them shouldn't make them private. Either:
- The legacy import flow defaulted to private (a bug or deliberate caution)
- The curator manually set them private for their own use
- The records ARE supposed to be private — curator's personal stash

Without context, the migration faithfully preserves the legacy state. But if the intent was public, every one of these LoRAs is unusable to anyone but the curator.

**Action needed:** confirm with the user. Is `visibility: 'private'` on imports intentional, or a legacy default that should be overridden in the migration?

**Recommendation:** ask before committing. If imports should default to public, add a migration override: legacy `visibility === 'private'` AND `importedFrom.source !== undefined` (i.e., actually imported, not user-trained-and-marked-private) → migrate as `access.kind: 'public'` with a warning logged.

---

## Observation 4 — single curator concentration

**The data:** All 25 records have the same `createdBy = 681a27d761a6acd963d084dd`. The "importer baby royalty" concept lands on one anima for every guest gen using these LoRAs.

**The problem:** Not a spec issue per se, but a real-world economic implication: one curator anima will earn the owner royalty (5% per gen, capped at 10% per workflow) on every popular LoRA. At meaningful platform scale this is a substantial revenue stream concentrated on one person.

**Action needed:** none for the spec — the model works as written. But worth flagging to the user as an outcome of the design: the curator is being rewarded heavily for catalogue curation, which may or may not match their intent.

---

## Observation 5 — slug munging in legacy is good

**The data:** Legacy slugs like `90-s-retro-illustrious-noobai-style-lora-6852a3` are already lowercase-kebab + `-XXXXXX` hex suffix from the legacy `_id`. The suffix guarantees uniqueness per legacy `_id`; the kebab form is resolver-safe.

**The implication:** The spec's "slug is unique" invariant is preserved by the legacy data shape — no collisions detected in the chunk. Migration `legacyToIntella` can trust `doc.slug` and not synthesize from `id`. (Current fallback `'legacy-' + id.slice(0,8)` only triggers when slug is missing.)

**Spec action:** none; the spec is correct. Document this as "legacy slug munging already gives us uniqueness" in §13.

---

## Observation 6 — `paramCount`, `sizeGb`, `contentHash` all empty

**The data:** None of the 25 records have `paramCount`, `sizeGb`, or `contentHash` populated. The legacy `loraModels` schema doesn't include those fields.

**The problem:** The spec's §7 says `sizeGb: number` is REQUIRED. The transform currently defaults to `0`. That's a fib.

**Options:**

1. **Make `sizeGb` optional in the spec.** Acknowledge that legacy data doesn't carry it; populate lazily from comfyrunner's `executio.downloadBytes` after the first use.
2. **Keep required, sentinel value 0 means "unknown."** Adds noise — anyone reading "0 GB" might think it's a tiny model.
3. **Backfill during weight migration.** When we move bytes to R2, hash + size become available; backfill all records.

**Recommendation:** option 1 — `sizeGb?: number` in the spec. Same for `contentHash` (already optional). Populated lazily.

---

## Observation 7 — `sources[]` derived from `publishedTo.huggingfaceRepo` works

**The data:** All 25 records produce a non-empty `sources[]` (the aggregator's `noSourceUri: 0` confirms). For Civitai imports it's via `importedFrom.url`; for legacy records without `importedFrom`, it's the synthesized HF URL from `publishedTo.huggingfaceRepo` + slug.

**Confirmation:** the fallback chain in `legacyToIntella` works. No spec change needed.

---

## Observation 8 — `authorAnimaIds === []` count

**The data:** 25/25 records are authorless after migration. Largely because:
- Observation 2 (60% missing source → defensive authorless)
- The 10 Civitai imports correctly authorless

**Implication:** In the spec's authorship model, the 5% per-model royalty goes to the `ownerAnimaId` (= curator) for ALL 25. No author rail fires (which is correct since `authorAnimaIds = []` means no on-platform author).

This is consistent with the spec. But it means the test fixture for "platform-trained author rail" doesn't actually exercise real data from this chunk. Worth seeking out a platform-trained record (one where `trainedFrom` is populated AND `createdBy` is a regular user, not the curator).

---

## Summary — resolutions (2026-05-25 post-review)

| # | obs | resolution | landed in |
|---|---|---|---|
| 1 | Trigger words with colons / escaped parens / spaces don't survive the v1 resolver tokenizer | **KNOWN GAP, deferred to resolver upgrade.** Migration preserves the raw legacy strings verbatim in `params.triggerWords` — these triggers are baked into the model weights, the resolver has to learn them. Tracked as a follow-up sprint (substring-match tokenizer + weight-modifier lookahead for multi-token triggers). | revisions queue (this doc) |
| 2 | 60% of records lack `importedFrom.source` | **Heuristic added.** When source is missing AND (`trainedFrom` OR `publishedTo`) is set → infer `'platform-training'`. Re-dry-run after the patch flipped 12 of 15 affected records from authorless to platform-trained. | spec §13 + `legacyToIntella` |
| 3 | Civitai imports marked `visibility: 'private'` | **Intentional.** User confirmed: the curator's personal stash; deliberately not polluting the public menu (mostly SDXL, somewhat spicy). Migration preserves as-is. | no change |
| 4 | Single-curator concentration on owner royalty | **Confirmed intentional.** The curator anima IS the platform operator; their owner royalty is effectively the platform's royalty. No change. | no change |
| 5 | Legacy slug munging produces unique slugs naturally | Doc-only acknowledgement. | revisions queue (this doc) |
| 6 | `sizeGb` empty in legacy but spec says required | **Migration populates from per-architecture defaults** (FLUX≈0.5, SDXL≈0.15, SD1.5≈0.1, KONTEXT≈0.5, Illustrious≈0.15). Weight-migration sprint replaces with real bytes. | spec §3 + `legacyToIntella` |
| 7 | `sources[]` derivation works for all 25 | No change. | — |
| 8 | All 25 records authorless after first dry-run | Heuristic from Obs 2 fixed this: now 12 platform-trained + 13 authorless. | — |

## Re-dry-run results after the patches

```
total: 25
canonica: 0
authorless: 13        ← was 25
platformTrained: 12   ← was 0 (heuristic recovered 12 records)
withImporter: 13
privateAccess: 12     ← 10 Civitai + 2 others, all intentional
unlistedAccess: 0
publicAccess: 13
withMonetization: 0
noSourceUri: 0
withWarnings: 15      ← 12 heuristic-inferred + 3 fully unattributable
```

Authorship rail now fires for the 12 platform-trained records (5% owner royalty → user's curator anima). Remaining 13 authorless = 10 Civitai imports (curator becomes owner) + 3 legacy records too sparse to attribute.

## Known gap deferred to a separate sprint

**Trigger-word resolver upgrade.** The legacy carries triggers like `artist:moriimee`, `1990s \(style\)`, `retro artstyle`. They're baked into the model weights and can't be reshaped. Our v1 resolver tokenizer can't reach them. Needs:

- Substring-scan over `triggerMap` keys (not word-tokenize)
- Weight-modifier lookahead `(\:\d+\.?\d*)?` after the matched trigger
- Tests for: trigger-with-colon, multi-word trigger, trigger-with-escaped-parens

Until this lands, those LoRAs are slug-only (users have to type `<lora:slug:weight>` explicitly). Spec note added to §15 / revisions queue.

## Status

Spec + transform patched. Re-dry-run output shows real-world records now mapping correctly. Ready to `--commit` to `noema_fake.intellae` when the user signals go.
