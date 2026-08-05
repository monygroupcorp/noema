# HANDOFF: Port the 17 old ComfyDeploy workflows into crystal flows

**Goal:** bring the whole old-bot workflow library into the crystal as registered flows (Essentiae),
so we have a full palette to **combine into spells (`compositus` modi) and cooks (`Collectio`)**.
Fully land everything that's unblocked; for the blocked ones, produce the scaffold + a precise
one-line blocker note so each is a short hop to done when its blocker clears.

**Branch:** `chainengine-migration`. **DB:** seed only against `noemaplane` (staging) — `noema` is
LIVE PRODUCTION; never seed/test against it. The `.env` `MONGO_DB_NAME=noema`, so any `run-with-env`
script defaults to prod — **hardcode `noemaplane`** when you seed.

---

## 1. What a "crystal flow" is (the shape you're producing)

A runnable flow is **four seed records** that compose (ADR-0005 decomposed the old monolith `runpodSpec`
into these):

| Record | File | What it carries |
|---|---|---|
| **Essentia** (an atomic `Modus`) | `src/crystal/seeds/essentiae.ts` | the flow's identity + `aditus`/`exitus` schema + `categoria`; references a Fundamentum by id; names its `workflowTemplate` |
| **WorkflowTemplate** | `src/crystal/workflows/<templateId>-v<version>.json` | the ComfyUI graph (`inputTemplate`) + `slotMap` (JSON-pointer → aditus key) + `customNodes` + `requiredModels` fallback |
| **Intella** (a weight) | `src/crystal/seeds/intellae.ts` | one model/checkpoint/lora/vae: `familia`, `sources[]` (R2 mirror first), `dest`, `sizeGb` |
| **Fundamentum** (substrate) | `src/crystal/seeds/fundamenta.ts` | the pod image + `runtime: 'ComfyUI'` + base weights (`intellae`) + `vramGb` |

Read `src/crystal/seeds/essentiae.ts` (`ESSENTIA_RUNMAKE_SD15`) + `src/crystal/workflows/sd15-v1.json`
+ `fundamenta.ts` (`sd15-comfyui`) end-to-end first — that is the **reference port** of one flow; every
new flow mirrors its structure.

**The param mechanism (how a user knob reaches the graph):** an `aditus` `Porta` ↔ a `slotMap` entry
(`"/<nodeId>/inputs/<field>": "<aditusKey>"`) ↔ the graph node input. The Compiler's `_applySlotMap`
injects the aditus value at that JSON pointer at run time. To expose a param, add a Porta + a slotMap
entry. (ADR-0003 = verbs/bindings/saved-versions; ADR-0004 = command surface / conditioning-flavors-are-flows.)

---

## 2. The backlog + the tooling

- **Backlog:** `docs/reference/old-workflows/` — 17 files (NO `.json` extension — they're ComfyUI
  API-format exports). `INVENTORY.md` there is the **decision dataset**: each file → capability
  signature → canon verb → the custom-node packs it needs. **Start by reading INVENTORY.md in full.**
- **Converter (built, use it):** `npx tsx scripts/port-workflow.ts docs/reference/old-workflows/<name>`.
  It finds the `ComfyUIDeployExternal*` input nodes → emits typed `aditus` + `slotMap`, STRIPS the deploy
  nodes (rewiring consumers to slot-injected defaults), maps the known Coziness pack, detects
  `loraCapable`, and reports outputs. **It is a port AID, not a finished product** — you review the
  aditus, trim the verbose descriptions, and pin model defaults by hand.
- **The acceptance gate (hermetic, no pod):** `tests/unit/crystal/workflowTemplates.test.ts` validates
  every `src/crystal/workflows/*.json` — filename must equal `<templateId>-v<version>.json`, `slotMap`
  pointers must resolve into `inputTemplate`, `requiredModels` entries need `role+id+dest`. Your new
  template MUST pass this. Run: `npm run test:hermetic` (includes it) or `npm run test:crystal`.
- **Registration:** `scripts/crystal/seed-canon.ts` registers `CANONICAL_INTELLAE` + `CANONICAL_ESSENTIAE`
  (content-hashes each via `hashModus`) into `noemaplane`. Add your new seeds to those arrays.

---

## 3. The per-flow recipe

1. `npx tsx scripts/port-workflow.ts docs/reference/old-workflows/<name>` → read its aditus/slotMap report.
2. Author `src/crystal/workflows/<templateId>-v1.json`: the cleaned `inputTemplate` graph + `slotMap` +
   `customNodes` (pack URLs) + `requiredModels` (url/dest fallback). Trim verbose aditus descriptions.
3. **Pin model defaults for canon:** a checkpoint is NOT a user input for a canonical flow — bake it as a
   fixed graph value + declare its weight as an `Intella` (add to `intellae.ts`), referenced by the
   Fundamentum (shared base) or the Essentia's own `intellae` (flow-specific weight).
4. Add the `Essentia` to `CANONICAL_ESSENTIAE` (`essentiae.ts`): `genus:'atomicus'`, `categoria`, the
   `aditus`/`exitus`, `fundamentumId`, `workflowTemplate`. Mirror `ESSENTIA_RUNMAKE_SD15`.
