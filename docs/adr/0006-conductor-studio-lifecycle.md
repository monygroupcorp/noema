# ADR-0006: `Conductor` — the studio-lifecycle ring anchor (+ `Census`/`Procurator` renames)

- **Status:** accepted (scoped — not yet implemented)
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
