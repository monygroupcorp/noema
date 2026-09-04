# Model base provenance — capturing a classifier-usable base string at training time

**Status: PROPOSAL, unresolved.** This is not yet a decision — options are laid out with
tradeoffs and a recommendation, but the resolution column is deliberately left open pending
sign-off. House style follows `intella-schema-revisions-queue.md`.

**Trigger:** the Shelf page's admin "reclassify license" button
(`CrystalApi.setModelLicense(auctor, id, {reclassify: true})` → `classifyModelLicense`, both in
`modelLicense.ts`) silently no-ops on a real model (`brutalite`, a klein-4B LoRA trained via the
normal local-training path): it recomputes the same `license:'unknown'`/`commercialUse:'unknown'`
verdict the record already had. A separate internal admin route is hand-patching that one record;
this doc is the systemic fix.

---

## 1. What's actually broken (two layers, not one)

### 1a. The already-known layer: `classifyModelLicense`'s fallback chain never reaches a good answer

`classifyModelLicense` (`src/crystal/modelLicense.ts:292`) derives a base string with priority
`provenance.base > nomen > familia`:

- `provenance.base` is only ever set when the training aditus carries an explicit
  `provenanceRepo` (`trainingFinalizer.ts:110-113`) — a field meant for **external retrain
  lineage** ("this LoRA was retrained from HF repo X, whose own base was Y"), not the ordinary
  local-training path. `brutalite` never set it, so `provenance` is `undefined`.
- `nomen` for a trained LoRA is just the display/trigger name (`'brutalite'`) — matches nothing
  in `BASE_TABLE`.
- `familia` (`'flux2'`) is reached last, but per the code comment at `modelLicense.ts:176-180` a
  bare `'flux2'` is deliberately license-ambiguous: klein 4B is Apache-2.0, klein 9B and `[dev]`
  are FLUX.2 Non-Commercial — the family key can't carry the license (that's the entire reason
  `familia` and `license` are documented as separate axes at the top of the file). It fails
  closed to `'unknown'`.

### 1b. The deeper layer, found in this investigation: the license was ALREADY wrong at training time

`trainingFinalizer.ts:103` computes the license at creation, before any reclassify button exists:

```ts
const { license } = classifyBaseModel(String(a.baseModel ?? ''))
```

`a.baseModel` here is **not** a descriptive string — it's the short preset alias the training
modus contract takes as user input (`seeds/modi.ts:327`: *"Base model preset (e.g. klein-4b)"*).
`classifyBaseModel`'s `BASE_TABLE` matchers require the substring `'flux2'` / `'flux.2'` /
`'flux 2'` to even enter the FLUX.2 branch (`isFlux2()`, `modelLicense.ts:342`). `'klein-4b'`
contains none of those. Verified directly against the code in this worktree:

```
classifyBaseModel('klein-4b')                              → { familia: null, license: 'unknown' }
classifyBaseModel('flux2-klein-4b')                         → { familia: 'flux2', license: 'apache-2.0' }
classifyBaseModel('black-forest-labs/FLUX.2-klein-base-4B') → { familia: 'flux2', license: 'apache-2.0' }
```

So a LoRA trained with `baseModel: 'klein-4b'` — the exact alias documented as the expected user
input, and the one used in **13 of 16** cases in `tests/unit/crystal/trainingFinalizer.test.ts`
— is born with `license:'unknown'`/`commercialUse:'unknown'` regardless of `provenanceRepo`. The
`Intella.familia` field comes out correct anyway (`'flux2'`) only because it's computed through a
*separate*, alias-aware path: `canonicalFamilia()` / `FAMILIA_BY_BASE` in `aitkConfig.ts`, which
does know `'klein-4b' → 'flux2'`. License classification and familia classification silently
diverge on the exact same input. This is almost certainly what happened to `brutalite`, and it
explains why reclassify recomputes the same wrong answer: **there was never a correct answer
stored anywhere for it to fall back to.**

Confirming the gap: none of the `baseModel: 'klein-4b'` cases in `trainingFinalizer.test.ts`
assert `license`/`commercialUse` — only the two tests using full descriptive strings
(`'FLUX.1-schnell'`, `'FLUX.1-dev'`, lines 66-78) check the license outcome. This exact failure
mode has zero test coverage today.

