# Hosting wrap-up sprint plan

**Date:** 2026-05-24
**Predecessors:** Studio billing (`7d1bd743`), Bulletin (`688ade70`), /status (`a9348d59`), Test cleanup (`25858037`), LoRA resolver (`a78e3260`)
**Goal:** Land the four loose ends so the hosting/UX vertical is genuinely complete. Anything bigger (`/arm` wizard, `/api/v1/*`, Discord lift) lives in its own sprint plan.

## What this sprint completes

After landing: every spec'd UX affordance either does its real job or has a tracked reason to be deferred. No more "submenu navigates but action is a no-op."

| surface | today | after |
|---|---|---|
| Bulletin `Mod • → View loadout` | empty | shows real installed models |
| Bulletin `Destroy → Drain` | submenu navigates, no effect | sets `Materia.drainOnly`; reaper terminates when queue drains |
| Bulletin `Share → Copy link` | submenu navigates, no effect | surfaces the `pod_<token>` deep link |
| `/status` `YOUR GENS` section | always empty | populated from per-user index |
| `/status` per-row `Cancel` | wires through but no IDs to act on | actually cancels |
| `/status` `YOUR STUDIOS` net earnings | `−costAccrued` only | true `earnings − cost` per studio |

## Sprint items

Four items, ordered by dependency. ~3–4 days total.

### 1. Materia inventory (~half day)

Three new fields on `Materia`:

```ts
installedModels?: string[]    // intellaIds present on this studio's volume
volumeUsedGb?: number          // current usage (sum of intellae sizeGb on disk)
volumeCapGb?: number           // disk ceiling (per pod type; stamped at provision)
```

Widen `ActumExecutio` with one optional field:

```ts
modelsInstalled?: string[]    // intellaIds the comfyrunner reports as on disk after this run
```

Update sites:
- `MateriaStore.update` Pick widened
- `MongoMateria` serializer (`installedModels` is `string[]`, no bigint issues; `volumeUsedGb` / `volumeCapGb` are numbers)
- `executionWebhook`: when `completed.executio?.modelsInstalled` is present and `completed.materiamId` is set, merge into `Materia.installedModels` (set-union; preserve already-known)
- Seed at warm-park (in `SecurePodClient`/`FakeRunPodClient`): the base image's bundled unet (read from the workflow template's `requiredModels` of the first dispatch — or stamped explicitly at provision when known)

Tests in `MongoMateria.test.ts` for the serializer round-trip + a webhook test for the merge path.

### 2. Wire bulletin backend hooks (~half day)

`TelegramAllocutio` implements the three optional `BulletinDeps` we left typed but undefined:

```ts
drainStudio: (podId) => this._drainStudio(podId),
fetchShareUrl: (podId) => this._fetchShareUrl(podId),
fetchLoadout: (podId) => this._fetchLoadout(podId),
```

Each ~10–20 lines:
- `_drainStudio` — `materiae.findActive()` filter by `externusId === podId` (small N), then `materiae.update(id, { drainOnly: true })`. Emits `studio.draining` for symmetry with the ticker's path.
- `_fetchShareUrl` — look up the Materia by externusId. If `materia.shareToken` absent, mint via `mintShareToken()` + `materiae.update(id, { shareToken })`. Compose into a Telegram deep link `https://t.me/<botUsername>?start=pod_<token>`.
- `_fetchLoadout` — read `Materia.installedModels`, look up each via `intellarum.find()`, format as a one-line summary (`flux-schnell + 3 LoRAs (milady, hyperrealism, +1)`).

The `TelegramAllocutio` constructor already takes `materiae` + needs `intellarum` added. Pass through from `src/index.ts`.

### 3. Per-studio earnings attribution (~half day)

The cleanest change with the least invasive footprint:

