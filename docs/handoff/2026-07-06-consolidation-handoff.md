# Handoff — consolidated close-out (auth · keyring · projects · UX)

**For:** a fresh-context agent (or a continuing session) executing the aligned close-out of the
four consolidated threads. **Read first:** `docs/handoff/2026-07-06-thread-consolidation.md` — the
map of what the threads are, how they entangle, and which older docs are superseded. This doc is
the *execution* sequence. Work `chainengine-migration` only.

**Goal:** get the 22 unpushed commits (username+password auth, multi-account keyring,
Projects·Holdings, UX handoffs 1–3) onto staging in ONE coordinated push, run the deferred authed
verification, close the remaining client-transport verifies, then start the T1–T5 backend queue.

## Ground rules
- Crystal TS only; end green (`npm run typecheck`, `npm run test:hermetic`; `test:crystal` needs a
  throwaway `mongo:7`, **never** `.env`'s Atlas — `noema` is LIVE PROD, work only against
  `noemaplane`/`noemaplane_test`).
- `fix:` over `feat:`; no `Co-Authored-By`.
- After any route/contract change: `npm run gen:api-docs` (docs-drift test).
- **Verify from the git tree, not the working tree** (see step 2 — this has bitten before).

---

## Step 1 — repo hygiene (commit the strays)
- `src/platforms/web/app/src/lib/api.ts` — one uncommitted line (`moved?: boolean` on
  `walletLink`); belongs to the auth thread's review hardening. Commit it.
- Commit the two **untracked** handoff docs (`2026-07-03-csam-go-live-handoff.md`,
  `2026-07-03-ux-1-polish-handoff.md`) + the two consolidation docs (this one + the plan).
- Do NOT commit scratch: `_ceremony_demo.ts`, `_coll_demo.ts`, `_feed_demo.ts`, `_run_demo.ts`,
  `src/platforms/web/app/_feed_demo.mts`, `scripts/.koh-manifest.json`.

## Step 2 — green gates from a CLEAN worktree
Local builds read the working-tree disk and mask untracked-file gaps; CI checks out the git tree.
```
git worktree add --detach /tmp/wt HEAD && ln -s $(pwd)/node_modules /tmp/wt/
(cd /tmp/wt && npx tsc --noEmit)          # must be 0
npm run test:hermetic                      # ~870 green expected
(cd src/platforms/web/app && npm run build)
git worktree remove /tmp/wt
```

## Step 3 — push + merge to staging
- Push `chainengine-migration` (origin is ~22 commits behind).
- Merge → `staging` **via an isolated worktree** (`git checkout` silently aborts on untracked-file
  collisions and a following `reset --hard` hits the wrong branch — use
  `git worktree add /tmp/stg staging`, merge there, push).
- Push triggers `staging.yml` → `noema:staging` image. Watch it complete.

## Step 4 — droplet swap (separate from the branch push)
- **Check for in-flight pod runs first** (never restart mid-run — wastes GPU money).
- `./deploy-staging.sh` (container swap).
- **Expected on first boot:** the credenta clean-swap fires ONCE — drops the `email_1` index and
  purges email-era credenta rows. This is the decided design (no email migration), self-disabling
  after. Loud log line expected; not data loss.
- Env to confirm on the box: `JWT_SECRET` (rail 404s without it), `TELEGRAM_BOT_USERNAME`
  (telegram recovery deep-links), `AUTH_APP_BASE_URL` no longer needed for mail (email dropped).

