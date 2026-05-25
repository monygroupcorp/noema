# LoRA trigger resolution — sprint plan (Path A)

**Date:** 2026-05-25
**Predecessors:** chunk migration (`docs/spec/intella-schema-revisions-queue.md`), v2 schema (`docs/spec/intella-schema.md`), v1 resolver (`src/crystal/loraResolver.ts`)
**Successor:** Mod • interactive add (Path B — separate sprint after this one lands)

---

## Goal

End-to-end **`/make` prompt → LoRA resolution → download to studio → execute with corrected syntax** flow, using real legacy data now in `noema_fake.intellae`.

User types: `a portrait of a cat, milady style` → resolver detects `milady` → finds the migrated LoRA → adds it to the spec's required models → comfyrunner downloads if missing → workflow runs with `<lora:milady-slug:1.0>` injected into the prompt → result delivered.

Out of scope here: the explicit Mod • menu where a host pre-queues a model before any /make hits. That's Path B (next sprint).

---

## Three problems this sprint solves

### 1. Resolver tokenizer doesn't reach legacy triggers

`src/crystal/loraResolver.ts` v1 tokenizes prompts on `\s+ + [.,!?()[\]{}'"]` and matches per-token against the triggerMap. That can't reach triggers like:
- `artist:moriimee` — colon inside a single token
- `1990s \(style\)` — escaped parens + space
- `retro artstyle` — multi-word

Real chunk-migration data has all three. Need a substring-scan path that survives these character classes.

### 2. `noema_fake.intellae` records are spec-v2 shape; resolver consumes v1

The chunk migration's output uses the v2 discriminated union (`params.triggerWords: string[]`, `params.baseIntellaId`, etc.). The current `MongoIntella` reads v1 (`trigger: string`, `baseIntellaId` at the top level). The resolver indirectly inherits this — when it asks `intellarum.triggerMap(...)`, it expects v1 fields.

Two ways to bridge:
- Full type refactor (separate sprint)
- A backward-compat reader on `MongoIntella` that projects v2 records back to v1 shape at read time

This sprint picks the second — minimal-surface-area approach that unblocks the resolver work without touching every read site.

### 3. Download for a fresh-trigger LoRA must land on the studio before inference

If a guest gen mentions `milady` and milady isn't on the studio's volume yet, the workflow has to wait for the download. Need to confirm:
- The Compiler's `_resolveModels` produces a spec.models entry for the resolved LoRA (we wired this in `feat(lora):` earlier — verify against v2 records now)
- comfyrunner downloads any model in spec.models that isn't on the volume (it already does this; verify)
- `Materia.installedModels` updates via the webhook after download (we wired this in wrap-up sprint — verify)

So mostly verification + wiring, not new code, for problem 3.

---

## Sprint items (6, ~12h dev + verification)

### 1. Resolver upgrade — substring scan for legacy trigger formats (~4h)

`src/crystal/loraResolver.ts` gains a Pass 1 phase that runs BEFORE the existing tokenize-and-match path.

```
Pass 0: handle pre-existing <lora:slug:weight> tags (unchanged)
Pass 1 (NEW): substring scan for each trigger in triggerMap
  - For each trigger key (lowercased, escaped for regex):
    - Find all matches in the prompt (case-insensitive)
    - For each match, look ahead for weight modifiers:
      - `:N.N` → explicit weight
      - `!+` → +0.2 per `!`
      - `\.+` → -0.2 per `.`
    - Resolve via existing conflict-resolution logic (private > shared > public, by recency)
    - Replace the matched substring (+ weight modifier suffix) with the <lora:slug:weight> tag
    - Track range to avoid double-matching overlapping triggers
Pass 2: tokenize what's left + existing single-token resolution (unchanged; handles simple alphanumeric triggers)
```