- `hostCutHook` + `hospitiumHook` both already receive `materiaId` indirectly (it's on `event.payload.actum.materiamId`). Today they don't propagate it onto the emitted signum.
- Add `materiaId` to the emitted signum's metadata. Three options for where:
  - **(a) `testis`** — already a string, but it's documented for cryptographic receipts. Overloading is fragile.
  - **(b) New `Signum.contextId?: string`** — a generic "what this signum was emitted in the context of" field. Best for future analytics.
  - **(c) `auctor` suffix** — `nexus:hostCut:<materiaId>` — string-overload of an existing field; trivial to extract; no schema change.

Recommend **(b)** — generic, future-proof, one new optional field. Doesn't touch privacy (materiaId isn't identity). Mongo serializer is a no-op (already a string).

`/status` aggregator gains a per-studio earnings sum:

```ts
async function earningsFor(signorum, key, materiaId): Promise<bigint> {
  const history = await signorum.history(key)
  return history
    .filter(s => s.contextId === materiaId &&
               (s.auctor === 'nexus:hostCut' || s.auctor === 'nexus:hospitium'))
    .reduce((sum, s) => sum + s.valor, 0n)
}
```

Display: `net = earningsFor(...) − hospitium.costAccrued`. Bulletin earnings panel reuses the same function later.

### 4. Per-user gen indexing — `ActumIndex` collection (~1.5 days)

The privacy invariant says "modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima" is the only chain to identity. Adding `animaId` to Actum would violate it. So we build an **aggregation index** separately:

New type `ActumIndex`:

```ts
interface ActumIndex {
  animaId: string         // who initiated the gen
  actumId: string         // the actum
  modusId: string         // for the modusLabel in /status
  createdAt: Date
}

interface ActumIndexStore {
  record(entry: Omit<ActumIndex, 'createdAt'>): Promise<void>
  findActiveFor(animaId: string): Promise<ActumIndex[]>   // joins to Actorum for status filter
  remove(actumId: string): Promise<void>
}
```

Write site: `ExecuteFlow` (or `ActumInceptor`) — when the trace carries an `animaId`, record the index entry. Identified runs only (commitment runs skipped — anonymous queue browsing is a Phase D concern).

Read site: `aggregateStatus` — when `auctorKey` has `animaId`, query `actumIndex.findActiveFor(animaId)`, pass the returned actumIds into `buildGens()` (today this took an injected list; the aggregator now provides it itself when the store is wired).

Cleanup: when an actum hits terminal status (completus/fractus), the existing webhook side-effect path calls `actumIndex.remove(actumId)`. Optional TTL cleanup job for stragglers.

Mongo + memory impls + container wiring + tests.

## What's explicitly OUT of scope

- `/arm` wizard — its own sprint, builds on Mod •
- `/api/v1/*` endpoints — sprint plan already specced (`docs/plans/2026-05-24-crystal-api-lift-sprint.md`)
- Discord adapter lift — separate
- "Explore" tab in Mod • — defer until inventory + add basics land in the next Mod sprint
- `Mod • → Add LoRA` interactive search — defer; for now Mod • is read-only inventory display
- Anonymous-runner `/status` (commitment side) — privacy chain doesn't support an aggregation index here

## Item order + estimates

1. **Inventory** (~half day) — `Materia` fields + serializer + webhook merge + seed at warm-park + tests
2. **Bulletin hooks** (~half day) — three `_drainStudio` / `_fetchShareUrl` / `_fetchLoadout` methods on TelegramAllocutio + pass-through wiring
3. **Earnings attribution** (~half day) — `Signum.contextId` + both hooks set it + `/status` aggregator sums it + tests
4. **ActumIndex** (~1.5 days) — type + store + Mongo + memory + ExecuteFlow write site + webhook remove site + `/status` integration + tests

Total: ~3 days clean.

## After this sprint

The hosting/UX vertical is **complete for v1**. The remaining queued work is genuinely new surface:
- `/arm` wizard (pod-first host onboarding)
- `/api/v1/*` (programmatic + future web/Discord)
- "Explore" tab in Mod • (model discovery)
- Anonymous-runner /status

Each is its own sprint with its own plan doc. The wrap-up sprint closes the chapter on what we've been building since the studio-billing tick.