The one string already sitting in the codebase that *does* classify correctly is the resolved
preset's HF identifier — `AITK_BASE_PRESETS[key].nameOrPath` (e.g.
`'black-forest-labs/FLUX.2-klein-base-4B'`), reachable via `resolveBasePreset(a.baseModel)`
(`aitkConfig.ts:123`, exported from a module `trainingFinalizer.ts` already imports from). It is
never used for classification and never persisted.

---

## 2. Where the base string should be captured and persisted

### The wrong home: `provenance.base`

`provenance` (`intelligendi.ts:246`) is optional and gated behind `provenanceRepo` — it means
"this artifact was retrained from an external registry repo, and that repo's own base was X." A
LoRA trained through the ordinary local pipeline (the overwhelming majority of trained LoRAs) has
no external repo at all; `provenance` should stay `undefined` for it. Repurposing this field to
also mean "the base this run actually trained against" conflates two different provenance
statements and guarantees the common path stays unpopulated forever — exactly the bug in hand.

### Option A — new always-set field on `Intella`, e.g. `baseModel?: string`

Add a field distinct from `provenance.base`, set **unconditionally** at training finality
(`trainingFinalizer.ts`) from the resolved preset descriptor, not the raw alias:

```ts
const preset = resolveBasePreset(String(a.baseModel ?? ''))   // throws only if baseModel is
                                                                // missing/unknown — but training
                                                                // already required + resolved it
                                                                // to get this far, so this is safe
...
baseModel: preset.nameOrPath,   // e.g. 'black-forest-labs/FLUX.2-klein-base-4B'
```

And fix the SAME line's classification to use the resolved descriptor instead of the raw alias:

```ts
const { license } = classifyBaseModel(preset.nameOrPath)
```

- **Pro:** minimal, additive, no schema migration for existing readers (optional field). Fixes
  both the training-time bug (1b) AND gives `classifyModelLicense`'s fallback chain a precise,
  always-populated source for every *newly trained* LoRA — closing 1a for new records too.
- **Pro:** the value is a plain string, sync, no DB lookup — matches the existing pattern for
  `familia`/`license` classification (pure functions over strings), no architectural change to
  `classifyModelLicense`'s signature.
- **Con:** it's a NEW field, so every existing record (including `brutalite`) still needs backfill
  (§4) — this option doesn't retroactively fix history, only stops the bleeding.
- **Con:** for imports (non-training path, `ModelImporter.ts`/`modelImportResolver.ts`) the
  "resolved descriptor" doesn't exist in the same preset-table shape — the import path already
  has a good base string (HF `baseModel`/tags, or the parsed filename stem) and already classifies
  correctly via `requireBase()`. This field would need a second write site there too if it's meant
  to be universally populated (see §3).

### Option B — auto-resolve + set `baseIntellaId` to the matching canonical base `Intella`

`Intella.baseIntellaId` already exists (`intelligendi.ts:175`, "FK → Intella … PROVENANCE only")
and canonical base records already carry an authoritative, hand-verified license — e.g.
`INTELLA_FLUX2_KLEIN_4B` (`seeds/intellae.ts:757`) is seeded with `license:'apache-2.0'`,
`commercialUse:'yes'`. Today `trainingFinalizer.ts:167` only sets `baseIntellaId` if the aditus
happens to carry one explicitly (rare/never for the standard local flow) — the SAME kind of gap
as (1b), just on a different field. A new `AITK_BASE_PRESETS key → canonical Intella id` map
(e.g. `'flux2-klein-4b' → 'intella.flux2-klein-4b'`) could auto-populate it.

- **Pro:** most architecturally correct answer — points at the actual base record, whose license
  is authored and reviewed, not re-derived from a string pattern at all.
- **Con:** to actually USE this for classification, `classifyModelLicense` would need a DB lookup
  (join `baseIntellaId → Intella.license`) — it's currently a pure sync function over a
  structurally-typed plain object (`LicenseClassifiable`), shared verbatim by the admin reclassify
  path AND the backfill sweep script (which reads raw BSON, no ORM). Making it async changes both
  call sites' shape and is a materially bigger change than Option A.
- **Con:** doesn't help imports or any base not already seeded as a canonical `Intella`.

### Option C — unconditionally populate `provenance.base` (drop the `provenanceRepo` gate)

Set `provenance = { base: <resolved descriptor> }` even with no `provenanceRepo`, i.e. repurpose
the existing field instead of adding a new one.

