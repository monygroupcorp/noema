# Handoff — Implement ADR-0012 model-licensing enforcement (the `license` field)

- **Date:** 2026-07-02
- **ADR:** `docs/adr/0012-licensing-source-and-models.md` (Part B)
- **Blocked by JS teardown?** **NO.** Fully within crystal (`src/types`, `src/crystal/seeds`, Editio). Independent of the legacy-JS nuke. Can proceed immediately.

## 0. Ground rules (non-negotiable)
- Crystal-first: reduce to the smallest primitive change. Do **not** add new nouns if an existing field carries the meaning.
- Pin DB targets to `noemaplane` / `noemaplane_test`. Never touch `noema` (prod).
- This is engineering enforcement of a policy, not the policy itself — do not relitigate ADR-0012.

## 1. What is already decided (do not relitigate)
- License lives as a **structured field**, not prose. Today it is only comments: `src/crystal/seeds/fundamenta.ts:152`, `src/crystal/seeds/essentiae.ts:237`.
- The field gates monetization: Editio sell/mint/publish must **refuse** a model whose license forbids commercial use.
- Base-model **floor** rule: a derivative (user LoRA) can never be freer than its base. Confirmed clean commercial bases: FLUX.1 schnell (Apache), FLUX.2 **klein 4B** (Apache). Encumbered: FLUX.1 dev (non-commercial), klein **9B** (non-commercial), Krea 2 (<$1M-total-revenue cap — platform-level, see the accounting handoff).

## 2. Verified code anchors (confirmed present 2026-07-02)
- `src/types/fundamentum.ts` — the `Fundamentum` type; add the `license` descriptor here (and/or on `Intella`, the weight primitive).
- `src/crystal/seeds/fundamenta.ts`, `src/crystal/seeds/essentiae.ts` — seeds carrying the prose license comments to migrate into the field.
- Editio publishing arm (see `project_publishing_editio` memory / `docs/spec/publishing.md`): `modelRoyaltyHook`, `MintAdapter`, `ModelPublishAdapter`, the sell/mint/publish paths that must read the field.

## 3. Build order (each phase independently testable)
1. **Define the descriptor.** Add `license` to `Fundamentum`/`Intella`:
   `{ spdx: string; commercialUse: boolean; commercialCap?: { currency: 'USD'; amount: number; basis: 'total-company-revenue-ttm' }; attributionRequired?: boolean; source?: string }`.
   Keep it a plain data field — no new noun.
2. **Backfill the catalog.** Migrate the prose comments in `fundamenta.ts` / `essentiae.ts` into the field. schnell/klein-4B → Apache/commercialUse:true; dev/klein-9B → non-commercial/commercialUse:false; Krea → commercialUse:true + commercialCap.
3. **Floor enforcement at train time.** Where a training run selects a base, reject bases whose license forbids the intended downstream use for catalog-tier training (permissive bases only).
4. **Monetization gate.** In Editio sell/mint/publish, read the resolved model's `license` (LoRA → its base floor) and refuse when `commercialUse:false`. Surface the reason to the user.

## 4. Acceptance tests (go/no-go)
- Every catalog `Fundamentum`/`Intella` carries a valid `license` descriptor (test asserts non-null).
- A `commercialUse:false` model (e.g. a dev-based LoRA) **cannot** reach a commercial export/mint path — the gate blocks it with a clear reason.
- A schnell/klein-4B-based LoRA passes the gate.
- Floor: a LoRA resolves to its base's license, not a looser self-declared one.

## 5. Relationship to the JS teardown
None. This vertical is entirely crystal. It can land before, during, or after the nuke without dependency. It is also a **go-pro prerequisite** independent of teardown (ADR-0012).

## 6. Pointers
- ADR-0012 `docs/adr/0012-licensing-source-and-models.md`
- Memory `project_licensing_and_accounting`, `project_publishing_editio`, `project_fundamentum_primitive`
- Spec `docs/spec/publishing.md`
