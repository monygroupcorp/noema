# TASK-007: Prompt affixes — flow-baked prefix/suffix on a text Porta

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: Compiler weave + builder + menu are unit-tested; real gen on staging.)

Finish the saved-version story ("save a *style*"): a saved flow can carry a **prefix/suffix** baked onto
its prompt Porta, so `/run watercolor a fox` → `a fox, watercolor, masterpiece`. The user supplies the
variable; the flow supplies the wrapper. Per-flow only — **account-level affixes (Consuetudo) are NOT
in scope** (deliberately dropped). Purely additive on TASK-006: it sets `Porta` fields TASK-006 leaves
unset and weaves at the compile seam ahead of the existing pipeline — nothing is reworked.

## Read first
- `AGENTS.md`, ADR-0003/0004.
- `src/types/modus.ts` — the `Porta` interface (add the two fields).
- `src/crystal/Compiler.ts:114–146` — the prompt → `resolveLoraTriggers` → `slotMap` ordering (the
  weave goes BEFORE lora resolution).
- `src/crystal/deriveSavedModus.ts` — `DeriveSavedModusOpts` + how it sets `Porta.default`s.
- `src/allocutio/telegram/SaveAsMenu.ts` (the `affixPlaceholder` at ~198, the `Draft`, promptMode toggle)
  + `src/allocutio/lexicon/copy.ts:188` (`saveAs.affixPlaceholder` to replace).
- `tests/unit/crystal/Compiler.sd15.test.ts`, `tests/unit/crystal/deriveSavedModus.test.ts`,
  `tests/unit/allocutio/SaveAsMenu.test.ts`.

## Deliverables
1. **`Porta` fields** (`modus.ts`): `praefixum?: string` + `suffixum?: string` — flow-baked text woven
   around a **text** Porta's value at compile. Document them on the interface.
2. **Compiler weave** (`Compiler.ts`): before the existing lora resolution, build a `wovenAditus` where
   each **text** Porta (`porta.type === 'text'`) with a `praefixum`/`suffixum` and a string value is
   rewritten to `[praefixum, value, suffixum].map(s => s.trim()).filter(Boolean).join(', ')`. Then the
   **existing** `resolveLoraTriggers` runs on `wovenAditus.prompt` and `_applySlotMap` on `wovenAditus`.
   - **Order matters:** weave is BEFORE lora resolution so a trigger word *inside* an affix still
     resolves. A small helper `weaveAffixes(value, porta)`; affixes absent → value unchanged (no-op).
3. **Builder** (`deriveSavedModus.ts`): add `promptPraefixum?: string` + `promptSuffixum?: string` to
   `DeriveSavedModusOpts`; when set, bake them onto the **prompt** Porta (`praefixum`/`suffixum`).
   Independent of `promptMode` — an `open` prompt may still carry a suffix (the wrapper applies to
   whatever the user types at run time).
4. **SaveAsMenu** (`SaveAsMenu.ts` + `copy.ts`): replace the `affixPlaceholder` with a real affix
   affordance in the review — buttons to set a prompt **prefix** and **suffix** (force-reply each,
   mirroring the name prompt; the review shows the current prefix/suffix). Thread them through to
   `deriveSavedModus` as `promptPraefixum`/`promptSuffixum`. (UI sets the **prompt** Porta only; the
   crystal weave is general over text Portae.)

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, with NEW tests:
  - **Compiler weave:** a Modus whose prompt Porta has `suffixum:'watercolor, masterpiece'` →
    compiled prompt (in the slotted text node) = `<user prompt>, watercolor, masterpiece`; `praefixum`
    likewise prepends; both absent → prompt unchanged.
  - **weave-before-lora:** a `suffixum` containing a registered LoRA **trigger word** (familia-matched)
    → `appliedLoras` includes that LoRA (proves weave precedes `resolveLoraTriggers`).
  - **builder:** `deriveSavedModus(base, { …, promptSuffixum:'x' })` → derived prompt Porta has
    `suffixum:'x'`; works with `promptMode:'open'` (no default) AND `'pinned'`.
  - **SaveAsMenu:** setting a suffix → `deriveSavedModus` called with `promptSuffixum`; the placeholder
    copy is gone.

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Out of scope
- **Account-level / `Consuetudo` affixes** (option B) — dropped, not now, no seam contortion.
- Affixes on non-prompt Portae **via the UI** (the crystal weave supports any text Porta; the menu only
  offers the prompt).
- Flow-card display of a flow's affixes; configurable separators (comma-join is the default).
- Real gen correctness — staging.