- **Pro:** zero new field, `classifyModelLicense`'s existing priority order already reads
  `provenance.base` first — no fallback-chain change needed.
- **Con:** breaks the field's documented meaning ("external retrain lineage … the source
  registry repo … + the base it came off," `intelligendi.ts:241-246`) for every ordinary local
  training run, which never has a `repo`. Every consumer of `provenance` (model-card rendering,
  `HfUploader.ts`, anything checking `provenance?.repo` to mean "this is a retrain") would need
  re-auditing to confirm it degrades safely with `repo` absent. Muddies a field that currently has
  one clean meaning.

### Recommendation

**Option A**, with the training-time classification fix (§1b) landing in the SAME change —
they're one bug, not two. Do not repurpose `provenance.base` (Option C): keep "external retrain
lineage" and "the base this run trained against" as separate statements, matching how `familia`
(compat) and `license` (legal) are already kept as deliberately separate axes elsewhere in this
file. Option B (`baseIntellaId` auto-population) is worth doing **too**, independently — it's the
right FK to carry regardless of whether A ships — but treat it as a follow-on, not a blocker: it
needs the async-classifier discussion resolved first, and gets no better an answer than Option A
for anything not already a seeded canonical base (imports, future presets before they're seeded).

### Fallback-chain change in `classifyModelLicense`

New priority: `Intella.baseModel > provenance.base > nomen > familia`. `baseModel` goes first
because, when present, it's the literal resolved training-time source of truth — strictly more
trustworthy than `provenance.base` (which describes a DIFFERENT, external lineage) or `nomen`
(display text). `LicenseClassifiable` (`modelLicense.ts:276`) gains `baseModel?: string`. The
sweep script (`scripts/migrations/2026_07_backfill_intella_license.ts:67-71`) and
`setModelLicense`'s `reclassify` path both call the same function, so both pick this up for free.

---

## 3. Import path — is it affected?

No new gap there: `modelImportResolver.ts` already derives `familia`/license from a real
descriptive string (`version.baseModel`, tag list, or filename stem via `requireBase()` /
`classifyBaseModel`) at import time, and that already-correct license is what's persisted. The
training path is the one that regressed to a bare alias. That said, if Option A's `baseModel`
field is added, `ModelImporter.ts` should also populate it (from the same string it already
resolves against) purely for consistency — so every genus has one classifier-usable field to read,
not "trained LoRAs use `baseModel`, imports fall back to `nomen`."

---

## 4. Backfill for already-affected records

**What's structurally lost:** for a record trained before this fix, the raw alias
(`aditus.baseModel`) was never persisted on the `Intella` itself — only its DERIVED `familia`
was (via `canonicalFamilia`, which collapses klein-4B/9B/dev to the same `'flux2'`). The bare
stored record (`brutalite`'s `Intella` document) genuinely cannot distinguish which klein variant
it was, on its own.

**What IS potentially recoverable — needs a real query, not assumed:**

1. **The training job's `Actum` record.** `acta` is a durable Mongo collection
   (`ensureIndexes.ts:9-11`; indexed on `id`, `externusJobId`, `{status,expirat}` — none of those
   is a TTL-delete index, so nothing here auto-expires records out of the collection). If the
   originating job's `actum.aditus.baseModel` is still in `acta`, the exact alias used is
   directly recoverable — re-run the same `resolveBasePreset(...).nameOrPath` resolution used at
   finality and backfill deterministically, no guessing. This needs someone to actually check
   retention against prod (`acta` may be pruned by an operational process not visible from this
   worktree) before counting on it.

2. **A closed-set heuristic, usable even without `acta`.** `AITK_BASE_PRESETS` (`aitkConfig.ts:36`)
   currently defines exactly **three** trainable presets: `flux2-klein-4b`, `krea2-raw`,
   `zimage`. There is no `klein-9b` or `[dev]` preset configured for in-house training at all.
   So: any `Intella` with `genus:'lora'`, `familia:'flux2'`, and a signal that it went through
   OUR trainer (has `configYaml`/`trainingSteps`/`samples` populated — an import wouldn't carry
   those) can ONLY have been trained on `flux2-klein-4b` → safe to backfill
   `license:'apache-2.0'`, `commercialUse:'yes'` with high confidence. The same closed-set
   argument applies to `familia:'krea2'` → `krea2-raw` (conditional) and `familia:'zimage'` →
   `zimage` (apache-2.0) trained-signal records. This mirrors the heuristic pattern already used
   in `intella-schema-revisions-queue.md` Observation 2 (infer platform-training from a
   co-occurring signal rather than a missing explicit marker).
   - **This heuristic has a shelf life.** The moment a second FLUX.2 preset (e.g. klein-9B or
     `[dev]`) is added to `AITK_BASE_PRESETS`, "familia flux2 + trained-signal" stops being
     1-to-1 with klein-4B. Run this backfill once, soon, and don't leave it as a standing rule.

3. **Genuinely unrecoverable tail:** any affected record with no `acta` row left AND no
   trained-signal fields (e.g. `trainingSteps`/`configYaml` never got backed up, or the record
   predates those fields) has to be accepted as permanently ambiguous and left `unknown` —
   fail-closed, same posture as every other unclassifiable case in `modelLicense.ts`. An operator
   can still clear individual ones via `setModelLicense`'s explicit (non-reclassify) mode once
   they know the true base out-of-band.

**Recommended backfill order:** (1) ship the Option A fix so nothing NEW breaks this way again;
(2) check `acta` retention against prod, backfill from there wherever a matching job record
exists; (3) run the closed-set heuristic sweep over whatever's left with a `familia` +
trained-signal match; (4) accept the remainder as `unknown` and let admin clearance handle
one-offs like `brutalite` was.

---

## 5. Test / migration implications

- **`tests/unit/crystal/trainingFinalizer.test.ts`** — add license/commercialUse assertions to
  the existing `baseModel: 'klein-4b'` cases (currently none of the 13 such cases check it — this
  is the exact untested path that shipped the bug). Add a case asserting the new `Intella.baseModel`
  field is set to the RESOLVED preset descriptor (`'black-forest-labs/FLUX.2-klein-base-4B'`), not
  the raw alias `'klein-4b'`. Add one for `krea2-raw` and `zimage` too (currently only FLUX
  variants get a license assertion at all).
- **`tests/unit/crystal/modelLicense.caps.test.ts`** — currently only covers the cap/tripwire
  functions (`conditionalCapUsd`, `bindingCapUsd`, `activeConditionalLicenses`), not
  `classifyModelLicense`'s fallback chain at all. Add cases for the new priority order:
  `baseModel` beats `provenance.base` beats `nomen` beats `familia`, and a case reproducing the
  `brutalite` shape (`familia:'flux2'`, no `provenance`, `nomen` = trigger word, no `baseModel`)
  to lock in that it correctly still resolves to `'unknown'` (fail-closed) — this is what should
  no longer occur for a NEW record, but must still fail closed for old ones lacking the new field.
- **`tests/unit/crystal/licenseTripwire.test.ts`** — no expected changes; it consumes
  `commercialUse`/`license` verdicts, not the classification source.
- **`tests/unit/crystal/modelImport.test.ts`** — if `ModelImporter.ts` is updated to also set
  `baseModel` (§3), add an assertion that it's populated consistently with the existing
  `familia`/`license` derivation.
- **Migration:** a new one-shot script alongside `scripts/migrations/2026_07_backfill_intella_license.ts`
  — read `acta` where recoverable, else apply the closed-set heuristic (§4.2), else leave
  untouched — following that script's existing `--db`/`--prod`/`--dry-run` safety conventions
  (`resolveDbTarget`). Should run BEFORE any second FLUX.2 preset is added to `AITK_BASE_PRESETS`.

---

## Resolution

| # | topic | recommendation | resolution |
|---|---|---|---|
| 1 | New field vs. repurpose `provenance.base` vs. `baseIntellaId` FK | Option A: new `Intella.baseModel?: string`, populated from the resolved preset descriptor | _open_ |
| 2 | Training-time classification bug (`trainingFinalizer.ts:103` classifying the raw alias) | Fix in the same change as #1 — classify from `resolveBasePreset(...).nameOrPath` | _open_ |
| 3 | `classifyModelLicense` fallback order | `baseModel > provenance.base > nomen > familia` | _open_ |
| 4 | Import path (`ModelImporter.ts`) | Populate the same new field for consistency, not required for correctness | _open_ |
| 5 | Backfill mechanism | `acta`-recovery first, closed-set heuristic second, accept-unknown tail | _open_ |
| 6 | `baseIntellaId` auto-population (Option B) | Worth doing, treat as a separate follow-on, not a blocker | _open_ |
