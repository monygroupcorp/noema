# Hosting UX scope — bulletin, /arm, /status

**Date:** 2026-05-23
**Successor to:** Phase C economics (`docs/plans/2026-05-23-hosting-phase-c-sprint.md`)
**Status:** UX specced; implementation plan is a separate doc

## The principle

Four UI surfaces, each owning **one** concern. New features land in the right
place by default; the bulletin stays lean because everything that would tempt
it has a natural home elsewhere.

| surface | owns | audience |
|---|---|---|
| **Bulletin** | one studio's posture + host controls | host only |
| **`/arm` preflight** | configuring a studio *before* it provisions | future host |
| **`/status`** | the user's state across the app | the user, always |
| **DeliveryMenu + Info tab** | one result's actions + provenance | gen author + viewers |

The bulletin doesn't carry user-state. `/status` doesn't carry studio-internal
controls. DeliveryMenu doesn't carry studio controls. Each surface stays focused.

## Bulletin — studio posture HUD

The host's view of their studio. Guests never see a bulletin.

### Layout

- **Body** — studio stage, warm window, current gens, lifetime/session earnings.
  Varies by state (provisioning info vs running gens vs idle countdown), but
  the body is non-interactive.
- **Action row — single shape, always three buttons:**

```
[ Mod • ]   [ Share • ]   [ Destroy ]
```

The action row is **identical in every state** — Provisioning, Bootstrapping,
Running, Warm-idle. State-variance is in the body, not the buttons. The
discipline is at the type level: `affordancesFor(podSession): BulletinAffordances`
returns one fixed-arity object.

### What lives inside each `•`

