# Loop Manager — charter (2026-07-06)

**What this is.** The operating charter for a self-pacing loop manager (a Claude session running
`/loop`) that marches the consolidated work queue forward by dispatching agents and agent teams,
verifying their output, and surfacing human-gated decisions to the owner (monyrth). The owner
manages the manager; the manager manages the work.

**Mission.** Execute the consolidated close-out
(`docs/handoff/2026-07-06-consolidation-handoff.md`, steps 1–7) to done-or-blocked-on-owner,
then proceed into the forward queue (`docs/handoff/2026-07-06-backend-tickets-land-the-plane.md`,
T1→T5 in the ticketed order). Context map: `docs/handoff/2026-07-06-thread-consolidation.md`.

**Owner addition (2026-07-06): the Concierge workstream.** The chat experience that nudges a
user into making something cool is a core product bet, not parity wiring ("a large part of the
success of the platform… easier said than done"). Investigation (task #17) runs immediately —
read-only, parallel-safe; the prototype dev loop (task #18) kicks off once the frontend is
non-mock and verified working. Deliverable: `docs/handoff/2026-07-06-concierge-investigation.md`.

## Autonomy boundaries (decided by owner, 2026-07-06)

**Allowed without asking:**
- Read/build/test anything; spawn agents and multi-agent workflows; create isolated git worktrees.
- Commit to `chainengine-migration` and **push that branch** to origin.
- Update handoff status blocks, the task ledger, and this charter's log.

**HARD GATES — queue as "NEEDS OWNER", never do autonomously:**
- Merge to `staging` / trigger the staging image build.
- Droplet container swap (`deploy-staging.sh`) or any prod-facing change.
- Anything that spends money (GPU pod runs, funded-account dispatches).
- Anything touching the `noema` prod Mongo DB (work only against `noemaplane`/`noemaplane_test`).
- Destructive/irreversible ops not already decided in the handoff (the credenta clean-swap is
  decided, but it fires at deploy — which is gated anyway).
- External publishing (feeds, HF, social, emails).

## Reporting contract (owner feedback 2026-07-06)
Every iteration report LEADS with a three-row snapshot — **Changed / Needs-you / Next** —
before any prose. The owner should never have to read paragraphs to find their action item.

## Iteration protocol (each wakeup)
1. **Reconcile** — check completed/failed background agents and workflows; check CI on pushed work.
2. **Pick** — next unblocked packet from the task ledger (close-out steps first, then T-queue).
3. **Dispatch** — serial repo mutations go to ONE agent at a time on the main tree; parallel work
   only in isolated worktrees; fan-out review/verification via workflows (the owner has opted in
   to agent teams).
4. **Verify before done** — builds get an independent review pass; nothing is marked complete on
   the builder's word alone. Green gates: `npm run typecheck`, `npm run test:hermetic`, app build,
   and clean-worktree `tsc` before any push (git-tree rule).
5. **Record** — update the task ledger + the relevant handoff status block.
6. **Surface** — refresh the NEEDS OWNER list (below) in plain language.
7. **Sleep** — self-paced wakeup; long fallback when only waiting on background work.

## Standing guardrails (from memory/feedback — binding)
- `noema` Mongo is LIVE PROD; `.env` MONGODB_URI carries prod creds — pin DB targets always.
- Never restart staging containers while a pod run is in flight (gated anyway).
- No `Co-Authored-By` lines in commits. Default to `fix:` over `feat:`.
- `npm run gen:api-docs` after any route/contract change (docs-drift test).
- One dispatcher (this manager). No other session should mutate `chainengine-migration`
  concurrently — parallel mutation only in manager-issued worktrees.

## NEEDS OWNER (live queue — manager updates this)
- **`TELEGRAM_BOT_USERNAME` still missing on staging** — Telegram recovery deep-links can't be
  issued, so the task #8 Telegram verify is blocked until it's added + container restarted.
- **Decision — verify model import on staging?** Import-by-URL is fail-closed-denied ("content
  moderation is not yet configured") by the ORIGIN-ONLY CSAM design. To exercise the import
  path pre-provider, set `MODERATION_ALLOW_UNSCANNED=1` on staging (dev opt-in, loudly logged)
  — or accept fail-closed until the CSAM provider lands (Track B).
- **Optional — funded FLUX run** (the last unverified wiring-audit item): fund QA account
  `e6ae8578-…3f73` (quote: 1800 impetus) and say go; the script printed the exact commands.
- **Task #8 MetaMask verify** — ready whenever you are (needs your real wallet); Telegram half
  blocked on the env var above.

## Log (manager appends one line per iteration)
- 2026-07-06: charter authored; ledger seeded; loop started.
- 2026-07-06 iter 1: worker committed strays (`3cab44d1` fix, `d52e089f` docs; docs/plans is
  gitignored — plan files force-added, now tracked); clean-worktree gates green (tsc 0, 877/877
  hermetic, app build ok); manager pushed branch (3731b088..d52e089f). Tasks #1–3 done; #4 queued
  for owner. All downstream work is behind gates #4/#5 — loop idling on a long heartbeat.
- 2026-07-06 iter 2: owner ran `deploy-staging.sh` BUT it swapped the OLD image ("Image is up to
  date"; boot log shows email-auth NoopMailer warning; no credenta clean-swap line) — gate #4
  (merge→staging→image build) is still the missing link. Manager's merge attempt was
  permission-denied pending the owner's explicit word; merge worktree prepped at /tmp/stg-merge.
- 2026-07-06 iter 3: rescued `verify-authed.sh` from a dead session's /tmp scratchpad →
  `scripts/verify-authed.sh` (`3b738114`, pushed). Task #6 no longer depends on volatile state.
- 2026-07-06 iter 4 (owner approved): answered the docs question — only `docs/plans/`,
  `docs/_archived/`, `docs/competitive/` are gitignored (handoffs tracked by design), BUT
  `.dockerignore`'s `*.md` only matched root level → nested docs SHIPPED in the image. Fixed:
  `**/*.md` + `docs` in .dockerignore (verified nothing at build/runtime reads docs/ or .md);
  moved the 2 force-added plan files → `docs/handoff/` (convention restored), refs updated
  (`2f7c1926`). Merged → staging (`37d8895c`), image build 28788543068 watching in background.
- 2026-07-06 iter 5: build 28788543068 FAILED — the `**/*.md` exclusion caught the app's OWN
  source content (`App.tsx` imports `./content/*.md?raw`; the `?raw` suffix had dodged the
  pre-check grep). Fixed with a negation (`!src/platforms/web/app/src/content/*.md`,
  `21ea711a`), re-merged → staging (`8c160668`), watching build 28788699092.
- 2026-07-06 iter 6: build 28788699092 SUCCEEDED — #4 closed; owner pinged for the swap (#5).
  Armed a staging deploy-detector monitor (probes wallet-challenge for non-404 every 60s).
- 2026-07-06 iter 7: prep while waiting — presence-checked staging container env:
  `JWT_SECRET` ✓, `TELEGRAM_BOT_USERNAME` ✗ (needed for tg recovery deep-links; queued for
  owner). Moderation/OFAC unset = expected fail-closed. (Classifier flagged droplet reads as
  owner-gated — added to hard gates.)
- 2026-07-06 iter 8: OWNER DEPLOYED — new image live (deploy detector fired wallet-challenge=200;
  boot log: credenta clean-swap purged 2 legacy rows; no mailer warning). #5 closed. Ran
  `scripts/verify-authed.sh` (#6): me/status ✓, teams CRUD ✓, sponsorships lifecycle ✓; import =
  expected fail-closed deny (moderation unconfigured); FLUX held at money gate. #6 closed;
  results recorded in the wiring-audit status block. Dispatched browser-verifier agent for #7
  (keyring multi-account + projects·holdings in real Chrome vs staging).
- 2026-07-06 iter 9: #7 verified 9/11 PASS — keyring FULLY verified (register×2, switch, clean
  console, per-account namespacing, sign-out-active); projects create/counts/default/scope PASS;
  gaps: rename+delete not exposed in UI (backend CRUD exists) + AccountSettings still renders
  fabricated billing/api data (P0-7 leftover). #7 closed; new tasks #15/#16 dispatched to a
  worker. QA artifacts left on staging: qa_keyring_{a,b}_x7qm + project 88fa32d5 (throwaway).
  Browser-automation note: physical clicks flaky on this app, JS-dispatched clicks reliable.
- 2026-07-06 iter 10: worker landed #15 (project rename inline + two-step delete w/ active/
  default/last-project guards, `c2cc05ce`) and #16 (honest AccountSettings + Dashboard royalties
  tile, `2aee5389`); app+root typecheck and build green; manager verified + pushed. NOTE: these
  are on the branch but NOT on staging until the next merge+build+swap cycle — batch them with
  whatever #8 fixes surface, ONE more staging round before #9 close-out.
- 2026-07-06 iter 12: owner's 2nd redeploy landed (image w/ UI fixes + `TELEGRAM_BOT_USERNAME` +
  `MODERATION_ALLOW_UNSCANNED=1`). Probes: telegram deepLink ✓ (t.me/stationthisdeluxebot),
  new bundle ✓, HF import ✓ END-TO-END (public yumemonoflux → intellaId, license auto-class;
  private repos correctly gated). Wiring-audit authed close-out now fully green except the
  funded FLUX run. #8 click-throughs fully unblocked.
- 2026-07-06 iter 11: Concierge investigation delivered + committed (`284bb75a`) — headline: the
  codebase has been pre-shaping toward it (ApiCursor's documented streaming decision, mcp/tools
  as a ready tool harness, dormant Colloquium/Dictum nouns). Recommendation: option (b)
  server-side concierge endpoint, effort M, 5 backend tickets all buildable pre-de-mock.
  7 product questions queued for the owner (metering, anon, provider, turn-vs-run, IA). #17
  closed; #18 (prototype) blocked on owner option-choice + #9.
