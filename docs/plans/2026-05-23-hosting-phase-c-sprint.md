# Hosting — Phase C sprint plan

**Date:** 2026-05-23
**Branch:** `chainengine-migration` (or fork)
**Predecessors:** Phase A (commits `c6ad99b5..d3cc8150`), Phase B (`5e30d589..cb99fcf9`), Phase B tail (`ae1ac2c0`)

## The reframe (locked 2026-05-23)

Phase A/B were drafted around per-pod cold-start recovery: each Materia tracked
its actual boot cost, and a `bootShare` surcharge amortized that specific number
across the next 5 guests. War-gaming exposed the wrong shape: it conflates the
host's *bookkeeping* with the guest's *price*, demands platform-managed idle
insurance, and makes the surcharge unpredictable across pods.

Phase C re-grounds the economics on simpler primitives:

- **The guest pays a platform-set warm surcharge.** Not "this pod's amortized
  cold cost" — "the going rate to skip cold start anywhere." Predictable,
  comparable, doesn't leak pod-internal accounting to the guest.
- **The host receives most of that surcharge as an ambassador bonus.** A flat
  fraction, paid on every guest gen, regardless of whether the host's specific
  pod broke even. Hosts are our top-of-funnel — we treat them well; the
  platform mints these as credits the user already paid for in USD, so we
  aren't giving anything up we hadn't already collected.
- **Idle warmth is the host's marketing problem.** They proselytize their pod
  on social ("hey come play"), get bites or kill the pod. The platform doesn't
  insure this; it isn't the platform's risk to take.

### What this changes downstream

| Phase A/B field/concept | Phase C disposition |
|---|---|
| `Materia.bootCostImpetus` | Demoted to telemetry; no longer drives pricing |
| `Materia.bootRecovered` | Dropped from the pricing path; kept as a field for legacy reads, can be removed in a later cleanup |
| `bootShare()` in rates.ts | Removed — replaced by `WARM_SURCHARGE_IMPETUS` constant |
| `impetusFor(tier, materia, base)` | Loses the `materia` argument — surcharge is a constant, not a per-pod read |
| Per-pod recovery condition (surcharge stops once `bootRecovered >= bootCostImpetus`) | Gone — surcharge is always the same flat number for guests |
| `boot_amortization` signum (planned) | Renamed to `hospitium` (in `auctor`); the forma is the existing `reward` (identified) or `arcanum` (commitment) — the host-cut hook pattern, just a second listener |
| Anonymous host accountability | The same widening that lets `hostCutHook` mint an arcanum signum lets `hospitiumHook` do the same — both via the new `modoHostKey: HostKey` payload field |

## Economics (the numbers)

Two platform constants in `src/ledger/rates.ts`:

```ts
/** Flat per-guest-gen surcharge for landing on a warm pod (skip cold start). */
export const WARM_SURCHARGE_IMPETUS = 80n        // ~$0.027 at $0.000337/impetus

/** Fraction of WARM_SURCHARGE_IMPETUS that flows to the host as the ambassador bonus.
 *  Platform retains the rest. Symmetric with the 20% platform skim on hostCut. */
export const HOST_BONUS_RATE = 80n               // percent (basis points / 100)
```

Guest pricing (one rule, no Materia read):

```ts
function impetusFor(tier: PricingTier, baseImpetus: bigint): bigint {
  return tier === 'guest' ? baseImpetus + WARM_SURCHARGE_IMPETUS : baseImpetus
}
```

Per guest gen, two host-bound signa fire on `execution_spend`:

- **hostCut** (existing) — `valor = 20% × baseImpetus`, `auctor: 'nexus:hostCut'`.
  Today reads `event.payload.impetus`; **Phase C narrows this to base** so the
  surcharge isn't double-counted (it's compensated separately via hospitium).
  Forma: `reward` for identified host, `arcanum` for commitment host.
- **hospitium** (new) — `valor = WARM_SURCHARGE_IMPETUS × HOST_BONUS_RATE / 100`
  = 64 by default, `auctor: 'nexus:hospitium'`.
  Forma: `reward` for identified host, `arcanum` for commitment host.

### Worked example (H100, 15-sec gen)

- baseImpetus = 60 (~$0.020)
- Guest pays: **140** (60 + 80) ≈ $0.047
- Host receives: 12 (hostCut, 20% × base) + 64 (hospitium, 80% × surcharge) = **76 per gen** (~$0.026)
- Platform retains: 16 (surcharge skim) + the modus royalty (10% × 60 = 6) and model royalty (5% × 60 = 3) and platform skim, all on **base** going forward.

### Routing rules for host-bound signa

| host kind | hostCut forma | hospitium forma | recipient |
|---|---|---|---|
| identified (`{animaId}`) | `reward` | `reward` | `animaId` field on Signum |
| commitment (`{commitment}`) | `arcanum` | `arcanum` | `animaId` UNSET; `testis` = commitment hash |
| no Hospitium / owner / admin | none | none | — |

The `arcanum` rail already exists end-to-end: `Signorum.balance({commitment})`
and `history({commitment})` are first-class. No new ledger primitive is needed.

