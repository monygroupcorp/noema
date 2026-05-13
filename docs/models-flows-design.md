# Models & Flows Page Design

**Date:** 2026-05-11
**Status:** Workshop draft — not yet implementation-ready.
**Parent doc:** `docs/allocutio-interaction-design.md`
**Sibling doc:** `docs/canvas-design.md`

---

## What These Pages Are

Two catalog pages. One nav item each. Together they are the asset library and the capability library.

```
Models  — the weights: LoRAs, checkpoints, and the tools that trained them
Flows   — the executables: platform flows, personal mints, community published
```

Neither is a settings page or a power-user appendix. Both are primary navigation — discoverable from the top nav on desktop, from the bottom nav on mobile. The user can live entirely in these pages without ever opening the canvas.

---

## The Postauthorship Flywheel

Every published Flow or Model earns royalties on execution by others. The flywheel:

1. Creator publishes a Flow or Model
2. Community uses it — every execution is a royalty event
3. Default sort is **Most Used** — high usage = high visibility = more usage
4. Favorites and quality comments surface rising items before usage accumulates
5. Creator earns passively; quality is rewarded structurally

**Postauthorship:** create once, earn forever. The catalog is a living income stream, not a portfolio.

---

## Shared Page Structure

Both pages share the same layout pattern.

### Tab strip
```
[ Community ]  [ Mine ]
```

- **Community** — all public items, sortable and filterable
- **Mine** — the user's own items (public and private), plus items they've favorited

### Sort controls
```
Sort: [ Most Used ▾ ]   Filter: [ All types ▾ ]   [ All categories ▾ ]
```

Sort options (both pages):
- **Most Used** — default; primary flywheel signal
- **Most Recent** — latest published
- **Most Favorited** — starred by community
- **Most Active** — comment activity in last 30 days

### Card format
```
┌────────────────────────┐
│  [thumbnail / preview] │
│                        │
│  Flow Name             │
│  By @author            │
│  make · 2.3k uses · 847 stars · 12 comments (1 bug) │
└────────────────────────┘
```

Fields on every card face:
- Thumbnail or preview image (generative preview for Flows, style swatch for Models)
- Name
- Author handle
- Category/type badge
- Use count
- Star count
- Comment count with unresolved-bug count when nonzero

The bug count only appears when there are unresolved bug-tagged comments. Clean cards stay clean.

### + Add button
Fixed button at bottom-right of the page, always visible. Expands on tap into action options (see per-page spec below).

---

## Models Page

### What "Model" means here

A model is a weight file that influences generation. First-class types:

```
TYPE          WHAT IT IS
──────────────────────────────────────────────────────────────
LoRA          Fine-tuned delta weights. Activated by trigger words.
              Most common type users will add and find.
Checkpoint    Full diffusion model weights. The base from which
              everything generates. Less frequent to swap.
```

Additional types, visible behind "Show more model types":
- **Embedding / Textual Inversion** — token-level concept injection
- **VAE** — variational autoencoder; affects color/sharpness
- **ControlNet** — spatial conditioning (pose, depth, edge)
- **IPAdapter** — image prompt conditioning

The "show more" collapse prevents the filter from overwhelming new users. LoRA and Checkpoint cover 90% of interactions.

### Models filter strip
```
Type: [ LoRA ▾ ]   Base: [ FLUX ▾ ]   Style: [ all ▾ ]
```

- **Type** — LoRA / Checkpoint / (expanded types)
- **Base model** — FLUX, SDXL, SD1.5, etc. — controls compatibility
- **Style** — tag-based (portrait, landscape, anime, photorealistic, etc.)

### Mine tab additions

Mine shows the user's own models (imported and trained) plus a shortcut to the Training tab.

```
[ Community ]  [ Mine ]  [ Training ]
```

Training is a first-class tab within Models, not buried in settings.

### + Add Model

Tap `+ Add` → two actions:

```
  ┌──────────────────────────────┐
  │  Import model                │
  │  Upload a .safetensors or    │
  │  .ckpt file                  │
  │                              │
  │  Train a model               │
  │  Go to Training              │
  └──────────────────────────────┘
```

**Import flow:**
1. File picker (drag/drop on desktop, file sheet on mobile)
2. Auto-detect type from file structure; user confirms or overrides
3. Name + description form
4. Select base model compatibility
5. Add trigger words (LoRA only)
6. Privacy toggle: Private / Public
7. Confirm → model card appears in Mine

**Train flow:** navigates to the Training tab with a new training job started.

---

## Training Tab

First-class tab within Models. Not a power-user appendix.

### What training produces

A LoRA — a fine-tuned delta trained on images the user uploads. The output is a new model in their Mine library, shareable and mintable.

### Training job card
```
┌────────────────────────────┐
│  [status indicator]        │
│  "my character v1"         │
│  LoRA · FLUX base          │
│  32 images · step 1200/2000│
│  [progress bar]            │
│  Est. 14 min remaining     │
└────────────────────────────┘
```

States: queued → running → complete → failed

### Starting a training job

Required inputs:
- Name
- Image set (upload 10–50 images)
- Base model
- Training preset (fast / balanced / quality — maps to step count and config)
- Trigger word(s) — pre-filled suggestion, editable
- Estimated cost shown at preset selection before any charges run; deducted from credit balance on start; final cost shown on completion

Optional:
- Caption each image manually or auto-caption via the `caption` surface flow
- Advanced settings (learning rate, resolution) behind toggle

On completion: model appears in Mine with a "Newly trained" badge. Creator can immediately publish or keep private.

---

## Flows Page

### Category organization

Flows are organized by transformation type — the same eight categories as the HOME canvas surfaces:

