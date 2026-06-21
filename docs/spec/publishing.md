# Publishing (Editio) — spec

**Status:** FINALIZED (2026-06-21) — build-order #1 (feed) ready; nothing built yet. The canonical spec for
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
  huggingFaceAccount?; wallet?; bucket?        // BYO custody targets
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

✅ have · 🟡 lean add · 🟠 new build

1. 🟠 **Spine + feed bite** — `Editio` + `Editionum` + the adapter interface + a `FeedAdapter` + the
   `visibility` flag + one account default. **Publish an `Actum` to our feed.** Cheapest slice that stands
   up the whole spine; immediate advertisement value; the on-ramp to Vestigium. **Hard gate:**
   `visibility:'feed'|'marketplace'` MUST route through the trust-boundary moderation (CSAM scan/NCMEC,
   per the compliance posture) before going public — designed in from line one, not bolted on.
2. 🟠 **Bucket / hosting custody** — `BucketAdapter` (R2, public-hosted or private) + `unlisted` (link)
   visibility. Establishes custody=`nostra`. This is the substrate living NFTs later reuse (we serve the
   `tokenURI`).
3. 🟠 **Model publishing + custody preferences** — generalize the LoRA→HF hardcode into `HuggingFaceAdapter`
   + the `CustodyAdapter` (BYO HF account), governed by `PublishingPrefs`. **Resolves the original
   training-output question:** "the HF adapter is one of several, chosen by the user's custody preference."
4. 🟡 **Rights / license / splits** — `owners[]` snapshot at publish, `license` tag, royalty-split wiring
   (ties `Sodalitas` + the ledger royalty hooks + the compliance catalog/BYO line).
5. 🟠 **Collection / mint** — `MintAdapter` + `MarketplaceAdapter`. The Collectio **freeze → export → mint**
   path (§4e/§5/§6) IS this: a Collectio published with `visibility='marketplace'`, `custody` per arrangement,
   freezing the `owners[]` split + `provenanceHash` + trait DNA into the immutable canon at publish time.
   Publishing **subsumes** Collectio's export adapters rather than duplicating them.
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

- Exact `retract` semantics + hosted-byte deletion per adapter (lands with #2 bucket / #5 mint).
- Wallet-linking → `custody:'theirs'` wiring + living-NFT mutable-metadata hosting (lands with #5/#6).
- Reconciler mechanics (event-hook vs write-through) for keeping `Intella.access` in sync with `Editio` —
  decide at #1/#3 against the then-current Nexus hook rail.
