# ADR-0006: `Conductor` — the studio-lifecycle ring anchor (+ `Census`/`Procurator` renames)

- **Status:** accepted — **implemented + live-verified on staging 2026-06-10**
- **Date:** 2026-06-10
- **Relates to:** ADR-0001 (speak the crystal; "studio" === `Materia`), ADR-0002 (ring/allocutio
  boundary), ADR-0005 (`Fundamentum` — the same "an adapter reinvented a missing crystal layer" pattern).

## Context

Opening a **studio** — a warm, owner-hosted, billed compute session — composes four crystal nouns that
already exist in the ring:

| Concern | Crystal noun | Composed by (today) |
|---|---|---|
| the live pod | `Materia` | `SecurePodClient.provisionStudio` 🔴 |
| the billed session | `Modo` | `TesseraCursor.openModo` ✅ |
| host attribution | `Hospitium` (`hostKey: AuctorKey`) | `SecurePodClient` (via `provisioningContext.hostKey`) ✅ |
| the spend meter | the impetus tick | `StudioBilling` 🔴 |

Two problems, both the crystal getting perverted by adapter concerns (cf. ADR-0005):

1. **Plain-English leaked into the ring.** `StudioBilling`, `SecurePodClient.provisionStudio`,
   `startStudioBilling`, `billOne` — the ring is supposed to speak declined Latin (`Inceptor`,
   `Completor`, `Cursor`, and notably `Praefectus`, the warm-pool *scheduler*). The studio cluster
   broke that grammar.
2. **No single anchor — the composition is re-orchestrated per caller.** There is no one verb that
   says "open a studio for this `AuctorKey`." The Telegram adapter assembles it inside the chatId-coupled
   `BulletinManager` (provision hook + lazy `Modo` + `Hospitium`); the API would have to re-assemble the
   same sequence. Two call-sites composing the same primitives is the exact drift `dispatchInceptio`
   was extracted to prevent for the run path. (Symptom found in passing: the current studio hook calls
   `provisionStudio` **without** a `hostKey`, so bot-provisioned studios can be **host-less** — the gen
   path passes it, the studio path doesn't.)

The crystal already speaks **Roman administrative Latin** for compute (`Praefectus` = the overseer who
picks the pod). The fix is to *complete that cluster*, not invent a one-off.

## Decision

Introduce **`Conductor`** (Latin: *lessee / contractor*; `conducere` = "to lease + bring together") as
the **ring-level studio-lifecycle service** — the single anchor both adapters call:

```
conducere(auctor: AuctorKey, opts: { models; budget; warmMs?; runtime? }) → studio handle (a Modo)
target / find / claudere(studioId)
```

`Conductor.conducere` composes the existing ring pieces: provision the `Materia` + bind a `Hospitium`
keyed by `auctor` (`Procurator`) → `openModo(budget)` (the `Modo` + budget tessera) → bind. **Praefectus
picks the pod; Conductor leases + assembles the studio.**

Rename the plain-English ring members into the same Roman-administrative cluster:

| Plain-English (before) | Crystal (after) | Sense |
|---|---|---|
| `SecurePodClient` / `WarmPodClient` *ring role* | **`Procurator`** | the estate agent that *procures + manages* the `Materia` (provider impls — RunPod etc. — stay provider-named **under** the `Procurator` interface) |
| `StudioBilling` / `startStudioBilling` / `billOne` | **`Census`** | the periodic *assessment/reckoning* of impetus against a session |
| `provisionStudio` (scattered orchestration) | **`Conductor.conducere`** | one verb, both adapters |

**No new noun for the studio itself.** A studio *is* a `Modo` (session) with a bound `Materia` +
`Hospitium`; per crystal-first (ADR-0001, minimize surface) we do not add a `Studio`/`Officina` type.
`Officina` (workshop) is held in reserve only if a name for the composite *handle* later proves necessary.

**The `maxImpetus` watchdog falls out — no new subsystem.** `Conductor.conducere` opens with
`budget = maxImpetus` on `openModo`'s tessera; `Census` already drain-terminates a session on budget
exhaustion. So the API's admission cap (ADR-pending, 4a) and the mid-run cap are the *same* mechanism,
just at two altitudes.

## Consequences

- **Both adapters get thin.** `BulletinManager.startStudio` and the API's `POST /v1/studios` both call
  `Conductor.conducere` — the chatId/render/picker and the `pod.parked` *group-admin late-binding*
  (genuinely Telegram-specific) stay in the allocutio; the lifecycle does not.
- **The host-less-studio bug is fixed by construction** — `Conductor` always threads `hostKey = auctor`.
- **Drift killed** — one composition site, like `dispatchInceptio` for runs.
- **Migration is a rename + extract, not a rewrite** — the primitives (`Modo`, `Materia`, `Hospitium`,
  tessera, `openModo`, the billing tick) already exist and are AuctorKey-keyed; this gives them a named
  home and a single door.

## Scope (graduates to a TASK when picked up)

1. `Conductor` ring service + interface; `Procurator` interface (rename the pod-client ring role);
   `Census` (rename `StudioBilling`). Provider impls renamed only at the seam, not internally.
2. Wire `Conductor` into the ring (`container.ts`) and expose it.
3. Migrate `BulletinManager.startStudio` → `Conductor.conducere`.
4. API: `POST /v1/studios` (+ `GET /v1/studios`) over `Conductor`; `studioId`-targeted runs already land
   (`Inceptio.modoId`). Wire `maxImpetus → budget`.
5. Hermetic where possible (the composition + `Census` logic with mocked `Procurator`); live provisioning
   validated on staging, same boundary as the rest of the GPU rail.

## Implementation (done — 2026-06-10)

Shipped on `chainengine-migration`/`staging`. `Conductor` (`src/crystal/Conductor.ts`:
`conducere`/`find`/`claudere`) composes the ring pieces; `Procurator` interface
(`src/crystal/Procurator.ts`) is the renamed pod-client role (`SecurePodClient` +
`FakeRunPodClient` implement it); `StudioBilling → Census` (`src/crystal/Census.ts`). Wired into
`container.ts` (`ring.conductor`, present iff a Procurator exists). Both adapters migrated: the
Telegram `/arm` Start resolves `hostUserId → AuctorKey → conducere`, and the API uses
`CrystalApi.provisionStudio` (`POST/GET /v1/studios`, REST + MCP). The host-less-studio bug is gone
by construction (Conductor always threads `hostKey = auctor`).

Two things the scope under-stated, both fixed here:
- **The `maxImpetus` watchdog was NOT actually wired.** The budget tessera was issued by `openModo`
  and read by nothing — `Census` drained on host *balance* only. Added `Signorum.sessionBudget(modoId)`
  + a `Census` budget-drain check, and made `MongoMateria.reapIdle` reap `drainOnly` pods on sight so
  the cap is HARD (a drained idle studio dies on the next ~30s sweep, not at `warmUntil`).
- **Studio warm-time billing was silently dead.** `Materia.impetusPerSecond` came from a config field
  that was never set (`?? 0n`), so every pod billed 0/sec. Added `Materia.costPerHr` (the real rate)
  + the canonical `impetusForPodMs` (round once per window); `Census` now bills accurately from cost.

Live-verified on staging: provision a real RTX-4090 studio → `costPerHr` non-zero → targeted run
reuses the warm pod → `maxImpetus` drains + reaps within ~90s (spend capped at one Census tick).
See `feedback`/`project_api_allocutio_live` memory for the live trace.
