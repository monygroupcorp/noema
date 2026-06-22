# Publishing (Editio) — spec

**Status:** build-orders #1 (feed) + #2 (bucket custody) + #3 (model publishing) + #4 (rights/license/splits)
+ #5 (collection/mint) SHIPPED (2026-06-21) — `Editio`/`Editionum` spine + `FeedAdapter` + `BucketAdapter`
(R2 re-host + retract-delete) + `ModelPublishAdapter` (HuggingFace/Civitai, custody prefs, live `Intella.access`
reconciler) + validated `owners[]`/`license` rights record + weighted `modelRoyaltyHook` + `MintAdapter`
(permanent, content-addressed freeze) + `MarketplaceAdapter` (revocable) + async moderation
gate + `unlisted` + `POST /v1/editiones` / `GET /v1/feed`, hermetic-green, never live-verified on GPUs (model
UPLOAD + on-chain mint tx + marketplace API are documented placeholders; execution-time royalty-payee
population is the open seam). #6 (living NFTs) not started. The canonical spec for
**publishing as a first-class arm of the application**: routing any artifact the platform produces
(a gen, a trained model, a collection drop) to any destination (our feed, our buckets, HuggingFace,
user custody, on-chain mint, external marketplaces) under a chosen visibility/custody/rights
arrangement. Build against this once finalized.

> **Naming is provisional.** This spec proposes `Editio` (Latin *editio* — an edition, a putting-forth,
> from *edere*: to give out / publish) as the primitive, and `Editionum` (genitive plural) as the store.
> Open for finalization (§8). Destinations are "**publication adapters**" — the same English term the
> Collectio spec already uses for "export adapters."

## 1. What it is

Today we publish **everything we train to HuggingFace by default** — a single hardcoded destination with
no preference layer, assuming the user has no account of their own. That hardcode is the seed of a much
larger, deliberately-unbuilt capability:

> **Publishing = (a canonical artifact) × (a destination adapter) × (a visibility / custody / rights policy).**

