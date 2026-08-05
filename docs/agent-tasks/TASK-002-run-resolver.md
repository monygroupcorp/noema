# TASK-002: `/run <flow> [prompt]` — the universal flow runner

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic; CommandRouter logic is unit-tested with mocked deps)

`/run` is currently a bare alias of `/make` (both → `DEFAULT_MAKE_MODUS`). Repurpose it as the
**universal runner**: `/run <flow-slug> [prompt]` runs ANY flow by name; canon verbs (`/make`) keep
running their bound default. Flow ids are now clean slugs (`flux-schnell`, `sd1-5`). See
ADR-0001 and `docs/plans/2026-06-05-command-flow-strategy.md` (local) for the model.

## Read first
- `AGENTS.md`, `docs/adr/0001-crystal-naming-no-new-nouns.md`.
- `src/allocutio/telegram/commands/CommandRouter.ts` — the `dispatch` switch, `CommandDeps`, the
  current `/run`+`/make` case (they share `DEFAULT_MAKE_MODUS = 'flux-schnell'`).
- `tests/unit/allocutio/commands/CommandRouter.test.ts` — the test style (mocked deps, assert
  `calls.enter`).
- `src/crystal/seeds/essentiae.ts` — the flow ids the slugs resolve to (`flux-schnell`, `sd1-5`).
- `src/allocutio/telegram/TelegramAllocutio.ts` — where `CommandRouter` is constructed + `modorum` is
  available (used by `/status`).

## Deliverables
1. **Split `/run` from `/make` in `CommandRouter`.** Keep `/make` exactly as-is (canon make →
   `DEFAULT_MAKE_MODUS`, prompt parsed). New `/run` handler:
   - Parse: strip `^/run(@bot)?\s*`; `rest.split(/\s+/)` → first token = slug, remainder = prompt.
   - Validate slug against `FLOW_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/` (regex-friendly; no dots/spaces).
   - Valid slug → `enterExecute(userId, { modusId: slug, aditus: prompt ? { prompt } : {}, browsePageIndex: 0 })`
     (no `ack()` — same as `/make`, the Stream reaction owns it).
   - Bare `/run` (no slug) or invalid slug → a usage message via `sendMessage` (and `ack()`), listing
     available flow slugs if the new `flows` dep is present.
2. **Add an optional dep** `flows?(): Promise<string[]>` to `CommandDeps`. When present, validate the
   slug is a known flow; on unknown → `sendMessage` "Unknown flow '<slug>'. Try: <comma-list>". When
   absent, skip validation (downstream handles an unknown modus).
3. **Wire `flows` in `TelegramAllocutio`** from the modus registry: `() => modorum.list()` →
   filter to runnable canonical flows (`genus 'atomicus'` / `canonica`) → `.map(m => m.id)`. (If
   `modorum` is absent, omit the dep.) Match the existing optional-dep wiring style.
4. **Copy** for the usage/unknown messages in `src/allocutio/lexicon/copy.ts` (`command.runUsage`,
   `command.runUnknown(slug, available)`).

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, with NEW `CommandRouter.test.ts` cases:
  - `/run flux-schnell a cat` → `enterExecute({ modusId: 'flux-schnell', aditus: { prompt: 'a cat' } … })`
  - `/run sd1-5` → `enterExecute({ modusId: 'sd1-5', aditus: {} … })`
  - `/make a fox` → still `enterExecute({ modusId: 'flux-schnell', aditus: { prompt: 'a fox' } … })` (unchanged)
  - bare `/run` → `sendMessage` (usage), NO `enterExecute`
  - `/run Bad.Slug` (invalid) → `sendMessage`, NO `enterExecute`
  - with a `flows: async () => ['flux-schnell','sd1-5']` dep: `/run nope` → `sendMessage` (unknown), NO `enterExecute`

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Out of scope (do NOT do)
- Per-user verb rebind, the canon-verb default table, new canon verbs — later in the command-flow sprint.
- Studio auto-provision-on-/run — already handled by the existing dispatch (find-warm-or-cold in
  `RunPodCursor`); don't touch it.
- Real generation — staging (a GPU).
- The `ArmPreset`→`StudioBase` rename / runtime single-source — separate alignment passes.
