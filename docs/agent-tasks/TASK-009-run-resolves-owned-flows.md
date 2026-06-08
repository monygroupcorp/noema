# TASK-009: `/run` resolves a user's own saved flows

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: the `CommandRouter` `/run` logic + per-user `flows()` are unit-tested with
  mocks. The real `list({ auctor })` Mongo query is validated on staging.)

**Staging finding (2026-06-08):** a Save-as flow registers fine, but `/run <saved-slug>` rejects it as
"Unknown flow." Root cause: `TelegramAllocutio.ts:249` wires the `/run` validator as
`flows: () => modorum.list({ genus:'atomicus', canonica:true })` — but saved flows are
**`canonica:false`**, so they're filtered out. The save succeeded (TASK-006); the resolver gates it out.

## Read first
- `src/allocutio/telegram/commands/CommandRouter.ts` — the `flows?()` dep + the `/run` handler's
  `flows()` validation (added in TASK-002).
- `src/allocutio/telegram/TelegramAllocutio.ts:249` — the `flows` wiring (the `canonica:true` filter).
- `src/types/modus.ts` (`Modorum.list({ auctor })`), `src/flow/types.ts` (`AuctorKey`),
  `src/allocutio/telegram/telegramTypes.ts` (`IdentityResolver.resolve → AuctorKey`).
- `tests/unit/allocutio/commands/CommandRouter.test.ts` (the `/run` cases to extend).

## Deliverables
1. **Make `flows()` per-user.** Change the `CommandDeps.flows` signature
   `flows?(): Promise<string[]>` → `flows?(userId: string): Promise<string[]>`, and have the `/run`
   handler call `await this.deps.flows?.(userId)` (it already has `userId`). The unknown-flow message is
   unchanged.
2. **Wire it to canonical + the user's owned flows** (`TelegramAllocutio.ts`):
   ```ts
   flows: async (userId) => {
     const owner = await deps.identity.resolve(userId)
     const [canon, owned] = await Promise.all([
       deps.modorum!.list({ genus: 'atomicus', canonica: true }),
       deps.modorum!.list({ genus: 'atomicus', auctor: owner }),
     ])
     return [...new Set([...canon, ...owned].map(m => m.id))]
   }
   ```
   So `/run <my-slug>` resolves the caller's own saved flows. (Only the caller's own — another user's
   `canonica:false` flow is NOT listed; cross-user visibility is deferred, even though slugs are
   global-unique.)
3. Update the existing `/run`-with-`flows`-dep test for the new `flows(userId)` signature.

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, with NEW/updated `CommandRouter.test.ts` cases:
  - `flows` mock now receives `userId`; `/run owned-slug` where the mock returns it (as an owned flow) →
    `enterExecute({ modusId:'owned-slug', … })` (NOT rejected).
  - `/run nope` where the mock omits it → `sendMessage` (unknown), NO enter (regression guard).
  - bare `/run` → usage (unchanged).

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Staging (out of the hermetic gate)
- Real `list({ auctor })` against Mongo: `/run <saved-slug>` runs a Save-as'd flow end-to-end (closes
  the TASK-006 staging tail).

## Out of scope
- Cross-user / public-flow visibility (a flow's `visibilitas` model) — future.
- Rejecting slugs that collide with canon-verb names — minor, separate.
- The bulletin regression; sd15 loraCapable (TASK-008).