- **Mod •** — modifications to the studio's loadout
  - Add / swap base model
  - Add LoRA
  - Add / swap workflow
  - View current loadout
  - During provisioning: queues additions to apply on boot
  - During warm-idle: applies live (download + ready)
  - Locked during Running (additions queue but don't trigger; revisit when model-queue layer lands)

- **Share •** — invite/promote
  - Copy share link (the `pod_<token>` deep link — internal token format, kept under that name for the Phase B CommandRouter parser; user-visible URL only)
  - Telegram-share intent (forward to chat)
  - Current guests / queue depth (read-only)
  - Pricing toggles (private+/admin-at-cost/open-to-non-admins, when group-context hosting lands)

- **Destroy** — kill submenu, never an immediate action
  - **Now** (immediate; aborts in-flight gens; confirm if active queue)
  - **Drain queue then destroy** (graceful; refuse new gens; let current finish)
  - **Cancel** (back out)
  - Hidden entirely for guests (they're not the owner)

### What does NOT belong on the bulletin

- **Cancel-gen** — per-gen, not per-studio; lives on `/status` where the user sees
  their own gens with per-row cancel
- **Balance** — user-state; lives on `/status`
- **Other studios you could join** — user-state; lives on `/status` (Joinable section)
- **History / past gens** — user-state; `/status` footer → History

## `/arm` preflight — studio-first host's entry

A wizard for configuring a studio *before* it spawns. Reuses the bulletin's
`Mod •` and `Share •` submenus rendered as a wizard rather than as a HUD.
Same components, different shell.

### Flow

1. User types `/arm`
2. Wizard step 1: **Loadout** — same `Mod •` submenu, but as a required step.
   Pick base model, add LoRAs, choose workflow. Skip = use default.
3. Wizard step 2: **Sharing** — same `Share •` submenu. Set initial pricing,
   open-to-non-admins toggle (in groups), warm window.
4. Wizard step 3: **Confirm** — review estimated cold-start cost + warm cost
   per minute. `[Launch]` or `[Back]`.
5. On launch: studio provisions; bulletin appears in Provisioning state with the
   loadout + sharing already applied.

The `/arm` flow has **zero unique business logic** — it's purely a wizard
shell over the bulletin's existing submenus. Implementation reuses
`Mod • View` and `Share • View` as composable components.

## `/status` — user's app HUD

The user's view of their own state, across all their activity.

### Layout (rough; tighten in implementation)

```
Balance: 1,240 impetus ($0.42)

YOUR GENS (3)
  • gen #abc — queued on @host1's studio — ETA 30s  [Cancel]
  • gen #def — running on your studio        — 12s    [Cancel]
  • gen #ghi — queued on @host2's studio — ETA 4m    [Cancel]

YOUR STUDIOS (1)
  • flux-v1 on H100 — idle, 38s warm — 2 guests today, +148 earned  [Bulletin]

JOINABLE (2)
  • @host3's flux-v1 — 4 in queue   [Join]
  • @host4's sdxl     — open         [Join]

—
[Refresh] [History] [Settings]
```

### What `/status` owns

- **Balance** — current impetus, USD equivalent
- **Your gens** — queued + running, with per-row Cancel
- **Your studios** — link out to the studio's bulletin
- **Joinable** — warm studios you have access to (your group's, share links you've redeemed, public economy pool)
- **Footer** — Refresh / History (past gens) / Settings (notification prefs, default warm window, etc.)

### What `/status` does NOT own

- **Studio controls** (Mod, Destroy) — those live on the bulletin
- **Result actions** (download, copy, rate) — those live on DeliveryMenu
- **Result provenance** — that lives in DeliveryMenu's Info tab

## DeliveryMenu — result actions

Already exists (commits `f6922172` / `739781f7`); separate concern from bulletin.

- Existing surface; Phase C just made sure the gen's spend math is right
- Info tab is the right place for "this gen ran on @host's studio" attribution

This spec doesn't redesign DeliveryMenu; it just establishes it as a separate
surface so the bulletin doesn't grow result-side affordances.

## Architectural seams

```
src/allocutio/lexicon/bulletin/
  BulletinManager.ts          — existing; orchestrates sessions/timers/render
  affordances.ts              — NEW: affordancesFor(podSession) → 3-button row
  views/
    BulletinView.ts           — existing; the body
    mod/                      — NEW: Mod • submenu views (also used by /arm wizard)
    share/                    — NEW: Share • submenu views (also used by /arm wizard)
    destroy/                  — NEW: Destroy submenu (Now/Drain/Cancel)

src/allocutio/lexicon/status/  — NEW
  StatusView.ts                — pure render: balance + gens + studios + joinable
  affordances.ts               — per-row Cancel/Join/Bulletin actions

src/allocutio/telegram/commands/
  ArmCommand.ts                — NEW: wizard shell over Mod • + Share • views
  StatusCommand.ts             — NEW: thin adapter; calls StatusView
  CancelCommand.ts             — NEW? optional shortcut: `/cancel <gen>` for power users
```

### The discipline

- `affordancesFor()` returns a fixed-arity 3-tuple. The type forbids a 4th
  top-level button. Any new feature either replaces an existing button or
  folds into a `•` submenu.
- Submenu views are pure functions of state — bloat there is bounded by
  feature complexity, not by surface count.
- `/arm` wizard reuses bulletin submenu components — no parallel mod/share
  views to maintain.
- `/status` and bulletin share **no** rendering code — they answer different
  questions and serve different audiences. Trying to share kills both.

## Out of scope (named so we don't drift)

- **Idle-warmth insurance** — host's marketing problem; bulletin shows warm
  countdown but doesn't try to subsidize empty time
- **Per-GPU surcharge calibration** — Phase C uses one constant; bulletin/UX
  doesn't change when that becomes a lookup
- **Group-context hosting tiers** (private+/admin-at-cost/open-to-non-admins)
  — fits inside `Share •` submenu when shipped; no top-row change
- **Model-queue / VRAM management** — when `Mod •` adds queue across multiple
  loadouts, the submenu absorbs it; bulletin row unchanged
- **Discord adapter** — same lexicon submenus, different transport; no spec
  changes needed

## Implementation order (separate sprint plan)

This doc establishes the carve. The implementation plan that follows will:

1. Extract `affordancesFor()` from current TelegramAllocutio bulletin code
2. Build `Destroy` submenu (Now / Drain / Cancel) — the most isolated piece
3. Build `Share •` submenu (copy link, share intent) — wraps existing
   shareToken work from Phase B
4. Build `/status` skeleton (balance + gens + cancel) — proves the
   complementary-surface pattern
5. Build `Mod •` submenu (model/workflow additions) — gates on whether the
   model-queue layer is far enough along to wire live additions
6. Build `/arm` wizard — composes Mod • + Share • views in a wizard shell

Steps 1–4 unblock the lean bulletin without depending on the model-queue
layer. Steps 5–6 land when the underlying mechanics are ready.
