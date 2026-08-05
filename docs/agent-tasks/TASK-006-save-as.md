# TASK-006: Save-as — a flow card / delivery-info menu → a derived `Modus`

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: the derived-Modus builder + menu logic + collision check are unit-tested
  with mocked `Modorum`/identity. The Mongo `auctor` serialization, real identity→owner, and end-to-end
  `/run <saved-slug>` validate on staging.)

"Save as my flow" — from the **flow card** (TASK-004) or the **delivery info tab**, register the current
configuration as a **derived `Modus`** the user owns: it captures the flow's `intellae` manifest (incl.
any pinned loadout LoRAs), the config as `Porta.default`s, a prompt mode (open/pinned), a global-unique
name, and a `fonte` parent link. Then `/run <your-slug>` runs it and `/flows` lists it. This realizes
the ADR-0003 saved-version (full case) and is the task that builds the **owner-keyed persistence**
(`Modus.auctor` widened to `{animaId}|{commitment}`) the rest of the layer needs.

## Builds on
- TASK-005 — `Modus.intellae` (the manifest a saved flow captures) + `familia`.
- TASK-004 — the flow card (`state.aditus`, `a:execute`); add an `a:saveas` button.
- TASK-003 — the `bindVerb` seam (the optional "save as canon verb" path reuses it).
- ADR-0003 §3–4 — the owner model: `{ animaId } | { commitment }` (reuse `Collectio.by`'s union; anon
  users own via their arcanum `commitment`).

## Read first
- `AGENTS.md`, ADR-0001, ADR-0003.
- `src/types/modus.ts` (`Modus.auctor` — widen; add `fonte`; `Modorum.register/find/list`),
  `src/flow/types.ts:103` (the `AuctorKey` type to reuse), `src/types/actumIndex.ts:27` (precedent for
  importing `AuctorKey` into `src/types`), `src/types/actum.ts:135` (`Actum.pinnedModels`, first-class),
  `src/api/webhooks/executionWebhook.ts:163–166` (the one `Modus.auctor` reader to migrate).
- `src/crystal/hashModus.ts` (contentHash for the built Modus), `src/crystal/MongoModorum.ts`
  (`register`; `auctor` (de)serialization + the `list` filter).
- `src/allocutio/lexicon/delivery/DeliveryMenu.ts` (the `rerun` hook + `dm:` cases — add `save`),
  `src/allocutio/telegram/TelegramAllocutio.ts` (`_rerun` reads `actum.modusId`+`actum.aditus`;
  `identity.resolve`; how `DeliveryMenu`/the flow router are wired).
- `src/flow/flows/ExecuteFlow.ts` (the card's `a:*` handling — add `a:saveas`; `state.aditus`,
  `state.pinnedModels`).

## Deliverables
1. **Owner-keyed persistence (the foundation — mostly reuse).**
   - Widen `Modus.auctor?: string` → `?: AuctorKey`, the **existing** type at `src/flow/types.ts:103`
     (`{ animaId } | { commitment }`). Import it the way `src/types/actumIndex.ts:27` already does (no
     layering issue — that precedent exists). Do NOT define a fresh union. Canonical modi leave it undefined.
   - **Migrate the one in-scope reader:** `src/api/webhooks/executionWebhook.ts:166`
     (`modusAuctorAnimaId = modus?.auctor`) → `modus?.auctor && 'animaId' in modus.auctor ?
     modus.auctor.animaId : undefined`. (The other `auctor` hits are DIFFERENT fields — `Intella.auctor`
     = model author string; ledger-entry `auctor` = 'nexus:…'. Leave them.)
   - Add `Modus.fonte?: string` — the parent modusId a saved flow was derived from (provenance + the
     ADR-0003 fork chain).
   - Update `MongoModorum` to (de)serialize `auctor` as the union and support `list({ auctor })` by owner.
   - **Owner is free:** `identity.resolve(userId)` already returns the `AuctorKey` (it's what `_rerun`
     uses). No new helper — the save flow uses `await identity.resolve(presserUserId)` as the `auctor`.
