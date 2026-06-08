# TASK-011: Serialize bulletin renders (fix scrambled provisioning play-by-play)

- **Status:** ready
- **Owner:** none
- **Gated by:** — (hermetic: serialization is unit-tested with a deferred mock sink. The visual result
  is confirmed on staging.)

**Staging bug (2026-06-08, root cause PINNED):** during `/arm` provisioning (and `/make`), the bulletin
renders stages **out of order** ("Warm, cooking → generating → initializing", no provisioning lines).
Cause: `BulletinManager.onStage` (and `onComplete`/`onFail`/`onReaped`) fire `void this._render(chatId)`
— **un-awaited, un-serialized**. Each stage issues a concurrent Telegram `edit`; under real API latency
they land out of completion-order, so an earlier stage's edit can win last. Everything else is correct
(emission order, `PodSession` state machine, `BulletinView` decision) — it's purely a delivery race.
Fake mode hid it (`FakeRunPodClient` spaces stages with `sleep`); hermetic tests have no real async sink.

## Read first
- `src/allocutio/lexicon/bulletin/BulletinManager.ts` — the `_render(chatId, opts)` method (the body to
  wrap) and its ~10 call sites: `void this._render` (onStage ~195, onComplete ~208, onFail ~222,
  onReaped ~233, register ~131, slowHunt timer ~191) and `await this._render` (the `handle` button
  paths ~149/265/274/…). `_render` reads `cb.session.snapshot()`, computes a `sig`, sets `cb.lastShown`,
  then `await this.deps.sink.edit|post`.
- Where chats are unregistered (`this.chats.delete` / session `end`) — to clean up the new per-chat tail.
- `tests/unit/allocutio/**` for the test harness style (the `DeliverySink`/sink mock).

## Deliverables
1. **Serialize `_render` per chat.** Rename the current `_render` body to **`_renderNow(chatId, opts)`**
   (unchanged logic). Add a wrapper `_render(chatId, opts = {})` that chains per chat so renders apply
   strictly in order (a slow edit can no longer be overtaken):
   ```ts
   private _renderTail = new Map<number, Promise<void>>()
   private _render(chatId: number, opts: { renew?: boolean } = {}): Promise<void> {
     const run = (this._renderTail.get(chatId) ?? Promise.resolve())
       .then(() => this._renderNow(chatId, opts))
       .catch(() => {})            // a failed render must NOT wedge the chain
     this._renderTail.set(chatId, run)
     return run
   }
   ```
   All existing call sites stay as-is (`void`/`await` both remain correct — `await _render` now resolves
   when this render's edit completes).
2. **Clean up the tail** when a chat unregisters / session ends (`this._renderTail.delete(chatId)`),
   so resolved promises don't accumulate.
3. Keep `_renderNow`'s existing dedupe (`sig === cb.lastShown` → skip) — serialization makes the
   `lastShown` set+edit atomic per render, so rapid same-state updates still no-op and rapid distinct
   updates render in order (distinct provisioning stages are spaced by real awaits, so none are lost;
   high-frequency `downloading:n/m` ticks that back up naturally coalesce forward to the latest — fine).

## Acceptance (hermetic — this is "done")
- `npx tsc --noEmit` clean.
- `npm run test:hermetic` green, with a NEW `BulletinManager` test using a **deferred** mock sink
  (`edit`/`post` return controllable promises that record call order + resolve on demand):
  - register a session, then fire `onStage('provisioning')`, `onStage('pod-locked')`,
    `onStage('bootstrapping')` back-to-back. Assert **at most one** sink edit is in flight at a time
    (the 2nd edit is NOT requested until the 1st resolves) — i.e. serialized.
  - resolving the deferreds in order, the sink receives the stage texts **in stage order** (proves the
    out-of-order scramble can't happen).
  - the existing awaited `handle`/`register` paths still work (a final render lands).

## Verify
```bash
npx tsc --noEmit && npm run test:hermetic
```

## Staging
- Visual confirm: `/arm` Start → the bulletin streams provisioning → found → initializing →
  downloading(n/m) → generating in order; `/make` likewise. (The fix is delivery-ordering; the live
  look is the proof.)

## Out of scope
- Coalesce-to-latest that would SKIP distinct stages (we want the play-by-play — render each in order).
- Any change to emission, `PodSession`, or `BulletinView` (all correct). The `/make` bus path is fixed
  by the same wrapper (it also routes through `BulletinManager.onStage`).
