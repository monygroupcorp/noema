# Runbook — backfill `familia` on migrated LoRAs (noema-147)

**Status:** script merged; **the `--apply` run against production is the operator step and is the
acceptance of this work.** The merge is not acceptance.

## The defect

`MongoIntella.findByTrigger` (`src/crystal/MongoIntella.ts:148`) and `MongoIntella.triggerMap`
(`:171`) — the two prompt-time resolvers — both query

```js
{ genus: 'lora', familia, /* trigger + access clauses */ }
```

with **exact top-level equality** on `familia`. The v1→v2 LoRA migration
(`src/migrations/loras/legacyToIntella.ts`, driven by `scripts/migrate-loras-chunk.ts`) wrote the
base model into the spec-v2 field `params.baseIntellaId` and **never populated `familia`** — the
transform contains no base→familia mapping at all. A document without `familia` matches neither
query, so its trigger word silently resolves to nothing.

Every LoRA migrated from the legacy stack has therefore been unusable by trigger word since
go-live. This is a **data repair**: `familia` is not being redefined, it is being populated where
the migration left it empty.

A typical affected record carries `params.triggerWords` and `params.baseIntellaId` but no `familia`,
so its trigger word is inert in a prompt of the matching architecture.

Because the mapping was never in the transform, **this class recurs on any future migration run**
until `legacyToIntella` itself sets `familia`. That is out of scope here and needs its own item.

## The affected set

Every migrated LoRA that carries `params.baseIntellaId` and no top-level `familia`. Measure it in
the target database before running (see Procedure step 1); the dry-run reports the exact counts.

| `params.baseIntellaId` | correct `familia` | justification |
|---|---|---|
| `intella.flux-base`        | `flux` | `BASE_TABLE` FLUX.1 rows |
| `intella.sdxl-base`        | `sdxl` | `BASE_TABLE` SDXL rows |
| `intella.illustrious-base` | `sdxl` | `modelLicense.ts:181` — illustrious/noobai collapse to sdxl |
| `intella.pony-base`        | `sdxl` | `modelLicense.ts:180` — pony is XL-derived, stacks on the sdxl flow |
| `intella.sd15-base`        | `sd15` | `BASE_TABLE` SD 1.5 row |
| `intella.kontext-base`     | **none** | `modelLicense.ts:166` — Kontext has NO base flow; `familia: null` is correct |

## The mapping

Lives in `src/crystal/modelLicense.ts` as `FAMILIA_BY_BASE_INTELLA_ID`, **beside `BASE_TABLE`** —
the authoritative familia vocabulary the resolver matches against. It is in `src` (not in the
script) so it is importable and hermetically testable.

`tests/unit/allocutio/familiaBackfill.test.ts` enforces that **every non-null value in the map is a
familia `BASE_TABLE` can actually produce** (via the exported `BASE_FAMILIAE` set). That guard is
what stops the map drifting into a private vocabulary the resolver cannot match — which would
reintroduce the same silent failure in a new shape.

A `baseIntellaId` **not** in the map is **reported and skipped**, never guessed. Adding a row is an
operator decision, and the value must already exist in `BASE_TABLE`.

## The script

`scripts/backfill-intella-familia.ts`

- **Dry-run by default.** Writes only with an explicit `--apply`.
- `--db <name>` is **required** — no default, because `.env` points `MONGODB_URI` at a live cluster.
- Selector — nothing else is eligible:
  ```js
  { genus: 'lora', familia: { $exists: false }, 'params.baseIntellaId': { $exists: true } }
  ```
  A document that already has `familia` is never touched, whatever its value.
- Per-document precondition re-checked immediately before each write (`familia` still absent **and**
  `params.baseIntellaId` still equal to the planned value). Any drift aborts non-zero rather than
  writing.
- `$set` **only** `familia`. Not `trigger`, not `access`, not `canonica`, not `ownerAnimaId`, not
  `sources`, not `dest`. Visibility (`access` / `canonica`) is noema-146's business and needs its
  own review.
- **Idempotent** — a second run finds nothing to do.
- Prints the before/after count of `{ genus:'lora', familia:{$exists:false} }`.

### Report buckets

| bucket | meaning | expected |
|---|---|---|
| **mapped** | will write `familia` | the affected set, less the kontext records |
| **skipped-no-familia-exists** | known base, correctly gets no familia (kontext) | the kontext records |
| **skipped-unknown-base** | not in the map — needs an operator decision | **0** |

A silent zero in `skipped-unknown-base` is the success signal. A non-zero one is printed loudly to
stderr with the offending ids: **stop and decide**, do not re-run with a guessed mapping.

## Procedure

1. **Dry-run.** (`$DB` = the target database name; there is no default.)
   ```sh
   ./scripts/run-with-env.sh npx tsx scripts/backfill-intella-familia.ts --db "$DB"
   ```
2. **Review the report.** Confirm the three bucket counts against the table above, and that
   `skipped-unknown-base` is 0. If it is not, stop — that is an operator decision, not a re-run.
3. **Apply.**
   ```sh
   ./scripts/run-with-env.sh npx tsx scripts/backfill-intella-familia.ts --db "$DB" --apply
   ```
4. **Verify** in the shell:
   ```js
   db.intellae.countDocuments({ genus: 'lora', familia: { $exists: false } })
   // expected: only the kontext records remain — deliberately unset
   ```
   Then spot-check one backfilled record's `familia` against its `params.baseIntellaId`, and confirm
   end-to-end that its trigger word resolves in a prompt of the matching architecture.
5. **Re-run the dry-run once more** to confirm idempotence: `mapped` should be 0.

## Explicitly out of scope

- `findByTrigger` / `triggerMap` / `projectV2ToV1` — the resolver is not wrong, the data is. A
  runtime `baseIntellaId` fallback would duplicate the mapping in a second place and mask the data
  defect from any future audit.
- `access`, `canonica`, catalog visibility — noema-146.
- The 14 records whose `sources.uri` points at the renamed `ms2stationthis` HF org (dead URLs).
- Re-running or modifying `scripts/migrate-loras-chunk.ts`.
