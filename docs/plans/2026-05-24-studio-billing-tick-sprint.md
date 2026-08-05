# Studio billing tick — sprint plan

**Date:** 2026-05-24
**Predecessors:** Phase C economics (`docs/plans/2026-05-23-hosting-phase-c-sprint.md`)
**Successor:** bulletin + /status implementation (now displays truthful numbers)
**Order in queue:** **First** — before bulletin and /status, because those surfaces show net cost/earnings that need real per-studio accounting underneath.

## The gap

Phase A–C wired up **per-execution** pricing — every guest gen fires `execution_spend`, the host receives `hostCut` + `hospitium` signa, and `pricingTier` stamps the actum cleanly. That handles the gen-level accounting.

What we never wired: **the host's continuous per-time cost** for the studio being alive. A studio sits warm, idle, or running a guest's gen — the platform is paying RunPod for that compute time, second by second. Today **the host's balance is not debited for any of it.** The platform absorbs the entire compute cost; the host's only outflow is when *they themselves* run a /make gen, and only for that gen's duration.

That breaks the host/guest distinction the spec assumed:

- **Host pays cost-per-time** of the studio running (idle, bootstrapping, running their own gens, running guest gens — all the same compute meter)
- **Guest pays per-execution** with the WARM_SURCHARGE baked in (which they don't pay during cold-start wait, since the host fronted that)

Until the host's continuous cost actually lands, the bulletin's earnings panel and `/status`'s net-cost numbers can't be truthful, and there's no economic pressure on hosts to size their warm window or kill empty studios.

## Locked design

- **Continuous, not settle-on-termination.** Real-time debit protects against runaway debt past the host's balance.
- **Tick on phase transitions + every 60s.** Phase transitions catch the big moments (provisioned, idle entered, running entered, terminated); the 60s heartbeat catches steady-state idle bleed. Cheap.
- **Account against Hospitium.** New field `costAccrued: bigint` parallels how earnings are aggregated. Bulletin reads cost + earnings off Hospitium for the net display. The host's main Modo (their /make activity) stays separate.
- **Balance hits 0 → drain-then-destroy.** Refuse new guest gens; let in-flight gens finish; auto-destroy when the queue empties. Same shape as the existing `Destroy → Drain` submenu, just automatic.
- **Bootstrap is just the first ticks.** No special event. The 5–7 min of cold-start is 5–7 min × `Materia.impetusPerSecond` accrued continuously like any other phase.

## What this gives us downstream

Once this lands:
- **Bulletin** can show "studio cost so far: X · earnings: Y · net: Y-X" with real numbers
- **`/status`** balance reflects all flows (own gens, hosting cost, hosting earnings)
- **The flat WARM_SURCHARGE** is justified — host actually has cost to recover; the surcharge is the guest's contribution to that
- **`/arm` confirm step** can show "est. cost: $X for the first hour" — derived from `impetusPerSecond × 3600`, the same number that'll be ticked off live

## Sprint items

Estimated 1.5–2 days.

### 1. `Hospitium.costAccrued` — `~30m`

`src/types/hospitium.ts`: add `costAccrued: bigint` (default 0n).
`src/crystal/MongoHospitium.ts`: extend serializer with bigint walk.
`HospitiumStore.update` Pick widened to allow this field.

### 2. The billing tick mechanism — `~2-3h`

Two viable approaches; pick during implementation, both fit the test:

**(A) Reuse `session_spend` event**: emit `session_spend` against a synthetic per-studio Modo created on `/arm`. Pros: existing `sessionSpendHook` infrastructure; minimal new ledger surface. Cons: stretches "Modo = user-session" semantics; one Modo per studio.

**(B) New `studio_spend` event**: discriminated on `{ materiaId, hostKey, impetus }`. Pros: clean semantics; doesn't conflate with user-session Modo. Cons: new event type + new hook.

**Recommend (B)** — the host's hosting isn't really a "session" in the Modo sense; it's the operation of a Materia. Cleaner to give it its own event type. Hook emits the debit signum + increments `Hospitium.costAccrued`.

Either way, the spend-settling primitive is the same as guest gens: a signum is consumed from the host's balance for the tick's impetus, credit flows to the platform.

### 3. The ticker — `~2h`

`src/crystal/StudioBilling.ts` (new): a service that:
- Wakes every 60s
- Walks active Materiae (status ∈ {provisioning, idle, running, bootstrapping} — anything not terminated)
- For each, computes `secondsSinceLastTick × impetusPerSecond` and emits the spend event
- Stores `lastBilledAt: Date` on Hospitium (new field) to handle restart-survival

Modeled on the existing `idleReaper` shape — same kind of periodic walk over materiae.

Phase-transition emissions are wired by listening on the `bus`: when `pod.parked` / studio enters provisioning / etc., immediately emit a final tick for the prior phase. (Cheap; ensures no impetus leaks across phase boundaries during a 60s window.)

### 4. Balance-zero gating — `~1.5h`

When the spend would exceed the host's available balance:
- The tick still settles whatever's available; remainder becomes a recorded shortfall on Hospitium
- The studio is flagged `drainOnly: true` (new Materia field): new guest gens refused at admission; in-flight finish
- When in-flight queue drains, the studio auto-destroys (`pod.parked` event triggers it via existing reaper or a new listener)
- Bulletin renders "balance depleted; draining…" state

### 5. Tests — `~2h`

`tests/unit/crystal/StudioBilling.test.ts`:
- 60s of warming idle → 60 × impetusPerSecond debited; Hospitium.costAccrued matches
- Phase transition fires an immediate tick (no impetus leaks at boundary)
- Balance-zero scenario: drainOnly engages; new guest gens refused; in-flight allowed
- Restart resilience: `lastBilledAt` persists; no double-billing on restart

`tests/unit/crystal/HostingPhaseC.test.ts`: extend the existing test to include studio billing accrual in the net-earnings calculation for the identified-host and commitment-host scenarios.

### 6. Wire in — `~30m`

`src/index.ts`: register `studioBillingHook` on Nexus; start the ticker; subscribe to `pod.parked` for phase-transition ticks.

## What's OUT of scope

- **Pre-funding model** — host must have positive balance to /arm. Pre-funding required-amount calculations are a `/arm` wizard concern, not this sprint.
- **Refunds on early termination** — if host destroys early, no refund of accrued cost (they paid for time they used). Future refinement.
- **Per-GPU-class billing rates** — Materia.impetusPerSecond is already per-pod, computed from `costPerHr` at provision. No new logic needed here.
- **Group-context billing splits** (admins-at-cost) — that's a Phase D-ish refinement of who shares the studio cost. The per-time meter still runs against the host; admin-at-cost is a *pricing* policy at gen execution, not a cost-of-time change.
- **Earnings live-render to bulletin** — bulletin work, comes in the next sprint.

## After this sprint

Bulletin sprint can begin. Bulletin's earnings panel reads:
- Cost so far: `Hospitium.costAccrued`
- Earnings so far: sum of signa from this Materia (queryable via `signorum.history` filtered by auctor + studio context)
- Net: simple subtraction

`/status` sprint can begin. Balance shown is the real signorum balance including all in/outflows. Cancel and Join show truthful queue/availability info.

The host/guest economic distinction is now fully expressed in the chain engine.