5. `npm run test:hermetic` green → the structure is accepted. (Graph *correctness* still needs a real-pod
   staging run — that's a later verification pass, not your gate.)
6. Verb binding is a follow-up (ADR-0003) — just register the canonical Essentia; don't rebind defaults.

---

## 4. BLOCKERS — read before you touch i2i flows

Two hard dependencies gate most of the backlog. **Respect them — don't work around them.**

### (A) Image input into ComfyUI does not exist yet — being built on the main thread
Every **i2i** flow (anything taking an input image/video/audio) needs a mechanism to feed an input
URL into a ComfyUI graph. The crystal has NONE today (all current flows are text→image), and the old
bot's `ComfyUIDeployExternalImage` node was deliberately stripped. **This primitive is in active
development on the main thread (ADR-0008 follow-up: the i2i image-input primitive — runner-side
download keyed on `Porta.type`).** **DO NOT build it yourself**, and do not try to make i2i flows
*runnable*. Port their scaffolds (template + aditus + a placeholder `LoadImage` node) and mark them
`BLOCKED: needs i2i image-input primitive`. They light up with no further graph work once it lands.

### (B) Custom-node pack → URL map is incomplete
Only **Coziness** (`https://github.com/skfoo/ComfyUI-Coziness`, for `MultiLoraLoader`/`LoraTextExtractor`)
is known. `WD14Tagger`, `InspyrenetRembg`, `UltimateSDUpscale`, IPAdapter, ControlNet aux, rgthree,
etc. are **TBD** — see INVENTORY.md §"Custom-node packs". **First discrete sub-task:** pull the
comfydeploy machine custom-node manifest via API (`COMFY_DEPLOY_API_KEY` is in `.env`) → authoritative
pack→URL map → record it in INVENTORY.md. A flow needing an unmapped pack is `BLOCKED: pack URL <name>`.

> **Do NOT port `upscale` / `sdxlupscaleillustrious`.** The main thread is building a **pack-free,
> model-only** upscale (core `UpscaleModelLoader` + `ImageUpscaleWithModel`, no `UltimateSDUpscale`,
> no FLUX checkpoint). Skip those two to avoid collision.

---

## 5. Tiered worklist

**Tier 1 — fully land now (unblocked: t2i, Coziness-only or core).** Template + Intella + Fundamentum +
Essentia + hermetic-green:
- `sdxl` → **make** (sdxl family)
- `chroma` → **make** (chroma family)
- `sdxlplus` → **make** (sdxl + Coziness multi-lora)

**Tier 2 — scaffold + `BLOCKED: needs i2i image-input` (blocker A).** Port the graph + aditus, leave a
placeholder image-load node, don't seed as runnable:
- `fluxi2i`, `sdxli2iplus`, `sdxli2iplusv2` → **effect** (img2img/restyle)
- `kontextedit`, `kontexteditii` → **effect** (edit flavor)
- `fluxpluscontrol`, `fluxplusstyleref` → **effect** (control / styleref flavors) — *also* blocker B (IPAdapter/ControlNet packs)
- `rmbg` → **enhance** — *also* blocker B (InspyrenetRembg)
- `tag` → **describe** (i2t) — *also* blocker B (WD14Tagger)
- `i2vunknown`, `ii2vunknown` → **animate** (i2v, Wan) — needs video-output handling too

**Tier 3 — new substrate, scaffold + document:**
- `unknownt2v` → **direct** (Hunyuan text→video) — no image input, but needs a video-output Essentia
  (`categoria` video) + Hunyuan/Wan weights + video `SaveVideo` exitus handling. Scaffold + note the
  substrate gap.

**Skip:** `upscale`, `sdxlupscaleillustrious` (main thread owns a pack-free upscale).
**Re-grab:** `sdxli2iplus` reportedly failed JSON parse (UI-format, not API) — re-export if so.

---

## 6. Definition of done

- **Tier 1:** each flow registered, `npm run test:hermetic` + `npm run test:crystal` green, seeds added
  to `CANONICAL_*` arrays, `INVENTORY.md` row marked ✅ ported. (Real-pod staging verification is a
  separate later pass — not your gate.)
- **Tier 2/3:** a draft template in `src/crystal/workflows/` (or a clearly-marked `.draft.json` if it
  can't yet pass the gate), the aditus/slotMap worked out, and a one-line blocker note in `INVENTORY.md`
  per flow (`BLOCKED: needs i2i image-input` / `BLOCKED: pack URL <name>`).
- The pack→URL map (sub-task B) recorded in `INVENTORY.md`, with as many TBD packs resolved as the
  comfydeploy manifest provides.

## 7. Do NOT
- Build the i2i image-input primitive (Compiler / `ComfyUICompiledSpec` / `comfyrunner.py`) — main thread.
- Touch the compositus engine (`src/crystal/CompositusCursor.ts`, `dispatchInceptio.ts`) — main thread.
- Port the two upscale flows — main thread.
- Seed or test against the `noema` DB — `noemaplane` only.
- Rebind canon verbs or change `CANON_VERBS` — register flows; binding is a separate decision.