Three axes, one spine. It is **not** a step at the end of training, and **not** a Collectio feature — it is
a cross-cutting arm. The platform already has three publishing limbs sticking out, independently derived:
- **trained model → HuggingFace** (the training output path);
- **collection → native launchpad / on-chain** (Collectio §4e/§5/§6: "export adapters... and our native
  launchpad");
- **gen → feed** (the unbuilt social-proof feed).

They all want the same spine. Unifying them is the point of this spec.

**Why it's its own arm (and good marketing):** a public feed is **owned distribution** — every public gen is
a live demo with a "make your own" button, the single best advertisement we have. It also feeds two
half-built things — the **Vestigium 3D space** (publish → appears in the space) and **living NFTs** (§4g:
"we host the `tokenURI`" is just *custody=ours + visibility=marketplace*, a publishing arrangement, not a
separate subsystem).

## 2. Conceptual model (reframes)

### 2a. "Generate agnostic, project on export" — generalized
The Collectio spec (§4e) already states the discipline for collections: store ONE canonical,
format-agnostic record; **adapters project it** into the format a target wants; the internal record never
knows about any destination. This spec **generalizes that to every artifact**. The canonical records
already exist — an `Actum` (a gen), an `Intella` (a trained model/LoRA), a `Collectio` (a drop). Publishing
adds no new *artifact* modeling; it adds a thin **publication record + adapters + policy**.

### 2b. The current hardcode is one adapter with no preference layer
"Everything → HuggingFace" = the `HuggingFace` adapter, custody=ours, with no account preferences. The fix
is not to special-case alternatives; it is to make the **default configurable** and let every other
arrangement be *the same adapter interface under a different policy*.

### 2c. Visibility and custody are the same family of decision as license and on-chain ownership
"Keep it private in our bucket," "only under my own custody," "mint it," "list it" are points on one
policy surface, not separate features. Custody (*who holds the bytes/metadata*) and license/rights (*who
owns it, who earns from it*) are entangled — this is the compliance line already on record: **catalog
models = our license/liability; BYO = user custody + user liability**. The publishing module is where that
policy is expressed and enforced.

### 2d. An `Editio` is a published *projection*, not a copy of the artifact
The artifact stays canonical and singular; an `Editio` records *that it was put forth, where, and under what
terms* — plus the destination's returned handle (a HF repo id, a token id, a feed post id, an R2 URL). One
artifact may have **many** `Editio`s (private bucket + public feed + minted), each its own record.

## 3. Current state (substrate that exists)

- ✅ **Canonical artifacts** — `Actum` (gen + `exitus` media URLs), `Intella` (model/LoRA: `access:
  public|private`, `ownerAnimaId`, `auctor`, `sources[]` download URLs, `trigger`/`slug`/`familia`),
  `Collectio` (drop + `owners[]` split + `provenanceHash`).
- ✅ **Hosting substrate** — R2 buckets (`R2_OUTPUTS_BUCKET`, `R2_EXPORTS_BUCKET`) + a host-side
  `R2Uploader` (built for the deterministic runtimes); the GPU pods already upload outputs to R2.
- ✅ **Rights substrate** — `Sodalitas` teams + per-artifact `owners[]` split snapshot; royalty hooks on
  the ledger (single-recipient today; split weights pending).
- 🟡 **Collectio export/freeze (§4e/§4f)** — *specced, not built*: agnostic metadata + export adapters
  (ERC-721/1155, OpenSea, Metaplex, native launchpad) + the freeze boundary that snapshots
  ownership/split + provenance + trait DNA.
- 🟡 **Compliance gates** — *specced*: trust-boundary CSAM scanning + NCMEC, OFAC screening, model-license
  liability split (catalog=us / BYO=user).
- 🟠 **Missing entirely:** the `Editio` primitive, the adapter interface, account publishing preferences,
  the feed, and any non-HuggingFace destination for trained models.

## 4. The three spectrums (the policy surface)

### 4a. What gets published (the artifact — already canonical, nothing new)
- ✅ an **`Actum`** (a single gen) → feed, share link, the Vestigium space
- ✅ an **`Intella`** (a trained LoRA / model) → HF, our bucket, the catalog, user custody
- ✅ a **`Collectio`** (a drop) → launchpad, on-chain mint, external marketplace

### 4b. Where it goes (publication adapters — the extensible set)
- 🟠 **FeedAdapter** — our feed (social proof / advertisement). *The smallest bite.*
- 🟠 **BucketAdapter** — R2-hosted, public or private (custody=ours). Powers living-NFT hosted metadata.
- 🟠 **HuggingFaceAdapter** — today's default for models; becomes one adapter among several, and gains a
  user-account (BYO) mode.
- 🟠 **CustodyAdapter** — generalized BYO: the user's own HF / bucket / wallet.
- 🟠 **MintAdapter** — on-chain (Collectio freeze → Catena/CreditVault). Subsumes Collectio §5/§6.
- 🟠 **MarketplaceAdapter** — OpenSea / Metaplex projection (Collectio §4e).

### 4c. Under what arrangement (the policy matrix — "the perfect arrangement")
- **Visibility:** `private` (owner only) · `unlisted` (anyone with the link) · `feed` (public in our feed) ·
  `marketplace` (public + listed externally / on-chain).
- **Custody:** `ours` (we host bytes/metadata) · `theirs` (their account/wallet/bucket) ·
  `both` (we host + mirror to theirs).
- **Fan-out:** one artifact → several destinations at once (each its own `Editio`).
- **Rights:** owner / `owners[]` split (the `Sodalitas` snapshot) + license tag (catalog=our license vs
  BYO=user license/liability) + royalty split, snapshotted at publish/freeze.

## 5. The crystal core (small, despite the scope)

Three small pieces; everything else is adapters added one at a time.

### 5a. `Editio` — the publication record
```
Editio {
  id
  artifactRef: { kind: 'actum' | 'intella' | 'collectio', id }
  destination: string               // adapter key, e.g. 'feed' | 'r2' | 'huggingface' | 'mint'
  visibility:  'private' | 'unlisted' | 'feed' | 'marketplace'
  custody:     'ours' | 'theirs' | 'both'
  by:          { animaId } | { commitment }   // who published
  owners?:     Array<{ animaId, weight }>      // rights split, snapshotted (from Sodalitas)
  license?:    string                          // 'catalog' (our liability) | a BYO license id
  externalRef?: string              // the adapter's handle: HF repo / token id / feed post id / R2 url
  status:      'pending' | 'published' | 'failed' | 'retracted'
  natum; mutatum
}
```
Store: `Editionum` (genitive plural) — `create` / `find` / `listByArtifact` / `listByAuthor` /
`listFeed(filter)` / `update(status, externalRef)`.

### 5b. The publication-adapter interface (mirrors the deterministic-runtime engines + §4e export adapters)
```
PublicationAdapter {
  key: string                                  // 'feed' | 'r2' | 'huggingface' | 'mint' | ...
  publish(artifact, policy): Promise<{ externalRef: string }>
  retract?(editio): Promise<void>              // unpublish where the destination allows it
}
```
Injected + registered by key (exactly like `Cursorum`/the runtime engines), so adapters are added without
touching the spine.

### 5c. Account publishing preferences (kills the hardcode)
```
PublishingPrefs {   // FINALIZED: lives on Anima (per-identity, low-churn, no new store).
  defaultDestination; defaultVisibility; defaultCustody    //   Per-Sodalitas defaults added later, only if a team needs one.
  defaultLicense?                              // #4: catalog/BYO license default for the caller's own work
  huggingFaceAccount?; civitaiAccount?; wallet?; bucket?   // BYO custody targets (#3 added civitaiAccount)
}
```
"Everything → HuggingFace" becomes `defaultDestination='huggingface', custody='ours'` — a default, not a
hardcode. A user with their own account flips `custody='theirs'` + their token.

### 5d. Single source of truth (FINALIZED)
`Editio` **owns** visibility/custody/rights. `Intella.access`/`ownerAnimaId` and the Collectio public
projection are **derived** — a small reconciler keeps them in sync when an `Editio` is published/retracted;
they are never set independently. Two competing visibility flags is the bug we are explicitly avoiding.

### 5e. Intella publishing == the royalty / ChainEngine surface (FINALIZED)
For an **`Intella`** (a model), publishing and royalties are **one surface, one source of truth**. Making a
model public/usable and deciding *who earns when it is used* is a single decision: the `Editio`'s
rights/owner layer (`owners[]` / `auctor`) IS the identity the ledger's `modelRoyalty` hook pays whenever a
gen uses that model (the ChainEngine royalty surface). So:
- publishing a model = (a) making it resolvable (`loraResolver` finds it by trigger) **and** (b) wiring its
  royalty-earning identity — never two separate records to drift apart;
- this is why **rights/license/splits (build-order #4) is tightly coupled to model publishing specifically**,
  and why the `Editio.owners[]`/`license` for an `Intella` must reconcile with its catalog `auctor` and the
  royalty-hook payee. (Catalog models = our license/our cut; BYO/user-trained = the user's `auctor` earns.)

## 6. Net-new work + proposed build order

> **Forward roadmap (living, ticked as we go):** `docs/plans/2026-06-22-publishing-vertical-roadmap.md` —
> the leverage-ranked sequence for what remains (execution-time royalty payees → weight streaming →
> external upload → `custody:'both'`/auto-trigger → moderation gate → deferred mint/marketplace/living-NFT).

✅ have · 🟡 lean add · 🟠 new build

1. ✅ **Spine + feed bite** — SHIPPED 2026-06-21. `Editio` (`src/types/editio.ts`) + `Editionum`
   (`MongoEditionum`) + `PublicationAdapter` + `ModerationGate` interfaces + a `FeedAdapter` + `visibility`/
   `custody` + `PublishingPrefs` on `Anima` (`publicatio`). `CrystalApi.publish/feed/retractEdition`;
   `POST /v1/editiones`, `POST /v1/editiones/:id/retract`, `GET /v1/feed`. **Hard gate honoured:** public
   surfaces (`feed`/`marketplace`) go `pending` → async moderation `scan` → `published` | `rejected`, never a
   synchronous publish — the gate is injected as an interface; the **real CSAM/NCMEC scanner is still unbuilt**,
   so the container wires `permissiveModerationGate` (a structural no-op that preserves the async-gate path).
   §5d reconciler is a documented write-through seam (`_reconcile`) — a no-op until intella publishing (#3).
2. ✅ **Bucket / hosting custody** — SHIPPED 2026-06-21. `BucketAdapter` (`src/crystal/BucketAdapter.ts`,
   keyed `r2`) re-hosts an artifact's media into R2 under a stable per-publication key (`editiones/<editioId>.<ext>`),
   custody `ours`; `retract` DELETES the hosted bytes (new `ObjectStore.del` on `R2Uploader`). Adapters now
   built in the container (`Ring.publicationAdapters`), bucket gated on R2 config like the deterministic
   cursors. `unlisted` visibility flows through the existing sync (un-gated) publish path. **Deferred:** TRUE
   private custody (owner-only bytes via signed URLs / a private bucket) — a `private` bucket publish today
   hosts publicly-readable bytes under an unguessable key (unlisted-grade); signed-URL custody lands with the
   living-NFT work (#6). This is the substrate living NFTs reuse (we serve the `tokenURI`).
3. ✅ **Model publishing + custody preferences** — SHIPPED 2026-06-21. One registry-parameterized
   `ModelPublishAdapter` (`src/crystal/ModelPublishAdapter.ts`) covers **HuggingFace + Civitai** (and
   "others" = a `ModelRegistry` descriptor, not a new class). custody `ours` → our org; custody `theirs`
   → the caller's BYO account from `PublishingPrefs` (`huggingFaceAccount`/`civitaiAccount`), threaded to
   the adapter via `PublishPolicy.custodyTarget`. **Resolves the training-output question:** the HF adapter
   is one of several, chosen by custody preference. The **§5d reconciler is now LIVE** — `CrystalApi._reconcile`
   write-throughs `Intella.access` (`setAccess` on `Intellarum`): a non-private model publish → `public`
   (resolvable by trigger), retract → `private`. Models publish to `private`/`unlisted` only (not the media
   feed). **PLACEHOLDER:** the real weight UPLOAD to an EXTERNAL REGISTRY is deferred — but the **upload
   mechanism is now a pluggable per-platform strategy** (`RegistryUploader`, 2026-06-22): the adapter delegates
   byte movement to an uploader injected on the `ModelRegistry`, so HuggingFace, Civitai, and any future host
   are PEER strategies — none baked into the adapter or spine (the explicit anti-overfit requirement). No
   concrete uploader is wired yet (HF needs LFS; Civitai has no public upload API), so the registries remain
   projection-only until one lands (§10). The royalty payee (§5e) is the model's own `auctor`, unchanged by publish.
   - ✅ **3b — Training finality, our-bucket custody (SHIPPED 2026-06-21).** The **our-custody** half is now
     REAL (not a placeholder): publishing a model to `destination:'r2'` hosts its primary weight file into OUR
     R2 bucket (`BucketAdapter._hostModel` — real byte movement, keyed `models/<editioId>/<file>`) and the
     reconciler **prepends the hosted URL as the highest-priority `miladystation` source** (`Intellarum.addSource`)
     so the pod resolves the model FROM us, not a flaky external host (the `sources[0]` convention). `private`
     keeps it owner-only; `unlisted` makes it broadly resolvable. `retract` deletes the weights AND drops the
     source (`removeSource`). This is the "publish a trained model to finality: somewhere external **and**
     available to us in our buckets, private or otherwise" path — the external leg stays the registry-upload
     placeholder above; the our-bucket leg is done. **Weights STREAM end-to-end** (2026-06-22): `_hostModel`
     uses `MediaFetcher.fetchStream` → `ObjectStore.putStream` (lib-storage multipart) when both are present,
     so a multi-GB checkpoint never buffers whole in memory; it falls back to the buffered path for
     LoRA-sized files / test fakes.
4. ✅ **Rights / license / splits** — SHIPPED 2026-06-21. The `Editio` is now the complete canonical rights
   record: an **explicit weighted `owners[]` split** (validated Σ=1, mutually exclusive with `teamId`'s
   equal-weight team snapshot) + a **`license` tag** defaulting via the compliance catalog/BYO line
   (`opts.license` → `prefs.defaultLicense` → `'catalog'` for a platform-canonical artifact, else unset).
   **Ledger tie:** `modelRoyaltyHook` splits the 5% pool across a single weighted payee field —
   `execution_spend.intellaRoyaltyPayees` (`Array<{animaId,weight}>`) — each payee getting `pool × weight/Σweight`
   in pure bigint (weights scaled to integers, so equal weights reduce to an *exact* `pool/n` floor). Equal
   credit across a model's authors is just equal weights; a published `Editio.owners[]` split is unequal
   weights — **one field, one path** (the prior flat `intellaAuctorAnimaIds` equal-split field was collapsed
   into this). **Integration LANDED (2026-06-22, §9):** the execution webhook now populates
   `intellaRoyaltyPayees` (`resolveModelRoyaltyPayees`) — the models a gen used → their published `Editio`
   rights split → the payload. The rights layer now actually pays.
5. ✅ **Collection / mint** — SHIPPED 2026-06-21. `MintAdapter` + `MarketplaceAdapter`
   (`src/crystal/MintAdapter.ts`). The Collectio **freeze → export → mint** path (§4e/§5/§6) IS this: publishing
   a Collectio to `destination:'mint'`/`'marketplace'` (both default to `visibility:'marketplace'` → the
   moderation gate runs) **freezes** the immutable canon — the generative `provenanceHash` + the snapshotted
   `owners[]` rights split + the drop size are **content-addressed** into one deterministic handle
   (`mint:<chain>:<sha256>`) via the shared `contentHash` (generalized out of `provenanceHash`). The freeze is
   enforced at the spine: a Collectio must be `completa` to mint/list (you cannot freeze an in-flight drop), and
   a Collectio's own `owners[]` are **re-snapshotted** onto the Editio at publish when no explicit split is
   given (the "frozen drop below" rule). **Mint is permanent** — the adapter omits `retract`, so the spine 403s
   it; a **marketplace listing is revocable** (keeps `retract`, keyed by the publication id). Publishing
   **subsumes** Collectio's export adapters — no second artifact type (the Editio only references the Collectio).
   **PLACEHOLDER(publishing#5):** no real on-chain transaction (no Catena/CreditVault mint, no `tokenURI`
   assembly — the hosted/mutable layer is #6) and no real marketplace API call; both adapters do the
   deterministic freeze→handle projection only (§10). `MarketplaceAdapter` is venue-parameterized (base URL),
   so "other marketplaces" are config, not new classes.
6. 🟠 **Living NFTs (§4g)** — the north star, now expressible as a publishing *arrangement*: `custody='nostra'`
   + `visibility='marketplace'` + a **mutable hosted projection** (the owner re-runs a bounded pipeline →
   we overwrite the hosted image) + owner-gated re-execution + fiat subscription. Builds on 1–5.

**Scope discipline:** build the spine + the feed adapter first; let HF/custody/mint/marketplace/living-NFT
accrete as adapters on the identical interface. Do NOT model a second artifact type — `Actum`/`Intella`/
`Collectio` are the artifacts; `Editio` only *references* them.

## 7. Connections (what this unifies)

- **Collectio §4e/§5/§6 (export + freeze + mint)** → becomes the Mint/Marketplace adapters + the freeze =
  "publish a Collectio to `marketplace`."
- **Collectio §4g (living NFTs)** → `custody=nostra` + `visibility=marketplace` + mutable hosted projection.
- **Training output** → "publish an `Intella`" via the HF / custody adapter under prefs.
- **The feed** → the `FeedAdapter`; also the publish event that populates the **Vestigium 3D space**.
- **`Sodalitas` + ledger royalty hooks** → the rights/split layer (#4) snapshots at publish/freeze.
- **Compliance posture** → the moderation gate (#1) + the license/custody policy (catalog vs BYO).

## 8. Decisions (finalized 2026-06-21)

- **Naming** — ✅ `Editio` / `Editionum` (primitive / store); destinations are "publication adapters."
  Value **enums are English** (`private/unlisted/feed/marketplace`, `ours/theirs/both`) — they are
  user-facing policy, not internal primitives; we Latinize primitives, not value enums.
- **Prefs home** — ✅ `PublishingPrefs` lives on **`Anima`** (per-identity, low-churn, no new store).
  Per-`Sodalitas` defaults added later, only when a team actually needs a shared destination.
- **Single source of truth** — ✅ `Editio` **owns** visibility/custody/rights; `Intella.access` and the
  Collectio public projection **derive** via a reconciler (§5d). For an `Intella`, this same source of
  truth IS the royalty/ChainEngine payee surface (§5e) — publish + royalty are one decision.
- **Retract** — ✅ per-adapter capability: feed/bucket support real unpublish (`status:'retracted'` + delete
  hosted bytes); **`MintAdapter` has no `retract()`**. The honest UX promise: *feed/hosted = revocable;
  minted = permanent.* `retract?` is optional on the adapter interface for exactly this reason.
- **On-chain custody** — ✅ **deferred to build-order #5**: non-custodial (token in the user's linked
  wallet, `custody:'theirs'`; we host only mutable metadata, `custody:'ours'`, for living NFTs). Fed by the
  existing wallet-linking (arcanum / magic-amount). Not designed in detail until #5.
- **Moderation** — ✅ reuse the trust-boundary **CSAM/NCMEC scan as the `→public` gate**, run **async on
  publish-request**: an `Editio` to a public surface goes `pending` → scan → `published` | `rejected`.
  **Never** a synchronous publish to a public surface. Non-negotiable for the #1 feed bite.
- **Editio vs Collectio §4e** — ✅ **publishing owns the adapter registry**; a Collectio *requests* a
  publish (`publish(collectio, { marketplace, ... })`) rather than carrying export code. Collectio spec §4e
  to be updated to point here (single adapter registry, no duplication).
- **Feed surface** — ✅ a crystal **`/v1` read API (`GET /v1/feed`) + a frontend lens**, both. **Anonymous
  (`commitment`) publishing allowed**, attributed to the commitment or a chosen handle (anon gens are a
  large share of the advertising value), gated by the same moderation.

## 9. Open (deferred to their build-order step, not undecided)

- Exact `retract` semantics + hosted-byte deletion per adapter — ✅ done for bucket (#2: `ObjectStore.del`);
  mint has no `retract` (#5, permanent).
- TRUE private custody for the bucket (owner-only bytes via signed URLs / private bucket) — deferred to #6;
  `private` bucket publishes are unlisted-grade today (public bytes under an unguessable key).
- Wallet-linking → `custody:'theirs'` wiring + living-NFT mutable-metadata hosting + the real on-chain mint
  tx / marketplace API behind the #5 freeze (the freeze + handle are real; the chain/venue calls land with #6).
- ✅ **Execution-time royalty-payee population** — SHIPPED 2026-06-22 (roadmap Tier 1 #1). The execution
  webhook now populates `execution_spend.intellaRoyaltyPayees` via `resolveModelRoyaltyPayees`
  (`src/ledger/resolveModelPayees.ts`): the models a gen ACTUALLY used (resolved `spec.models` from the
  content-addressed deployment bundle, incl. prompt LoRAs, + host-pinned) → each model's **published
  `Editio`** rights split (`owners[]`, else the publishing `by` identity) → weighted payees the
  `modelRoyaltyHook` splits the 5% pool across. **Publishing is the royalty surface (§5e):** an unpublished
  or platform-canonical model yields no payee; we deliberately do NOT fall back to `Intella.auctor` (may be a
  provider name, not an animaId → would mint bogus signa). Wired on the production webhook path only; the
  inline `ActumCompletor` emit (sync cursors, no GPU LoRAs) is unchanged. Scraped-model attribution via
  `corpusId` remains a separate, later path.
- Reconciler mechanics (event-hook vs write-through) for keeping `Intella.access` in sync with `Editio` —
  decided at #1, **LIVE at #3**: write-through in `CrystalApi._reconcile` (`Intellarum.setAccess`), single
  settle point = single update point.

## 10. Placeholders & stubs shipped (must be replaced before relying on them)

Inert stand-ins shipped to stand up the spine. Each is wired and exercised by the architecture but does
**no real work**; none is a safety/behaviour guarantee. Greppable in code via `PLACEHOLDER(publishing#N)`.

| Where | What it does today | What replaces it | When |
|---|---|---|---|
| `permissiveModerationGate` (`src/crystal/ModerationGate.ts`) | Approves **everything** (`ok:true`). Preserves the async `pending → scan → published\|rejected` path so the gate is never bypassed structurally, but performs **no CSAM detection and no NCMEC reporting**. Container wires it because no real scanner exists. | A real `ModerationGate` impl: hash-match (PhotoDNA/known-CSAM lists) + classifier for novel material **and** NCMEC CyberTipline reporting on a confirmed match (18 U.S.C. §2258A). | **Before** the feed is exposed to real public traffic. Hard blocker for go-live. |
| `ModelPublishAdapter` upload — EXTERNAL registries (`src/crystal/ModelPublishAdapter.ts`) | The **pluggable `RegistryUploader` seam IS real** (2026-06-22): the adapter delegates real byte movement to a per-platform strategy injected on the `ModelRegistry`, so HF/Civitai/others are peer strategies, none privileged. But **no concrete uploader is wired yet** → the registries are projection-only (`account + slug → URL`); the returned repo URL is not-yet-real. The §5d access reconciler around it is real; the OUR-bucket path (`destination:'r2'`) moves real bytes (`BucketAdapter._hostModel`). | A concrete `RegistryUploader` per platform: **HF needs LFS** (the legacy `HuggingFaceHubService.js` base64-inlines a whole file into one commit — model-card only, not multi-GB weights), streaming source→LFS (reuse the #2 `fetchStream` primitive); **Civitai needs its upload API** (none public today). Plus real `retract` = repo deletion. | Before EXTERNAL model publishing is offered to users (the URL is a dangling handle until then). |
| `FeedAdapter.externalRef` (`src/crystal/FeedAdapter.ts`) | Mints a cosmetic `feed:<uuid>` handle; the feed is actually served from `Editionum.listFeed`. No dedicated feed backend (no fan-out / cache / ranking). | A real feed service if/when scale needs one — the adapter is the seam. | Not blocking; only if the store-backed read stops sufficing. |
| `MintAdapter` / `MarketplaceAdapter` (`src/crystal/MintAdapter.ts`) | **Freeze is real**: content-addresses `provenanceHash + owners[] + size` into a deterministic `mint:<chain>:<sha256>` / marketplace listing handle (the immutable drop identifier). But it submits **no on-chain transaction** (no Catena/CreditVault mint, no contract, no chain-issued tokenId, no per-token `tokenURI`) and makes **no real marketplace API call** — the returned handle is a projection, not an on-chain/venue artifact. | A real on-chain minter (Catena/CreditVault rails: deploy/mint, capture the tx + tokenId; assemble `tokenURI`s — the mutable hosted layer is the living-NFT work #6) and a real marketplace client (list/delist via the venue API). | Before minting/listing is offered to users (the handle is a deterministic-but-off-chain reference until then). |

**Discovery:** `grep -rn "PLACEHOLDER(publishing" src/` lists every inert site. Keep this table in sync when
adding or removing one.
