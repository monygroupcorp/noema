# ADR-0010: Ephemeral workflow templates — the palette/composition trust boundary

- **Status:** proposed
- **Date:** 2026-06-30
- **Relates to:** ADR-0003 (verbs, bindings, saved versions — a user fork is a `deriveSavedModus` DB record;
  this ADR extends "ephemeral DB authoring" from *forks* to *new graph topologies*), ADR-0005 (`Fundamentum` —
  substrates stay code/admin-gated here), ADR-0007 (runner/executor split — `customNodes` provisioning is the
  primary attack surface), ADR-0001 (no new ring nouns — the palette is a registry, not a new ring boundary).
- **Grounded by:** the saved-flow runtime path (`CrystalApi.saveFlow` → `deriveSavedModus` → `modorum.register`,
  `src/allocutio/api/CrystalApi.ts:1000`), which already ephemeralizes *forks* in Mongo.

## Context

A user custom **fork** is already ephemeral and safe: `CrystalApi.saveFlow()` derives a `canonica:false`,
`auctor`-owned `Modus` (`deriveSavedModus`) and `modorum.register()`s it to the Mongo `modi` collection at
runtime — no PR, no deploy. It is safe because a fork only *bakes config and pins a registered LoRA onto an
existing, code-shipped `workflowTemplate`*. It introduces no new graph and no new code.

The open question: can we likewise let users author a **genuinely new workflow template** (a new ComfyUI graph
topology) or **substrate** at runtime, without a code deploy — *without* opening ourselves to remote code
execution? Today we cannot, and the seams show exactly why:

1. **`customNodes` is an unguarded RCE primitive.** A template carries
   `customNodes: Array<{ url; name }>` (`WorkflowTemplateRegistry.ts:40`). The Compiler forwards it verbatim
   (`Compiler.ts:365`) and `comfyrunnerClient` ships it to the pod (`comfyrunnerClient.ts:100`,
   `body.customNodes = input.customNodes ?? []`), where the runner **git-clones + pip-installs** each repo
   (ADR-0007, `_ensure_custom_nodes`). A user-authored template pointing `customNodes` at a hostile repo runs
   arbitrary Python on a GPU pod. This is the dominant risk.
2. **Raw model URLs are an SSRF / malicious-weight vector.** Model resolution precedence is
   `Intella > template.requiredModels fallback > MODEL_NOT_RESOLVED` (`Compiler.ts:260`). The registered-`Intella`
   path is curated, but the template's own `requiredModels[].url` is still honored as a fallback — a user template
   could name internal URLs (SSRF), pickle checkpoints (`.ckpt`/`.pt` = RCE on load), or multi-hundred-GB files (DoS).
3. **Arbitrary `class_type`s.** Some ComfyUI nodes shell out, read the filesystem, or fetch URLs. A free-form graph
   can reach them even with a safe node *pack* installed.

What is *already* safe and reusable: `mediaInputs.destFilename` is system-generated (`noema_image_<hash>.png`,
`Compiler.ts:103`) — no user path traversal; and `Intella` already carries a resolvability gate
(`canonica` + `access:'public'|'private'`, set via the publishing reconciler `setAccess`,
`src/types/intelligendi.ts:284`) — a weight is downloadable only once curated.

The irreducible fact: **new arbitrary code can never be safely ephemeral** — it *is* an RCE primitive. A new graph
*topology*, however, can be — if it may only compose vetted building blocks.

## Decision

Split a "workflow template" into two layers across a trust boundary. **Ephemeralize the graph; gate the code.**

### 1. The capability layer (the palette) — admin-gated, code/image-shipped, slow

A curated **palette** is the set of things a user graph may reference:
- **Allowed `class_type`s** — an allowlist. Anything that execs a shell, reads arbitrary FS, or fetches a URL is
  excluded (banlist-backed).
- **Vetted custom-node packs** — pinned by id → `{ repo, commit }`, **pre-built into the pod image**, never cloned
  from user input. (`ComfyUI-Coziness` becomes palette entry `coziness@<sha>`.)
- **Registered weights** — the existing `Intella` registry, resolvable only when `canonica` or `access:'public'`.

Crossing into the palette (a new node pack, a new base model/substrate, a new `class_type`) stays an
**admin-reviewed** action — a PR/deploy or an approval queue with a scan + a pinned hash, reusing the same
"register → moderate → mark resolvable" gate `Intella`/`Editio` already implement. **Substrates (`Fundamentum`,
ADR-0005) are NOT ephemeralized** — they remain code/admin-gated, because a substrate is a base image + runtime + weights.

