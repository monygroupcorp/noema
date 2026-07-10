# Spec — pin ComfyUI + bump torch: unpinned HEAD broke every ComfyUI pod (P0)

**Date:** 2026-07-10 · **For:** a repo-context agent on `noema-crystal` · **Status:** spec, not started
**Severity: P0** — live repro on staging 2026-07-10 19:16 UTC, actum `16637f94…` (klein
txt2image, owner-funded): job failed in 8s with
`scaled_dot_product_attention() got an unexpected keyword argument 'enable_gqa'`.
Pod terminated cleanly, actum failed, reservation released — fail path worked; the gen path
is what's broken.

## Root cause (two stacked pins, one missing)
- Pod bootstrap clones **ComfyUI HEAD, unpinned**:
  `git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git`
  (`src/crystal/SecurePodClient.ts:751`). Every pod gets whatever master is that day.
- Every ComfyUI fundamentum pins the image at **torch 2.4.0**
  (`runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04`,
  `src/crystal/seeds/fundamenta.ts:21-22,44-45,62-63,84-85`, and the klein entries ~:199,:224).
- `torch.nn.functional.scaled_dot_product_attention(..., enable_gqa=)` exists only in
  **torch ≥ 2.5**. ComfyUI master now passes it (qwen3 text-encoder attention path among
  others) → TypeError on 2.4.
- Consequence: **ALL ComfyUI substrates fail today** (flux-schnell's June successes predate
  the HEAD drift). Almost certainly the same root as
  `2026-07-08-klein-studio-provisioning-investigation.md` (studio pods "never come up") —
  update that handoff when confirmed.

## Fix (do both — the drift is the disease, torch is the symptom)
1. **Pin ComfyUI.** Clone a named tag, single constant (e.g. `COMFYUI_VERSION` in
   `SecurePodClient.ts` or on the Fundamentum if per-substrate pinning is warranted —
   crystal-first: Fundamentum already version-pins everything else, so a `comfyRef` field
   there is the honest home; wire bootstrap to use it, default constant fallback).
   `git clone --depth 1 --branch <tag>`.
2. **Bump the image.** Pick the current runpod/pytorch tag with torch ≥ 2.5 (check what
   RunPod publishes; prefer latest stable torch 2.x + cuda 12.x). Update ALL ComfyUI
   fundamenta seeds + reseed. Fundamentum is version-pinned by design — bump `versio` per
   ADR-0005 conventions.
3. **Compatibility gate:** pick the (image, ComfyUI tag) pair together and verify ONE live
   run (flux-schnell = cheapest) before rolling every substrate. klein + qwen3 TE is the
   sensitive path — verify klein second (owner's staging quote flow, small run).
4. **Regression note for the future:** any ComfyUI bump = deliberate commit changing the
   pinned ref, never ambient. Add one hermetic guard: bootstrap command string contains
   `--branch` (so an unpinned clone can't silently return).

## Acceptance
- flux-schnell run green on staging with new (image, tag) pair; klein txt2image green
  (the failed actum `16637f94…`'s workflow re-run succeeds).
- All ComfyUI fundamenta seeds updated + reseeded; `Fundamentum.versio` bumped.
- Hermetic guard on pinned clone. Klein-studio handoff updated with confirmed/denied root.

## Leads
- `src/crystal/SecurePodClient.ts:748-760` (bootstrap), `scripts/pod/comfyrunner.py` (runner).
- `src/crystal/seeds/fundamenta.ts` (all `imageVersion` pins).
- Krea2 memory notes ComfyUI v0.26.0 for krea support — pick a tag ≥ whatever klein/qwen3
  requires; verify against the failing workflow.
- Observability nit to fix in passing: `models ready` logs `downloadBytes:0` despite real
  downloads (`cursor:comfyrunner`) — dead metric.
