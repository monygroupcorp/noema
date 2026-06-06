# TASK-003: Canon-verb default table + per-user rebind (the seam)

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic; the resolution logic is unit-tested with mocked deps. The `Anima.verba`
  field + store wiring is an explicit follow-on, validated on staging.)

Today `/make` runs a single hardcoded const (`DEFAULT_MAKE_MODUS = 'flux-schnell'`). Generalize that
into a **verb → default-flowId table** (`CANON_VERBS`, the platform's taste) and a **per-user rebind**
seam: `resolveVerb(user, verb) = override ?? CANON_VERBS[verb]`. See **ADR-0003** for the model and
why verb-rebind is a layer distinct from saved versions.

This task builds only the **hermetic seam** in `CommandRouter` (table + resolution + a rebind
affordance over injected deps). Persisting bindings (the `Anima.verba` field + `AnimaStore` +
`TelegramAllocutio` wiring) is the follow-on in Out-of-scope.

## Read first
- `AGENTS.md`, `docs/adr/0001-crystal-naming-no-new-nouns.md`, `docs/adr/0003-verbs-bindings-saved-versions.md`.
- `src/allocutio/telegram/commands/CommandRouter.ts` — `DEFAULT_MAKE_MODUS`, the `/make` + `/chat`
  cases, the `CommandDeps` optional-dep pattern (`flows?`, `arm?`), and the `FLOW_SLUG_RE` guard +
  `flows()` validation added in TASK-002 (reuse both).
- `tests/unit/allocutio/commands/CommandRouter.test.ts` — the `make()` harness + assertion style.
- `src/allocutio/lexicon/copy.ts` — the `command.*` block (add bind copy here).

## Deliverables
1. **`CANON_VERBS` table** in `CommandRouter` — `Record<string, string>` (verb → default flowId).
   Seed ONLY the verbs that have flows today: `{ make: 'flux-schnell', chat: 'modus.chatgpt' }`.
   Replace `DEFAULT_MAKE_MODUS` with `CANON_VERBS.make`. (Do NOT add `effect`/`animate`/etc. — those
   are gated on their flows existing; the table just makes them a one-line add later.)
2. **`resolveVerb` resolution** — in the `/make` (and `/chat`) path, resolve the modus via
   `(await this.deps.resolveVerb?.(userId, verb)) ?? CANON_VERBS[verb]`, then the existing
   `enterExecute({ modusId, aditus, browsePageIndex: 0 })`. No behavior change when `resolveVerb` is
   absent or returns undefined. Keep `/make`'s no-ack behavior (Stream reaction owns it).
   - Add optional dep `resolveVerb?(userId: string, verb: string): Promise<string | undefined>` to
     `CommandDeps` (returns the user's override, or undefined to fall through to the table).
3. **Rebind affordance** — a dedicated, unambiguous command `/bind <verb> <flow>`:
   - Parse `^/bind(@bot)?\s*`; `rest.split(/\s+/)` → `[verb, slug]`.
   - Validate: `verb` ∈ `CANON_VERBS` keys; `slug` matches `FLOW_SLUG_RE` and (if `flows` dep present)
     ∈ `flows()`. On any failure → `sendMessage` usage/unknown + `ack()`, NO bind.
   - Valid → `await this.deps.bindVerb?.(userId, verb, slug)` then `sendMessage(bindOk)` + `ack()`.
     When `bindVerb` is absent → `sendMessage(command.unknown)` (same shape as `/arm` without its dep).
   - Add optional dep `bindVerb?(userId: string, verb: string, modusId: string): Promise<void>`.
   - **Do NOT** implement `/make use <flow>` — it is parser-ambiguous (`/make use the force` would
     bind to flow "the"). Document the rejection in a code comment. A dedicated verb is the decision.
4. **Copy** in `copy.ts` (`command.*`): `bindUsage` (`Usage: /bind <verb> <flow>` + the verb list),
   `bindUnknownVerb(verb, verbs)`, `bindUnknownFlow(slug, available)` (reuse the `runUnknown` voice),
   `bindOk(verb, slug)` (e.g. `/${verb} now runs ${slug}.`).

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, with NEW `CommandRouter.test.ts` cases (extend the `make()` harness to
  optionally inject `resolveVerb`/`bindVerb`):
  - `/make a cat`, no `resolveVerb` → `enterExecute({ modusId: 'flux-schnell', aditus: { prompt: 'a cat' } … })` (unchanged).
  - `/make a cat` with `resolveVerb: async () => 'sd1-5'` → `enterExecute({ modusId: 'sd1-5', … })`.
  - `/make a cat` with `resolveVerb: async () => undefined` → falls back to `flux-schnell`.
  - `/bind make sd1-5` with `bindVerb` + `flows` deps → `bindVerb('u1','make','sd1-5')` called + `sendMessage` (ok) + ack; NO enter.
  - `/bind nope sd1-5` (unknown verb) → `sendMessage` (unknown verb), NO bindVerb.
  - `/bind make Bad.Slug` (bad slug) or unknown flow (with `flows`) → `sendMessage`, NO bindVerb.
  - `/bind make sd1-5` with NO `bindVerb` dep → `sendMessage(command.unknown)`, NO throw.

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Out of scope (do NOT do — these are the follow-ons / separate specs)
- **Persistence wiring** (the natural next task): add `verba?: Record<string, string>` to `Anima`
  (a *field*, not a noun — see ADR-0003), extend `AnimaStore.update`, and wire `resolveVerb`/`bindVerb`
  in `TelegramAllocutio` against the anima store (with the `CANON_VERBS` fallback). Non-hermetic →
  staging.
- Adding the remaining elemental verbs (`effect`/`animate`/`direct`/`compose`) — gated on their
  default flows existing (only `make`+`chat` have flows today).
- The `aditus` parameter panel (surface every Porta) — separate spec.
- Saved versions as derived Modi — separate spec.
- `/cook` (Collectio) and `/spell` (compositus Modus) — separate specs.