## Step 5 — authed close-out (the deferred verification)
- Run `scratchpad/verify-authed.sh` — registers 2 throwaway accounts, then exercises:
  `/v1/me` (#4 identity), Teams CRUD (#7), Sponsorships create/list/pause/resume (#6), real
  HF-LoRA model import (#5).
- **#1 full FLUX run is the owner's call** — needs a FUNDED account; the script quotes + prints
  the dispatch/stream commands and auto-runs them if the account has balance.
- Record results in `2026-07-03-frontend-wiring-audit.md`'s status block (keep the task-state
  rule: the doc is the single source of truth for what's verified).

## Step 6 — thread-specific authed verifies (browser, vs staging)
- **Keyring (B):** register two real accounts in one browser → switcher shows both → instant
  switch → per-account `noema-<animaId>-*` state isolates (exec mode, active project) →
  sign-out-active drops one, keeps the other.
- **Projects (C):** create/rename/delete a project signed-in; file/unfile a model via
  `HoldingToggle`; `?project=` scoping on Shelf/Collections; Preferences "land in project"
  persists. (Backend already E2E-green vs noemaplane; this is the browser loop.)
- **Auth recovery transports (A) — the two remaining unknowns:**
  1. **MetaMask:** Profile → Account backup → link wallet (real `personal_sign`) → sign out →
     Onboard "Recover with a linked wallet" → session mints. Watch for message-encoding
     mismatches (server uses ethers v6 `verifyMessage`).
  2. **Telegram:** Profile → link Telegram → real `t.me/<bot>?start=link_<code>` deep link →
     bot binds → web `GET /v1/auth/telegram` shows linked → `/recover` in the bot → paste code
     in Onboard → session mints. Watch the 64-char `/start` payload limit.
- Failures here are transport-encoding bugs, not design gaps — fix in place, keep the smoke-test
  invariants (`tests/` authRouter suites) green.

## Step 7 — declare the consolidation closed
Update the status blocks (wiring audit + this doc) and the memory. The four threads collapse to:
**staging-verified platform + a single forward queue.**

---

## The forward queue (after close-out)
1. **T1 GDPR export/delete + T2 card funding** — legal + revenue, independent
   (`docs/handoff/2026-07-06-backend-tickets-land-the-plane.md`). T1's session revocation is also
   the keyring's missing server-side sign-out — design them together.
2. **T3 spend ledger** — small exposure endpoint.
3. **T4 datasets backend → T5 training-runs index** — unblocks the training stack + makes
   `Provincia.datasetIds` real.
4. **Parallel, non-code:** CSAM Track B (NCMEC ESP registration B2, hash-set B3, counsel B4) —
   the actual feed-open critical path (`2026-07-03-csam-go-live-handoff.md`).
5. **Deferred smalls:** wallet/Telegram unlink; cast-time auto-filing into `defaultProjectId`;
   Team shared-member count.

## Status
- **2026-07-06 (created):** docs created; steps 1–7 not yet executed.
- **2026-07-06 (CLOSED — all 7 steps executed, loop-manager run, same day):**
  1–2 ✓ strays committed, clean-worktree gates green (tsc 0, 877/877, app build).
  3 ✓ pushed; merged → staging twice (`37d8895c` broke on a dockerignore/md-import interaction,
  fixed `21ea711a`; final `276ac55d`). Also fixed en route: internal docs no longer ship in the
  docker image (`**/*.md` + `docs` in .dockerignore, app content md re-included).
  4 ✓ owner swapped twice; credenta clean-swap fired once (purged 2 legacy rows), self-disabled.
  5 ✓ `scripts/verify-authed.sh` (rescued from scratchpad, committed): me/status, teams CRUD,
  sponsorships lifecycle, HF import (after staging `MODERATION_ALLOW_UNSCANNED=1`) all green;
  private HF repos correctly gated-origin. FLUX funded run = still owner-optional.
  6 ✓ keyring + projects browser-verified 9/11 (gaps → rename/delete UI + AccountSettings
  honesty, both FIXED same day, `c2cc05ce`/`2aee5389`); MetaMask link+recover ✓ and Telegram
  link+recover ✓ done by the owner against staging (`TELEGRAM_BOT_USERNAME` set).
  7 ✓ this block + memory updated.
  **Follow-up spawned:** recovery-channel hardening (show bound identities, unlink, bind
  notifications) — the tg/wallet link codes are magic-link-class bearer capabilities; the gap
  is silent coexisting binds with no unlink/visibility (ledger task #19).
  **The four threads are now one verified platform. Forward queue = T1–T5 + Concierge
  (investigation done: `2026-07-06-concierge-investigation.md`; prototype = option (b)).**