2. **The derived-Modus builder** (crystal, pure): `deriveSavedModus(base, opts)` →
   - copy `base` wholesale (genus, `runpodSpec`/`gradus`, `exitus`, `ministerium`, …), then override:
     `id = slug`, `nomen = name`, `auctor = owner`, `canonica = false`, `fonte = base.id`, fresh `versio`.
   - `intellae = base.intellae + pinned LoRAs` (each `{ id, role: 'lora' }` from `opts.pinned`).
   - `aditus = base.aditus` with `Porta.default` set from `opts.aditus` values: **config always; the
     `prompt` Porta only when `promptMode === 'pinned'`** (open → leave it as a fresh required input).
   - `contentHash = hashModus(result)`. (Edit-a-saved-flow later = re-register w/ bumped versio — ADR-0003.)
3. **The consistent Save-as menu** (same menu from both entries) — built on the **force-reply /
   `takeReply` pattern** (like Mod• add-by-trigger, `TelegramAllocutio:483`), NOT the flow router (the
   delivery-info entry has no active flow context):
   - **name** (force-reply) → derive a slug (`FLOW_SLUG_RE`).
   - **review**: list the `intellae` (models, incl. pinned LoRAs) + the porta (config values) + the
     **prompt-mode toggle** (open ↔ pinned).
   - **collision check**: `Modorum.find(slug)` must be null — **global uniqueness** (no two `/doodoo`);
     else reply "name taken, pick another" (no register).
   - **confirm** → `deriveSavedModus` + `Modorum.register`; confirm with the new slug.
4. **Two entry points, one menu:**
   - Flow card: an `a:saveas` button → open the menu seeded from `state.aditus` + `state.modusId` +
     `state.pinnedModels`.
   - Delivery info tab: a **`save`** hook on `DeliveryMenu` (mirror `rerun`) + a `dm:save:<actumId>`
     case + a "Save as…" button; seed from the Actum's `modusId` + `aditus` + **`actum.pinnedModels`**
     (first-class field, actum.ts:135 — NOT `aditus._pinnedModels`).
5. **Optional "save as canon verb"** — after register, offer to bind a canon verb to the new flow via
   the TASK-003 `bindVerb` seam. (Distinct from naming a flow — ADR-0003: rebind points a verb *at* a flow.)
6. **Copy** in `copy.ts` (`command.*`/a `saveAs.*` block): name prompt, review header, prompt-mode
   labels, collision/"name taken", success confirmation.

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean (the `auctor` union + `fonte` typecheck; `list({auctor})` compiles).
- `npm run test:hermetic` green, with NEW tests:
  - **builder** (`tests/unit/crystal/`): `deriveSavedModus` → `canonica:false`, `auctor` set,
    `fonte = base.id`, `intellae` = base + pinned LoRA, `contentHash` = `hashModus(result)`; **pinned
    prompt → `prompt` Porta gets a default; open prompt → no default**; config values become defaults.
  - **menu/collision** (`tests/unit/allocutio/`): a name whose slug already exists (mocked
    `Modorum.find` → hit) → "name taken", NO register; a fresh slug → `register` called with the built
    Modus; the `dm:save` + `a:saveas` entries both open the menu seeded from actum / card state.
  - add any new DB-free test files to the hermetic gate (`package.json`); verify bare (`env -i`).

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Staging (out of the hermetic gate — validate on real infra)
- `MongoModorum` `auctor` union (de)serialization + `list({auctor})` against a real DB.
- Real `identity → owner` resolution; `/run <saved-slug>` runs the registered derived flow end-to-end.

## Out of scope (do NOT do)
- Prompt affixes (`Porta.praefixum`/`suffixum`) — TASK-007; the menu may show a placeholder, not build it.
- Wiring TASK-003's `resolveVerb`/`bindVerb` to the store — a **sibling follow-up** on this same
  `auctor` foundation (note it; don't build it here).
- Marketplace/sharing/visibility/royalties beyond storing `fonte`.
- Editing an existing saved flow (re-register flow) — future.
- `Intella.auctor` (model-author string) and ledger-entry `auctor` ('nexus:…') — DIFFERENT fields,
  not `Modus.auctor`. Do not touch.
- `/flows` listing a user's owned saved flows — a follow-up; the core deliverable is that the registered
  flow is **`/run <slug>`-able** (TASK-002 already resolves any `Modorum` id).