Edge cases to handle:
- Two triggers where one contains the other (`'a'` inside `'artist:moriimee'`) — match the longer one first; left-to-right by trigger length descending
- Same trigger appearing twice in the prompt → apply LoRA once, drop duplicate occurrences
- Trigger with regex metacharacters (`(`, `)`, `.`, `\`) → escape on regex compilation
- Weight modifier `:0.0` → silence (don't apply LoRA, keep the trigger text)

**Files:**
- `src/crystal/loraResolver.ts` — add `_substringScan(prompt, triggerMap, opts)` helper called from `resolveLoraTriggers` before the existing Pass 2

**Tests:**
- `tests/unit/crystal/loraResolver.test.ts` — extend the existing 17-case suite with ~10 new cases:
  - `artist:moriimee` → resolves correctly
  - `1990s \(style\)` → resolves correctly with escaped parens
  - `retro artstyle` → multi-word resolves
  - Trigger-with-weight-modifier: `artist:moriimee:0.5` → explicit weight applied
  - Trigger-with-exclamation: `artist:moriimee!!` → defaultWeight + 0.4
  - Two overlapping triggers, longer wins
  - Same trigger twice in prompt → LoRA applied once
  - Trigger containing regex metachars properly escaped

### 2. `MongoIntella` reads v2 records, projects to v1 at read time (~3h)

Backward-compat shim — detect record shape, normalize before returning.

```ts
function projectV2ToV1(doc: Document): Intella {
  // If doc has params.triggerWords, it's v2-shape; flatten to v1
  if (doc.params?.triggerWords) {
    return {
      ...doc,
      trigger: doc.params.triggerWords.join(','),  // resolver still expects string for the legacy interface
      slug: doc.params.slug,
      defaultWeight: doc.params.defaultWeight,
      baseIntellaId: doc.params.baseIntellaId,
      access: doc.access?.kind === 'private' ? 'private' : 'public',  // collapse the discriminator
      ownerAnimaId: doc.access?.ownerAnimaId ?? doc.ownerAnimaId,
    } as Intella
  }
  return doc as Intella  // v1 — pass through
}
```

Applied inside `MongoIntella`'s `fromDoc` so every public method (`find`, `findByTrigger`, `triggerMap`, `list`, `canonical`) returns v1-shape to callers without them caring about the source shape.

**This is a transitional shim.** The proper type refactor (`Intella` v1 → v2 in `src/types/intelligendi.ts`) is a separate sprint. This shim survives until that lands.

**Files:**
- `src/crystal/MongoIntella.ts` — add `projectV2ToV1` + call from `fromDoc`

**Tests:**
- `tests/unit/crystal/MongoIntella.test.ts` (if exists; else new) — round-trip a v2 record through the store, assert it comes back as v1 with `trigger`, `slug`, `defaultWeight` at the top level

### 3. Compiler/LoRA-injection verification against v2 records (~2h)

The Compiler's `_resolveModels` already runs the resolver and appends resolved LoRAs to `spec.models`. Need to verify this still works when the underlying records are v2-shape (going through the shim from item 2).

**Files:**
- No code changes expected; this is a verification + maybe a small test addition

**Tests:**
- `tests/unit/crystal/Compiler.test.ts` — add a test that uses a v2-shape Intella record (via the shim) and asserts the resolver picks it up + `spec.models` includes the LoRA

### 4. End-to-end fake-mode `/make` verification (~2h)

Live boot fake mode against `noema_fake.intellae` data. Run a `/make` with a prompt that triggers one of the migrated LoRAs.

Pre-flight check: the resolver needs `intella.flux-base` etc. as actual records in noema_fake.intellae (they're seeded at fake-mode boot — verify the 4 canonical bases are findable by `baseIntellaId`).

Test prompts (using triggers from the chunk migration):
- `a portrait, milady style` — should resolve `miladyy` (one of the FLUX-base LoRAs from chunk migration)
- `a moody scene, artist:moriimee mood` — should resolve the colon-trigger LoRA via the new substring path

Expected flow:
1. /make hits CommandRouter → ExecuteFlow → inceptor → cursor.run
2. Compiler.compile reads modus, runs loraResolver against `noema_fake.intellae`
3. Resolved LoRA added to spec.models
4. (In fake mode) FakeRunPodClient simulates download + execution
5. Webhook completes; `Materia.installedModels` updated

**Files:**
- No code; this is a manual verification + a logged test transcript saved at `docs/runbooks/2026-05-25-trigger-resolution-e2e.md` (artifact, not committed code)

### 5. Mod • → View loadout still works against v2 records (~1h)

Verify the wrap-up sprint's `_fetchLoadout` correctly reads installed-model names from v2 records via the shim. Spot-check in fake mode.

**Files:**
- No code changes expected; might need to update `_fetchLoadout` if it accesses v2-specific fields. Confirm during verification.

### 6. Full sweep + commit (~1h)

- `npm run test:crystal` should remain at 0 new failures
- `npx tsc --noEmit` clean
- Commit the resolver upgrade + Mongo shim + tests

---

## Out of scope (Path B and other follow-ups)

- **Mod • interactive Add** — pre-queueing a model onto a warming studio via the host's UI. Separate sprint after this lands. Depends on the runtime download path being verified here.
- **Type refactor** `src/types/intelligendi.ts` v1 → v2 — the shim from item 2 is a stopgap; proper refactor is its own sprint. (Touches MongoIntella, Compiler, resolver, seeds — several files.)
- **Cross-platform Explore UX** — the `/explore` Telegram command + Mod • Explore submenu + `/arm` model picker. Depends on this sprint AND the type refactor.
- **Per-user (private/shared) trigger maps in fake mode** — fake mode doesn't have a real identity resolver; the resolver receives `animaId: undefined` → only public LoRAs match. Real identity scoping waits for the type refactor + `/arm` wizard.
- **Weight migration** — the actual mirroring of bytes off ComfyUI Deploy. Tracked separately at `docs/plans/2026-05-25-weight-migration-sprint.md`.

---

## Definition of done

- Resolver handles `artist:moriimee`, `1990s \(style\)`, `retro artstyle` — verified via tests + a fake-mode `/make` transcript
- `MongoIntella` returns v2 records as v1-shape to all callers
- Compiler's `spec.models` includes resolved LoRAs from v2 records (no shape errors)
- `noema_fake` fake-mode /make against a migrated LoRA executes to completion (FakeRunPodClient simulates the download)
- `Materia.installedModels` reflects the newly-downloaded LoRA after webhook
- `loraResolver.test.ts` extended with ~10 new cases, all green
- Crystal sweep + allocutio sweep at 0 new failures
- Manual /make transcript captured in `docs/runbooks/`

---

## Open questions (resolve during build)

1. **Performance** — substring scanning every trigger key against every prompt is O(N×M). With 245 triggers and short prompts (≤100 tokens) this is fine. If the catalogue grows to thousands, we'd want a trie / Aho-Corasick variant. v1 sticks with naive scan.

2. **Overlap policy** — if a prompt contains both `'a'` and `'artist:moriimee'`, and both are triggers, the longer-trigger-wins rule is in item 1. But what if `'milady'` and `'milady-v3'` are both triggers? Longest match wins. Same rule.

3. **Modus-aware triggers** — the resolver currently takes `baseIntellaId` to filter LoRAs to the compatible base. A prompt for a FLUX gen with `'artist:moriimee'` (an SDXL LoRA) won't resolve — the SDXL LoRA isn't in the triggerMap for FLUX. Correct behavior; verify in tests.

4. **`noema_fake.intellae` vs production** — for now the resolver reads whichever the `Intellarum` instance was constructed with. Fake mode wires noema_fake; production still wires production noema. After the type refactor we can migrate to a single collection.

---

## Estimate

| item | time |
|---|---|
| 1. Resolver substring-scan upgrade | 4h |
| 2. MongoIntella v2 shim | 3h |
| 3. Compiler integration verify | 2h |
| 4. End-to-end fake-mode verification | 2h |
| 5. Mod • → View loadout verify | 1h |
| 6. Sweep + commit | 1h |
| **Total** | **~13h** (~1.5 days clean) |
