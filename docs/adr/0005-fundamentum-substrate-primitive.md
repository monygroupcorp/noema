# ADR-0005: `Fundamentum` — the provider-neutral substrate primitive

- **Status:** accepted
- **Date:** 2026-06-09
- **Supersedes:** ADR-0001 §"studio base" clause (the part that ruled studio-base is *only* an
  adapter presentation projection and forbade a domain noun for it). The rest of ADR-0001
  (speak the crystal; "flow" === `Modus`/`Essentia`; "studio" === `Materia`; no `Workflow`/`Studio`
  type) stands.

## Context

Provisioning a pod has **three** layers, but the crystal only encoded two — and bolted the third
onto a flow as a provider-named field:

| Layer | What it is | Encoded as (before) |
|---|---|---|
| the flow | recipe: ports, weight manifest, template | `Modus` / `Essentia` ✅ |
| the substrate **spec** | image + runtime + base/support weights + capacity — *provider-neutral* | `Essentia.runpodSpec` 🔴 |
| the substrate **instance** | the live pod actually running | `Materia` ✅ |

`Essentia.runpodSpec` was wrong on two counts:

1. **Provider-named.** Provider-specificity belongs only at the dispatch layer (`Cursor`) and on the
   instance (`Materia.genus = runpod | vastai | local`). A flow *definition* naming "runpod" is the
   crystal getting perverted by an adapter concern.
2. **Scope-conflated.** It mixed a *shareable substrate* (`imageId`, `imageVersion`, `runtime`) with
   *flow-specific form* (`workflowTemplate`, `seedInputKey`, `defaultCookFlags`).

The Telegram adapter then **unconsciously reinvented the missing layer** as `ArmPreset`/`StudioBase`
(image + runtime + base `Intellae`) — synthesized from raw weights because the crystal didn't expose
the substrate as a first-class noun. That clone is the symptom; the missing primitive is the cause.

## Decision

Introduce **`Fundamentum`** (Latin: *foundation, groundwork*; pl. `Fundamenta`, gen. pl.
`Fundamentorum`) as a **crystal-core primitive**: the provider-neutral specification of a compute
substrate a flow runs on.

- **Shape:** `imageId` + `imageVersion` + `runtime` + the base/support `Intellae` it provisions +
  capacity hints (vram/disk). Provider-NEUTRAL — no "runpod" in the noun.
- **`Essentia` REFERENCES it, pinned by version:** `fundamentumId` + `fundamentumVersio` (the same
  id+version discipline `Essentia` already uses for `workflowTemplate`). NOT embedded — so a *family*
  of essentiae share one fundament (co-host key = id equality), edits are single-source, and
  `Modus.contentHash` stays meaningful ("flow-logic X on `flux-comfyui@v3`").
- **`runpodSpec` decomposes:** environment half → `Fundamentum`; flow-specific form
  (`workflowTemplate`, `seedInputKey`, `defaultCookFlags`) → stays on `Essentia`; the provider name
  drops to the `Cursor`/`Materia.genus` layer where it already lives. Base weights are already on
  `Modus.intellae` — the `Fundamentum` names which of them are the shared base/support set.
- **`Materia` is the live instance of a `Fundamentum`.** Unchanged in role; it gains nothing it
  didn't already carry (`imageRef`, `runtime`, `installedModels`). Reuse/admission match on the
  fundament the pod was provisioned from.
- **Versioning makes reference safe:** a `Fundamentum` carries its own `versio`/`contentHash`;
  flows pin a version; updates are explicit bumps, never retroactive mutation.

**We will NOT:** keep a provider name in any flow/substrate *definition*; embed the substrate per
flow; let a bare (unpinned) `fundamentumId` retroactively mutate flows.

## Consequences

- **Easier:** family co-hosting (id equality), warm-pod routing, multi-provider (teach a `Cursor`,
  touch zero flows), TEE attestation (a named, hashed substrate to sign), the `/arm` super-user
  custom path (author/own/share a `Fundamentum`), and `/arm` grounding (it lists `Fundamenta`, in
  practice shaped by the `Essentiae` that reference them — the shared vocab with the user).
- **Harder (managed):** one more id to resolve at compile/dispatch (same pattern the Compiler already
  uses for `intellae`); dangling-reference risk (mitigated by canonical + versioned + never-hard-deleted
  `Fundamenta`, as with templates).
- **Enforced by:** the type (`Essentia` loses `runpodSpec`, gains the pinned reference), the Compiler
  reading the `Fundamentum` registry, and the existing boundary test. A migration decomposes the
  current canonical `runpodSpec`s into `Fundamenta` + references.
- **Naming runner-up:** `Apparatus` (the outfitting/equipment) was considered; `Fundamentum` chosen
  for matching the operator's own word for the concept ("the fundament") and reading as foundation.
- **Adapter follow-up (deferred, NOT this task):** `ArmPreset`/`StudioBase` collapses to a thin
  presentation projection *of* a `Fundamentum`. Tracked separately; this ADR is about the core primitive.