## Privacy invariants (revalidated)

| invariant | how Phase C upholds it |
|---|---|
| Materia has no animaId | `impetusFor` stops reading Materia entirely; host identity flows only via the spend payload widening to `modoHostKey` |
| Modo has no identity columns | unchanged |
| Signum ledger append-only | both hooks emit, never mutate |
| actum carries no host identity | unchanged — pricingTier + finalImpetus only |
| arcanum forma signum NEVER carries animaId | both `hostCutHook` and `hospitiumHook` branch on `HostKey` discriminant — animaId branch sets `animaId`, commitment branch sets `testis` and omits `animaId` |
| anonymous hosts first-class | both reward streams now reach commitment-hosts via the existing arcanum rail; no de-anonymizing required |
| cross-platform reach | `Hospitium.hostKey` already accepts either side; the dispatch and webhook layers are platform-agnostic |

## Sprint items

Each numbered item is a self-contained commit. Estimates assume the patterns
from Phase B (real Nexus + MemorySignorum + in-memory stores) work without
fresh infrastructure.

### 1. Constants and pure pricing — `~10 min`

In `src/ledger/rates.ts`:
- Add `WARM_SURCHARGE_IMPETUS = 80n`, `HOST_BONUS_RATE = 80n`.
- Rewrite `impetusFor` signature: `(tier: PricingTier, baseImpetus: bigint) => bigint`. Drop the `materia` param.
- Remove or deprecate `bootShare()` (kept exported but flagged `@deprecated` to ease grep).
- Narrow `modoHostFor` return to `HostKey | undefined` (was `{animaId} | undefined`). The webhook will project to whichever discriminant it needs.

Test update: `tests/unit/ledger/rates.test.ts` truth table is rewritten — drop
Materia from the test fixtures; assert flat surcharge.

### 2. Widen `execution_spend` payload to `modoHostKey: HostKey` — `~20 min`

In `src/types/nexus.ts`:
- Change `execution_spend.payload`: rename `modoHostAnimaId?: string` to `modoHostKey?: HostKey`. (Or keep both transitionally — see migration note below.)

In `src/api/webhooks/executionWebhook.ts`:
- Use `modoHostFor(tier, hospitium)` to get the full `HostKey | undefined`.
- Pass it under the new key on the nexus emit payload.

**Migration note:** rather than two fields, we replace cleanly. The only
external listeners are our own hooks (`hostCutHook`, `spellRoyalty`,
`modelRoyalty`, `platformSkim`) — all updated in this commit. No backward-compat
shim needed.

### 3. Update `hostCutHook` — `~15 min`

`src/ledger/hooks/hostCut.ts`:
- Read `modoHostKey` instead of `modoHostAnimaId`.
- Compute `valor = HOST_CUT_RATE × baseImpetus / 100`. We get `baseImpetus`
  from `event.payload.actum.executio.finalImpetus`? No — we want the base, not
  the final. Add `baseImpetus` to the spend payload explicitly so hooks don't
  reverse-engineer it. (See item 4.)
- Branch on `HostKey` discriminant:
  - `{animaId}` → return `[{animaId, forma:'reward', valor, auctor:'nexus:hostCut'}]`
  - `{commitment}` → return `[{forma:'arcanum', valor, auctor:'nexus:hostCut', testis: commitment}]`

### 4. Carry `baseImpetus` on the spend payload — `~10 min`

In `src/types/nexus.ts`: add `baseImpetus: bigint` to `execution_spend.payload`.

In `executionWebhook.ts`: derive `baseImpetus` as `finalImpetus - WARM_SURCHARGE_IMPETUS` for guest tier, else `finalImpetus`. Or — cleaner — stash `baseImpetus` on `actum.executio` at dispatch in `RunPodCursor` next to `finalImpetus`. The cursor already knows it (`actum.impetus`). One extra field on `ActumExecutio`, non-identity-bearing.

Decision: **stash on `ActumExecutio.baseImpetus: bigint`** — costs nothing, lets the webhook read it directly, doesn't bake surcharge logic into the spend formula.

### 5. New `hospitiumHook` — `~25 min`

`src/ledger/hooks/hospitium.ts` (new file):

```ts
import type { SignumHook } from '../../types/nexus.js'
import { WARM_SURCHARGE_IMPETUS, HOST_BONUS_RATE } from '../rates.js'

export const hospitiumHook: SignumHook<'execution_spend'> = async (event) => {
  const { modoHostKey, actum } = event.payload
  if (!modoHostKey) return []
  if (actum.executio?.pricingTier !== 'guest') return []
  const valor = (WARM_SURCHARGE_IMPETUS * HOST_BONUS_RATE) / 100n
  if (valor === 0n) return []
  if ('animaId' in modoHostKey) {
    return [{ animaId: modoHostKey.animaId, forma: 'reward', valor, auctor: 'nexus:hospitium' }]
  }
  return [{ forma: 'arcanum', valor, auctor: 'nexus:hospitium', testis: modoHostKey.commitment }]
}
```

Wire it in `src/index.ts` next to `hostCutHook`:

