# Loop Manager — charter (2026-07-06)

**What this is.** The operating charter for a self-pacing loop manager (a Claude session running
`/loop`) that marches the consolidated work queue forward by dispatching agents and agent teams,
verifying their output, and surfacing human-gated decisions to the owner (monyrth). The owner
manages the manager; the manager manages the work.

**Mission.** Execute the consolidated close-out
(`docs/handoff/2026-07-06-consolidation-handoff.md`, steps 1–7) to done-or-blocked-on-owner,
then proceed into the forward queue (`docs/handoff/2026-07-06-backend-tickets-land-the-plane.md`,
T1→T5 in the ticketed order). Context map: `docs/plans/2026-07-06-thread-consolidation.md`.

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
- (none yet)

## Log (manager appends one line per iteration)
- 2026-07-06: charter authored; ledger seeded; loop started.
