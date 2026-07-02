# Spec — Model import by URL (crystal)

- **Status:** IMPLEMENTED (2026-07-02) — hermetic-green, never GPU/live-verified. Build plan
  #1 (resolver), #2 (private ORIGIN-ONLY import endpoint + mandatory CSAM scan), and #3 (public
  promotion gate) all landed. **Custody decision (revised):** a private import is origin-only — we
  do NOT copy third-party BYO weights to R2 for personal use; the R2 mirror is carried by the
  existing publish spine (`BucketAdapter._hostModel`) only on public promotion. Code:
  `src/crystal/modelImportResolver.ts`, `src/crystal/ModelImporter.ts`, `CrystalApi.importModel` +
  `POST /v1/models/import`, `_settlePublication` model-promotion gate. Tests:
  `tests/unit/crystal/modelImport.test.ts` (+ the promotion-gate case in `publish.test.ts`). The
  legacy-JS teardown is now UNGATED. **Open:** BYO secrets for gated-origin downloads (see §"BYO
  secrets") — proposed, not built.
- **Why:** the JS-nuke parity check found `modelImportApi.js`/`loraImportApi.js` (Civitai/HF
  import-by-URL) is **genuinely absent in crystal** (ADR-0011 §"Parity check"). Owner decision:
  **keep it** — import is a first-class curation feature. Artists should be able to bring any
  model they find; imports are theirs to use immediately, and a separate internal review gates
  the public catalogue. This spec re-expresses it crystal-first and **gates the legacy-JS teardown**.
- **Supersedes on delete:** `main:src/api/internal/models/modelImportApi.js`,
  `main:src/api/internal/loras/loraImportApi.js`.

## The two-tier model

1. **Import → private, immediately usable.** Importing a Civitai/HF (or direct-file) URL creates
   an `Intella` owned by the importer that resolves **only for them**, usable in their flows at
   once. No gatekeeping on personal use. **A private import is ORIGIN-ONLY** — `sources[0]` points
   at the origin, NOT a copy in our R2. We deliberately do not custody third-party BYO weights for
   personal use (the `BYO = user` liability boundary; `project_compliance_posture`), and it saves
   storing every random import. The pod downloads the weights straight from the origin — auth-free
   origins work immediately; gated origins need the owner's BYO credential (see §"BYO secrets").
2. **Public/active catalogue → gated by review.** Appearing on the shared catalogue is a
   *separate, user-invoked* promotion that must pass moderation before it lists publicly. This is
   where "the public top-page isn't NSFW" is enforced — it governs **listing, not personal use**.

## Two gates, kept distinct

- **Mandatory safety scan (legal, always).** Any user-supplied preview media (`Intella.samples`,
  `datasetItems`) crossing the trust boundary is CSAM/NCMEC-scanned at import, fail-closed. Applies
  even to private imports (`project_compliance_posture`). Reuse `ModerationGate.scan`.
- **Curation review (editorial, public only).** Promotion to the public catalogue passes the same
  `ModerationGate` for NSFW/quality curation. NSFW may be fine for private use but not the front page.

## Tier 1 — private import (reuse verbatim; mirrors `trainingFinalizer.ts`)

Grounded in `src/types/intelligendi.ts` + `src/crystal/trainingFinalizer.ts` (which is already a
private-model-add). Build an `Intella` and write it via the `IntellaWriter { upsert }` seam
(`MongoIntella.upsert`):

```
genus: 'lora' | 'model',
sources: [
  { provenance: 'civitai'|'huggingface'|'custom', uri: <origin>, meta }, // [0] origin (pod fetches here)
  // NB: a public promotion later PREPENDS { provenance:'miladystation', uri:<R2 mirror> } via
  // BucketAdapter._hostModel + _reconcile — so catalogue-public models serve auth-free at pod speed.
],
dest: 'loras/<slug>.safetensors',   // relative to /root/ComfyUI/models/
canonica: false,                    // NOT on the public catalogue
access: 'private',                  // owner-scoped
ownerAnimaId: <importer animaId>,   // MongoIntella.buildAccessOrClauses resolves ONLY for owner
familia, trigger, slug,             // compat key + usability (/make picks it up instantly)
nomen, description?, samples?, provenance?: { repo, base }, tags?,
natum: now(),
```

- **Owner-scoping is free:** `MongoIntella.buildAccessOrClauses(animaId)` already makes
  `access:'private' + ownerAnimaId` resolve only for the owner in `findByTrigger`/`triggerMap`;
  `canonica:false` keeps it off `Intellarum.canonical()`.
- **Install is free:** `ModelInstaller.install` builds `ModelRef` from `sources[0].uri` + `dest`
  and downloads onto the pod auth-free — an imported+mirrored intella installs with zero extra work.
- **Flow reference is free:** `Modus.intellae: [{id, role}]` FKs the intella; family derives from
  `familia`.

## Tier 2 — public catalogue (reuse the publishing/Editio spine)

Promotion is a separate `Editio` (artifact kind `'intella'`) via `CrystalApi.publish`, exactly the
"training never auto-publishes" boundary:
- `PublicationWorker` claims `status:'pending'` editiones off-request-path; `_settlePublication`
  runs `ModerationGate.scan` for public visibilities (`feed`/`marketplace`) → `published | rejected`,
  fail-closed via `denyModerationGate`.
- On approval, `_reconcile` flips catalogue visibility: `Intellarum.setAccess(id, 'public')` (and/or
  `canonica:true` for true platform-canonical), and `addSource` if re-custodied. Retract →
  `setAccess('private')` + `removeSource`.

## Net-new (glue only — nothing structural)

1. **Import endpoint** on `CrystalApi` (parallels the `publish` handler): `POST` a Civitai/HF/direct
   URL + owner `AuctorKey`.
2. **Metadata resolver** — parse URL → `{ genus, familia, trigger, slug, nomen, dest, origin
   source+meta }`. Civitai page/`?modelVersionId`, HF repo, direct `.safetensors`/`.ckpt`. Civitai
   `type` (`lora`/`lycoris` → `genus:'lora'`) drives genus. `IntellaSource.meta` +
   `IntellaProvenance` enum already exist for this ("the scraper populates this list when ingesting
   from CivitAI / HuggingFace").
3. **Weight-mirror-to-R2 (on PUBLIC PROMOTION only, not at import)** — a private import is
   origin-only. The R2 mirror is carried by the EXISTING publish spine: a `publish` to `r2` (or
   `custody:'both'`) routes through `BucketAdapter._hostModel`, which fetches the origin weight
   SERVER-SIDE and hosts it under `models/<editioId>/…`; `_reconcile` then prepends the durable
   `miladystation` URL as `sources[0]`. Server-side fetch means a gated origin's BYO token stays on
   our trusted backend (never a pod). No new mirror code — the importer does NOT touch R2.
4. **`Intellarum.create`-from-URL** — optional; `upsert` already covers the write. Add a named
   `create` only for symmetry.

Everything else — owner-scoped resolution, auth-free install, the async public-review gate, the
public/private flip — is carried by existing primitives.

## Post-review hardening (2026-07-02, cross-surface accuracy pass)

Landed after tracing the imported `Intella` through the real system (install / trigger resolution /
catalog / v1↔v2 projection), not just the plan's stated scope:

- **Family mapping must equal real compat keys.** `mapToFamilia` now returns ONLY families that have
  a base flow (`flux/flux2/sdxl/sd15/chroma/krea2/zimage`) and rejects the rest at import with a
  clear message. Fixes a latent bug: `'Flux.1 Kontext'` contains `'flux'`, so it used to mismap to
  `'flux'` (an incompatible stack); Kontext/SD3 have no base flow, so an admitted LoRA would silently
  never resolve. Order is load-bearing (`kontext`→null and `flux2` both precede `flux`).
- **HF single-file only.** Only a ROOT-level `.safetensors/.ckpt` is installable (one URL → one
  `dest`). A multi-file `diffusers` repo (weights in `unet/…`) is now rejected with the reason,
  instead of grabbing a random component like `text_encoder/model.safetensors`.
- **Preview media re-hosted (weights still origin-only).** The small preview image is SCANNED on the
  origin url (fail-closed, never writes unscanned bytes to our bucket) then re-hosted to
  `model-previews/<id>/…` — so the scanned bytes == the displayed bytes (no swap-after-scan TOCTOU)
  and our UI doesn't hot-link a third-party host. Best-effort per image; weights are never re-hosted.
- **Idempotent import.** The `Intella` id is `import-<sha256(ownerAnimaId|origin.uri)>` — re-importing
  the same URL upserts the same record (no duplicate private models); a different owner gets a
  distinct one.
- **Owner-scoped listing — the understated surface.** `GET /v1/models` is `intelligendi`-backed and
  `canonica:true` only, so a private import (in the `intellae`/`Intellarum` registry) was resolvable
  by trigger but *invisible* — you could create it and not browse it. Added `GET /v1/me/models` →
  `CrystalApi.listMyModels` → `Intellarum.listByOwner` (newest-first, owner-scoped), `ModelCard` grew
  an `access` field.

## Licensing — the axis `familia` collapses (built)

`familia` is the COMPATIBILITY axis (which base flow a LoRA stacks on). **License is a separate axis
that `familia` collapses**, and the collapse is legally load-bearing: `FLUX.1-schnell` (Apache 2.0,
commercial ✅) and `FLUX.1-dev` (BFL Non-Commercial, ❌) are the SAME `familia:'flux'`. So the family
key must NOT carry the license — both are classified and recorded separately.

- **Ground truth:** the Model license register in `docs/legal/compliance-landscape.md` + per-seed
  license notes. Encoded in `src/crystal/modelLicense.ts`: `classifyBaseModel(base) → { familia,
  license }` (ordered, most-specific-first; variant checks before the bare family; `kontext`/`flux2`
  before `flux`), `licenseCommercial(id) → 'yes'|'no'|'conditional'|'unknown'`, plus origin-license
  readers (`civitaiCommercial` over `allowCommercialUse`, `hfLicenseToId` over `cardData.license`) and
  `combineCommercial` (most-restrictive wins — a derivative can't out-license its base).
- **Fail-closed:** an unrecognised/variant-less base (e.g. bare "FLUX", FLUX.2-klein pending
  verification) is `'unknown'` — NOT assumed permissive.
- **Recorded on the model:** `Intella.license` (id, display/audit) + `Intella.commercialUse` (verdict).
  Set at import AND at training finality (`trainingFinalizer` — a FLUX.1-dev-trained LoRA is a
  Non-Commercial derivative, classified the same way, so the gate can't be bypassed via training).
- **FLUX.2 variants:** klein (4B/9B) = Apache 2.0 (✅), dev = Non-Commercial (❌), bare `flux2` =
  fail-closed unknown — same variant-drives-license shape as FLUX.1.
- **Enforcement split (use ≠ listing):** a PRIVATE import/train is ALWAYS allowed — personal,
  non-commercial use of an NC-licensed model is fine. The license is enforced only at **PUBLIC
  PROMOTION** (commercial surface): `CrystalApi.publish` refuses an `intella` promotion
  (`visibility !== 'private'`) unless `isCatalogEligible(commercialUse)` → `license.restricted` (403).
  **Policy: `'yes'` AND `'conditional'` pass** — conditional licenses (SD3/3.5, Krea 2 <$1M) are fine
  under their revenue/entity thresholds; we track revenue and take out licenses with the rights-holders
  as we approach a cap. `'no'/'unknown'` are refused pending an admin clearance. A model with NO
  recorded verdict (legacy) is not gated.
- **Admin license backfill/clearance (going-public review):** `CrystalApi.setModelLicense` (platform-
  admin only, `PUT /v1/models/:id/license`) sets a model's `license` + `commercialUse` — either an
  explicit operator decision (e.g. mark an SD3 model `'yes'` once we hold the Stability license) or
  `reclassify:true` to re-derive from the model's recorded `provenance.base` (bulk-fix legacy imports
  that predate classification). This is the escape hatch that keeps us protected while letting cleared
  models list. `Intellarum.setLicense` is the store seam; `ModelCard` surfaces `license`+`commercialUse`.
- **UX note (accepted):** many HF LoRAs don't declare `cardData.license`, so they resolve to
  `'unknown'` and can't auto-promote — private use still works, and an admin can clear them. That is
  the intended fail-closed posture (commercial catalog requires an explicit ✅), not a bug.

## BYO secrets — gated-origin downloads (proposed, not built)

A private import is origin-only, so a **gated** origin (many Civitai models; private/gated HF repos)
can't be downloaded without the owner's credential. The owner brings their own secret; the design
keeps that secret on our trusted backend and, ideally, off the rented pod entirely.

- **Storage — a SEPARATE store, NOT a field on `Anima`.** `Anima.publicatio` already holds BYO
  *account names* (`civitaiAccount`, `huggingFaceAccount`) — non-sensitive identifiers, fine to
  inline + show in `getMe`. A **token** is a different security class and must NOT ride on `Anima`:
  `Anima` is read on every publish / `getMe` / ownership check, so a token-field would amplify the
  blast radius into responses/logs/projections; `AnimaStore.update` echoes the whole doc back (no
  write-only asymmetry possible); and a user has several creds each carrying an AES-GCM envelope
  (`{ciphertext, iv, authTag, keyId}`) + a rotation/idle-expiry lifecycle `Anima` lacks. So: a
  sibling `Secretarium` store keyed by `{animaId, provider}`:

  ```
  type SecretProvider = 'civitai' | 'huggingface'
  interface Secretum {                     // plaintext token NEVER lives here
    animaId: string; provider: SecretProvider
    ciphertext: string; iv: string; authTag: string; keyId: string   // AES-256-GCM envelope
    natum: Date; mutatum: Date; lastUsedAt?: Date
  }
  interface Secretarium {                  // deliberately ASYMMETRIC
    put(animaId, provider, plaintext): Promise<void>
    has(animaId, provider): Promise<boolean>        // getMe → 'connected' | 'absent'
    remove(animaId, provider): Promise<void>
    resolve(animaId, provider): Promise<string|null> // INTERNAL ONLY — decrypt for a server-side fetch
  }
  ```

  The safety comes from **who holds the reference**: `resolve()` (the only method returning
  plaintext) is on the interface, but `CrystalApi` + the router NEVER receive a `Secretarium` — only
  the two server-side consumers do (the metadata `JsonFetcher` wrapper + the weight proxy). API
  surface: `PUT/DELETE /v1/me/secrets/:provider` (identified caller; token encrypted at rest at once,
  never echoed); `getMe` grows `secrets: { civitai, huggingface: 'connected'|'absent' }` via `has`.
  Crypto = a ~20-line `sealBox`/`openBox` over `node:crypto` `aes-256-gcm`; master key from env
  (`SECRETA_MASTER_KEY`) or KMS, indexed by `keyId` for rotation. Never read back, never logged.
- **Import-time scrape.** The metadata resolver's `JsonFetcher` attaches the owner's token as a
  request header for gated Civitai/HF metadata — server-side, trivially secure.
- **Pod-runtime download — the sensitive part. Two options, prefer (a):**
  - **(a) Backend-mediated proxy (recommended).** The pod never sees the token. `ModelInstaller`
    points `sources[0]` at an our-backend fetch endpoint (`GET /internal/weights/:intellaId`); the
    pod authenticates with its own ephemeral job credential (the Actum/job token it already carries);
    our backend authorizes (job → owner → owner owns the intella), decrypts the token, fetches from
    the origin, and **streams** the bytes through. The secret stays inside the trust boundary; the
    pod holds nothing durable. This same proxy is the natural **cache-through** seam (tee to R2 on
    first fetch) if we ever want private-use caching without eager custody.
  - **(b) Ephemeral injected header.** Decrypt at dispatch, hand the pod a job-scoped auth header
    wiped after the run. Simpler, but the token touches the (semi-trusted) rented pod — weaker;
    acceptable only for low-sensitivity tokens, and only if (a) is too costly.
- **Not this:** baking the token into `sources[0]` as a `?token=` URL (leaks into pod logs) or into
  the pod image/persistent env.

Scope: none of this is built. Auth-free origins already work end-to-end; BYO secrets unblock the
gated subset. The proxy endpoint + the encrypted `Secreta` store are the two net-new pieces.

## Behaviors to carry from legacy (and what to drop)

- **Keep:** Civitai page + `?modelVersionId` URLs, HF repo URLs, direct-file URLs; metadata scrape
  (name/base→`familia`/triggers/tags/author/preview); base→checkpoint-family mapping (reject
  unsupported bases); the `r2.dev`-host rejection policy; the review-before-public gate (legacy's
  `pending_review` DB row → our `Editio` pending + `ModerationGate`).
- **Drop:** the ComfyDeploy volume download path (`checkpoints/users/{userId}/…`,
  `COMFY_DEPLOY_API_KEY`) — vestigial; crystal installs via `ModelInstaller` from the origin source
  (mirroring only on public promotion). The legacy checkpoint path wrote NO DB record and is
  otherwise infrastructure crystal already replaced.

## Build plan

1. **Resolver** — metadata resolver (Civitai/HF/direct) → origin source + naming/family. Hermetic
   tests over fixture URLs; host-policy (`r2.dev`) + base-family rejection. (No import-time mirror —
   see net-new #3.)
2. **Private import endpoint** — `CrystalApi` import handler → build ORIGIN-ONLY `Intella`
   (`access:'private'`, `ownerAnimaId`, `canonica:false`, `sources:[origin]`) → `upsert`. Mandatory
   CSAM scan of preview media (fail-closed). Acceptance: imported model resolves for owner only,
   installs from the origin (auth-free origins immediately), `/make` uses it.
3. **Public promotion** — wire the `intella`-kind `Editio` path through `_settlePublication` +
   `ModerationGate` → `setAccess('public')`/`canonica`. Acceptance: private import cannot appear on
   `canonical()`/feed until an approved Editio flips it.

## Acceptance

- A Civitai/HF/direct URL import lands a private, ORIGIN-ONLY `Intella` (`sources:[origin]`, no R2
  copy) resolving ONLY for the importer (`buildAccessOrClauses`), installed from the origin by
  `ModelInstaller` (auth-free origins usable in `/make` at once; gated origins await BYO secrets).
- Preview media is CSAM-scanned at import, fail-closed.
- The model does NOT appear on the public catalogue (`Intellarum.canonical()`/feed) until a
  user-invoked `Editio` passes `ModerationGate` and `_reconcile` flips access.

## Caveat (for the implementer)

Load/resolve (flows, `ModelInstaller`, `triggerMap`) runs on **`Intella`/`Intellarum`/`MongoIntella`**
— target that registry. `Intelligens`/`IntelligentiumStore` is the parallel user-facing catalog
record (its own `privacy`/`canonica`); the two "may converge in a future phase" — do not split the
import across both.

## Pointers

- Types: `src/types/intelligendi.ts` (`Intella`, `IntellaSource`, `Intellarum`, `IntellaWriter`).
- Precedent: `src/crystal/trainingFinalizer.ts` (private-model-add), `src/crystal/seeds/intellae.ts`
  (`INTELLA_LORA_ARMORED_DRESS`, the R2-mirror `sources` convention).
- Install: `src/crystal/ModelInstaller.ts`, `InstallCoordinator.ts`.
- Publishing spine: `src/crystal/ModerationGate.ts`, `CrystalApi._settlePublication`/`_reconcile`,
  `PublicationWorker`, `src/types/editio.ts`.
- Legacy (read for behavior only): `main:src/api/internal/models/modelImportApi.js`,
  `main:src/api/internal/loras/loraImportApi.js`, `main:src/utils/loraImportService.js`.
- Memory: `project_camel_crystal_migration_adr`, `project_compliance_posture`, `project_publishing_editio`.