```ts
nexus.on('execution_spend', hospitiumHook)
```

### 6. RunPodCursor stamps `baseImpetus` — `~10 min`

`src/crystal/RunPodCursor.ts`:
- Add `baseImpetus: actum.impetus` to the executio patch at dispatch (the field
  already exists on the actum but stashing it lets the webhook read off `executio`
  consistently with `finalImpetus`).
- Same merge-not-replace pattern stays in `onMetrics`.

`src/types/actum.ts`: add `baseImpetus?: bigint` to `ActumExecutio` next to `finalImpetus`.

`src/crystal/MongoActorum.ts`: extend `executioToDoc`/`executioFromDoc` to walk `baseImpetus` like `finalImpetus`.

### 7. Update Phase B tests for the new pricing — `~20 min`

`HostingPhaseB.test.ts` and `HostingPhaseB.cursor.test.ts`:
- Drop the per-pod `bootCostImpetus = 200n` materia field (not the source of truth any more).
- Guest finalImpetus changes from `base + 40` (old bootShare(200/5)) to `base + 80` (flat WARM_SURCHARGE).
- Owner/admin/no-Hospitium cases unchanged (still pay base).
- The "regression guard" test for finalImpetus > reservation still applies.

### 8. New `HostingPhaseC.test.ts` — `~30 min`

Drive the full Nexus + both host-bound hooks + signorum for the four
host-kind × hook combinations plus a couple of sanity guards:

| # | scenario | hostCut signum | hospitium signum |
|---|---|---|---|
| 1 | guest, identified host | `reward` to animaId, valor = 20% × base | `reward` to animaId, valor = 80% × 80 = 64 |
| 2 | guest, commitment host | `arcanum`, testis = commitment, valor = 20% × base, NO animaId | `arcanum`, testis = commitment, valor = 64, NO animaId |
| 3 | owner | none | none |
| 4 | admin | none | none |
| 5 | no Hospitium (legacy pod) | none | none |
| 6 | guest, identified host — assert `Signorum.balance({animaId})` reflects both signa | balance += 20% × base + 64 |
| 7 | guest, commitment host — assert `Signorum.balance({commitment})` reflects both signa | balance += 20% × base + 64 |

Items 6/7 are the existence proofs for anonymous host accountability and live
ledger reach.

### 9. Container/index wiring — `~10 min`

`src/index.ts`:
- Register `hospitiumHook` on the Nexus.
- Confirm `executionWebhook` deps already get `hospitia` (Phase B item 1) — yes.

`src/container.ts`: nothing changes; the hook list isn't held there.

### 10. Memo update + commit hygiene — `~10 min`

Update `project_pod_ownership_economics.md` (the memory file) to flag Phase C
complete, point at this plan, and capture the reframe. Update
`project_arcanum_blind_issuance.md` if it cross-references the boot-recovery
shape.

## Estimate

~2.5 hours total assuming clean runs, plus the test sweep. Item 8 is the
longest single piece (test matrix + balance assertions).

## What's explicitly OUT of scope

- **Idle warmth handling.** Host's marketing problem. They proselytize or kill.
- **Per-GPU-class surcharge calibration.** `WARM_SURCHARGE_IMPETUS` is a single
  number for v1; we tune by observation. Later we can swap to a lookup, but
  not until we have data showing the flat rate is wrong.
- **Bulletin UX surfacing of the hospitium signum stream.** That's Phase D
  (bulletin earnings panel). Phase C just makes the signa land correctly.
- **Removing `Materia.bootCostImpetus` / `bootRecovered` fields.** Kept as
  dead-but-present so any in-flight pods stay readable. Sweep them in a later
  cleanup PR once no live Materiae depend on them.
- **Token holder economics / DAO-owned pods.** Markets-on-top-of-the-market
  vision (see memo); rails preserved by anonymous-host first-class status;
  build deferred.

## Order-of-operations execution checklist

1. [ ] rates.ts — constants + new `impetusFor` signature + `modoHostFor` return widened
2. [ ] nexus.ts — `execution_spend.payload` widened (`modoHostKey`, `baseImpetus`)
3. [ ] actum.ts + MongoActorum serializer — `baseImpetus` on executio
4. [ ] RunPodCursor — stamp `baseImpetus` alongside `finalImpetus` + new impetusFor signature
5. [ ] executionWebhook — pass `modoHostKey` + `baseImpetus` on emit
6. [ ] hostCutHook — discriminant branch + read base, not final
7. [ ] hospitium.ts hook — new file
8. [ ] index.ts — register hospitiumHook
9. [ ] rates.test.ts — rewrite truth table
10. [ ] HostingPhaseB.test.ts + .cursor.test.ts — bump numbers
11. [ ] HostingPhaseC.test.ts — new file, 7 scenarios
12. [ ] Full crystal sweep — pre-existing 15 failures expected, no new
13. [ ] Memo update + commit

Each item is one commit with a focused message. Plan to land the whole sprint
under `feat(hosting/C N): …` for items 1–8, `test(hosting/C N): …` for items
9–11.