```
CATEGORY    TRANSFORMATION
──────────────────────────────────
make        txt → image
effect      image → image
edit        image → image (masked)
direct      txt → video
animate     image → video
caption     image → text
compose     txt → sound
utilities   image → image (utility)
```

Filter by category collapses the grid to just that transformation type. This matches the mental model a user already has from the canvas.

### Flows filter strip
```
Category: [ all ▾ ]   Base: [ all models ▾ ]   By: [ anyone ▾ ]
```

- **Category** — the eight transformation types above
- **Base** — filter to flows that run on a specific base model (FLUX, SDXL, etc.)
- **By** — anyone / people I follow (future)

### + Add Flow

Tap `+ Add` → two actions:

```
  ┌──────────────────────────────┐
  │  Create new flow             │
  │  Open the canvas and build   │
  │                              │
  │  Import ComfyUI workflow     │
  │  Upload a workflow .json     │
  └──────────────────────────────┘
```

**Create new flow:**
Opens the canvas on a new blank Surface. When the user mints their first connected graph there, it appears in Mine.

**Import ComfyUI workflow:**
1. File picker — accepts ComfyUI `workflow.json` export
2. System parses the graph and identifies input/output nodes
3. LLM-assisted mapping: ComfyUI node names are matched against a known registry to platform Node types automatically; user confirms the mapping, does not do it manually; unmappable nodes become generic Nodes with a warning flag
4. Name + description + category
5. Privacy toggle
6. Confirm → appears in Mine as a published Flow

ComfyUI import is a power-user path but a critical one — it allows the existing ComfyUI community to publish directly without rebuilding on our canvas. This is a major top-of-funnel for community content.

---

## Social Layer

### Favorites

- Star icon on every card, always tappable
- Tap to toggle; optimistic update
- Count visible on card face
- Favoriting a Community item adds it to your Mine tab under a "Favorited" filter
- Favorites contribute to the **Most Favorited** sort
- Favorites are public (others can see your star count, not who starred)

### Comments

Comments are tagged to keep them actionable. Five tags:

```
TAG       PURPOSE
──────────────────────────────────────────────────────────
Bug       "errors on X input" — reports a defect
Fix       "works if you do Y" — community workaround
Fork      "I patched this, see: [name]" — links a derivative
Tip       "pairs well with Z" — usage guidance
Correct   "this model is actually trained on X, not Y" — description fix
```

**Comment lifecycle:**
- Author can mark any comment **Resolved**
- Resolved comments are collapsed but still readable
- Unresolved Bug comments → bug count shown on card face
- If unresolved bug count reaches a threshold, item receives a subtle "needs attention" state in community browsing (exact threshold TBD)

**Comment access:**
- Comment thread is in the item detail view, not on the card
- Card shows only the count and bug count
- Comments on private items: only visible to the item author

**Commenting rules:**
- Auth required; no usage gate (tracking per-session usage is fragile and the anti-spam benefit is marginal)
- Comments on your own items: always allowed

### Comment thread UI (detail view)
```
[thumbnail]
Flow Name · By @author
2.3k uses · 847 stars

  Run     Favorite     Fork     Share

─── Comments (12) ──────────────────────────────
[Bug]  "Errors when input image is over 2048px wide"
       @user1 · 3 days ago   [Resolve]

[Fix]  "Resize to 1536 before connecting, fixes it"
       @user2 · 2 days ago

[Tip]  "Pairs really well with the cinematic LoRA"
       @user3 · 1 day ago

─── Add comment ──────────────────────────────
[tag ▾]  [ Write your comment...        ] [Post]
```

---

## Item Detail View

Tapping any card opens the detail view — a focused screen over the catalog.

**Header:**
- Thumbnail / preview (generative if available)
- Name, author, category badge
- Social row: use count · star count · comment count

**Action bar:**
```
  Run     Favorite     Fork     Share
```

- **Run** — opens a lightweight run modal showing only the flow's exposed inputs; execute and result inline. "Open on canvas" is the escape hatch for customization. The canvas is for building; the catalog is a consumption surface.
- **Favorite** — toggle star
- **Fork** — clones as a versioned derivative with attribution ("based on [original] by @author"); maintains the royalty chain so the original author receives attribution and a share of downstream royalties; opens canvas with the flow pre-loaded
- **Share** — copy link or platform share sheet

**Body:**
- Description
- Tags / compatible models
- Version history (author can publish updates; community sees changelog)
- Comments thread (see above)

**Author block:**
- Avatar, handle, total flow/model count, total community uses
- Follow (future)

---

## Privacy Tiers

Every item has a privacy state:

```
TIER      VISIBLE TO             EARNS ROYALTIES
──────────────────────────────────────────────────
Private   Only you               No
Public    Everyone               Yes
```

Toggle on the item edit screen. Switching from private to public is permanent-ish (the item enters the community catalog). Switching back to private removes it from community discovery but does not delete uses or comments.

---

## Crystal Implications

Two new ring primitives are needed to support the social layer:

**Scholium** (pl. Scholia) — a tagged community annotation
```
id          string
animaId     string           author
targetType  'modus' | 'modos'
targetId    string
corpus      string           the comment text
tag         'bug' | 'fix' | 'fork' | 'tip' | 'correct'
natum       Date
resoluta    Date | null      set by item author on resolve
```

Collection: `noemaplane.scholia`

**Favorites** — embedded on the Modus/Modo document as a count + a set of animaIds. Promote to a separate `favoritum` collection only if "who favorited" queries are needed for notifications.

These are Phase 9 additions to the crystal ring (Phase 8 is Colloquium/Dictum/Memoria).

---

*Do not start frontend implementation until this document is marked implementation-ready.*
