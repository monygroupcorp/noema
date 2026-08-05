# TASK-010: Wire verb-rebind to a persistent owner-keyed store

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: the store interface + in-memory impl + round-trip test; the CommandRouter
  resolveVerb/bindVerb behavior is already unit-tested from TASK-003. The Mongo impl + real `/bind`→`/make`
  validate on staging.)

TASK-003 built the `resolveVerb`/`bindVerb` seam (CommandRouter deps, called at `/make`·`/chat`·`/bind`)
but left them **unwired** — `/bind make sd1-5` reports unavailable, and rebinds don't persist. This wires
them to a **persistent owner-keyed store** (the ADR-0003 "owner-keyed preference bag", keyed by
`AuctorKey`). After this, `/bind` persists, the next `/make` honors the binding, and **"save as canon
verb" is reachable** (via `/bind <verb> <your-saved-slug>` — the saved flow from TASK-006).

## Read first
- `AGENTS.md`, ADR-0003 (the owner-keyed model; verb-binding = the one new bit of state, a peer of `affines`).
- `src/allocutio/telegram/commands/CommandRouter.ts:61,67` — the `resolveVerb`/`bindVerb` dep signatures.
- `src/allocutio/telegram/TelegramAllocutio.ts` — where CommandRouter deps are constructed (the `flows`
  wiring from TASK-009 is the pattern); `this.identity.resolve(userId) → AuctorKey`.
- `src/crystal/MongoVestigiorum.ts:30–55` — the **AuctorKey-keyed store pattern** (flatten
  `{animaId?, commitment?}`, query by the present discriminant) to mirror.
- `src/flow/types.ts` (`AuctorKey`), `src/index.ts:~222–230` (how Mongo stores are constructed + the
  collections) + where `TelegramAllocutio` deps are assembled.

## Deliverables
1. **The binding store.** A small owner-keyed store — interface (in `src/types/`, alongside the other
   store interfaces) + an **in-memory impl** (hermetic/tests) + a **Mongo impl** (`src/crystal/`,
   keyed by `AuctorKey` à la `MongoVestigiorum`). Minimal surface:
   ```ts
   interface VerbBindings {              // name is yours to bless — the ADR-0003 owner-keyed bag
     resolve(owner: AuctorKey, verb: string): Promise<string | undefined>  // → bound modusId
     bind(owner: AuctorKey, verb: string, modusId: string): Promise<void>
   }
   ```
   Shape it so it can later hold `affines` too (re-homing affines off `Anima` — future, NOT now), but
   only build `verb → modusId` now. **No new domain noun beyond this store** (ADR-0003 already
   sanctioned verb-binding as the one new state).
2. **Wire `resolveVerb`/`bindVerb`** in `TelegramAllocutio` (mirror the TASK-009 `flows` wiring; reuse
   `this.identity.resolve`):
   ```ts
   resolveVerb: async (userId, verb) => store.resolve(await this.identity.resolve(userId), verb),
   bindVerb:    async (userId, verb, modusId) => store.bind(await this.identity.resolve(userId), verb, modusId),
   ```
   Keep them inside an optional guard (omit if the store dep is absent — like other optional deps).
3. **Construct the store in `src/index.ts`** (a `verbBindings` collection) and pass it into the
   `TelegramAllocutio` deps.

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, with NEW tests:
  - **in-memory store round-trip:** `bind(owner, 'make', 'sd1-5')` then `resolve(owner, 'make')` → `'sd1-5'`;
    `resolve` for an unbound verb → `undefined`; a different owner does NOT see the binding (owner isolation).
  - the existing TASK-003 CommandRouter `resolveVerb`/`bindVerb` cases still pass (they use mocks — unaffected).
  - if the store interface goes in `src/types/` and its test is DB-free, add it to the hermetic gate.

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Staging (out of the hermetic gate)
- Mongo persistence + real owner: `/bind make sd1-5` → a subsequent `/make` runs sd1-5; `/bind make <saved-slug>`
  (a TASK-006 saved flow) → `/make` runs the saved flow. Closes the TASK-003 wiring tail.

## Out of scope
- Re-homing `Anima.affines` onto this store (future; just leave room in the shape).
- A SaveAsMenu inline "bind to verb" button — **not needed** ("save as canon verb" is reachable via
  `/bind <verb> <slug>` once this wiring lands); the inline button is optional convenience, later.
- Per-user canon-verb default *table* edits beyond rebind; prompt affixes (TASK-007); the bulletin regression.