### 2. The composition layer (the template) — DB-backed, ephemeral, instant

User-authored graph topologies become DB records, exactly like saved modi: a `workflowTemplates` Mongo collection
keyed by `id+version`, carrying `auctor` + `canonica:false`. A user composes new *wiring* of palette nodes over
registered models; they can never introduce new *executable code*.

### 3. The gate — `validateTemplate`, fail-closed, on save

A pure `validateTemplate(template, palette, intellarum)` (sibling to `hashModus`) runs when a user saves a template
(a new `CrystalApi.saveTemplate()`, sibling to `saveFlow`) **and** defensively in `Compiler.compile`. It rejects, on
save, not at run:

1. Every node `class_type` ∈ the palette allowlist (and ∉ the banlist).
2. `customNodes` resolved **by pack-id against the palette**; a user-supplied `url` is **ignored entirely**.
   `comfyrunnerClient` is changed to look packs up by id, never to clone a caller url.
3. **No `requiredModels` fallback for `canonica:false` templates** — models resolve *only* via `Intellarum` to
   registered `access:'public'`/`canonica` weights; `safetensors`-only; size-capped; content-hash-pinned. An
   unregistered model ref is a hard reject.
4. Parameter bounds — resolution / steps / batch / node-count ceilings; reject cyclic graphs.
5. Filenames/dest stay system-generated (already true for media inputs).

### 4. Defense in depth (assume the validator has a gap)

- **Egress-locked pods** — only the model CDN (R2 + an allowlist of model hosts) + the result upload; no internal
  network, no secrets, no control-plane reachability. (We already run RunPod SECURE per the comfyui-deploy
  shootout — this tightens the egress allowlist.)
- Fresh ephemeral container per run, no creds mounted, VRAM/time caps + the existing hard-cap reaper.

### What we will NOT do

- Not ephemeralize **new code**: no runtime-supplied `customNodes` urls, no runtime-supplied substrate images, no
  arbitrary `class_type`s. New capabilities cross the trust boundary through review, once.
- Not honor a template's raw `requiredModels` URLs for non-canonical templates.
- Not ephemeralize `Fundamentum` substrates.

## Consequences

**Easier:** users author new graph topologies (T1) at runtime with zero deploy — the same instant-DB experience as
saved forks (T0). The trust boundary is crossed **once per new capability, not once per template**: an admin vets a
node pack or a base model a single time → it joins the palette/`Intella` registry → unlimited users then compose
unlimited new graphs against it with no further review. This is what makes "ephemeral new templates" tractable.

**Harder / explicit costs:**
- The palette must be rich enough that most "new templates" are pure re-wiring; a thin palette pushes users back to
  T2 (review). Growing the palette is the ongoing product work.
- A new node pack or base model is still gated (PR or approval queue) — by design.
- `comfyrunnerClient` and `Compiler` must drop their current "trust the template's customNodes/requiredModels"
  behavior; canonical templates keep working because their packs/models are already in the palette/registry, but the
  change must be made carefully so the canonical flows (e.g. `kleinedit4b`'s `coziness` pack) resolve by id.

**Enforcement:**
- `validateTemplate` is a pure function with unit tests (mirroring `hashModus`/`deriveSavedModus`): a table of
  hostile templates (unknown `class_type`, user `customNodes` url, unregistered model, oversized params, cycle) that
  must all reject, and the canonical templates that must all pass.
- A registration invariant: `modorum`/`workflowTemplates` reject a `canonica:false` template that fails the gate.
- An egress-policy check in the pod bootstrap (deny-by-default outbound + allowlist).

**The tier model (the resulting UX):**
- **T0** — fork an existing template (`saveFlow`). *Have it.*
- **T1** — compose a new graph from the palette + registered models (`saveTemplate` + `validateTemplate`). *This ADR.*
- **T2** — a new node pack or base model. *Admin-gated; then it becomes a palette entry for everyone's T1.*

**Follow-ups:**
- A spec detailing the palette schema, the `class_type` allow/ban lists, the
  `validateTemplate` rule table, and the `saveTemplate` API/MCP surface.
- The pod egress allowlist (the model-host set) as a config artifact.
- A migration note: the on-disk `*-v*.json` canonical templates and the new DB `workflowTemplates` collection
  coexist (canonical = code-shipped; community = DB), unified behind one `WorkflowTemplateRegistry` lookup.
