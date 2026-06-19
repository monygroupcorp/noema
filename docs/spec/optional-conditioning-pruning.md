# Optional conditioning inputs → compile-time branch pruning

**Status:** design note (enabler for the unified `sdxl-plus` effect flow). Main-thread / Compiler work.
**Depends on:** the i2i image-input primitive (ADR-0008 follow-up — runner-side download keyed on `Porta.type`).
**Motivates:** `src/crystal/workflows/drafts/sdxl-plus-v1.draft.json`.

## The user-facing goal

One SDXL `effect` flow that takes a prompt plus **any subset** of conditioning images — style (IPAdapter),
canny (ControlNet), pose (OpenPose-ControlNet) — and stacks whichever are provided in a single sampling
pass. So `style+pose`, `canny+style`, `style` alone, etc. are all the same flow, selected by which images
the user passes. This is the best UX: one knob set, every combination, no template explosion.

## Why this needs an engine capability (and isn't just "optional Portae")

The crystal already supports optional inputs (`Porta.required: false`). The hard part is the **graph**:
a ComfyUI node errors if a required input is null, so you cannot just leave an absent image's branch
dangling. The old `sdxlplus` combo worked around this with `Any Switch (rgthree)` nodes that ALWAYS fed
the IPAdapter *some* image (style→control→pose fallback) — so IPAdapter ran even when the user only wanted
pose. That cross-wiring is exactly the "overloaded / messed up" behavior we are removing.

The clean fix is **compile-time pruning**: when an optional aditus is absent at run time, the Compiler
removes the subgraph fed by that input's slot and rewires the consumer to the base (unconditioned) signal.
No `Any Switch`, no rgthree dependency, no always-on IPAdapter.

## The capability (proposed Compiler behavior)

For a flow whose template declares `conditionalBranches`, at compile time:

1. Collect the set of **dropped nodes** = the union of `branch.nodes` for every optional aditus key that
   is **absent** from the run inputs.
2. Build a **passthrough lookup** = the union of `branch.passthrough` for those same absent branches.
   `passthrough[nodeId][outIndex] = [baseNode, baseOut]` says "any link to this dropped node's output
   `outIndex` should fall back to `[baseNode, baseOut]`."
3. Delete the dropped nodes.
4. For every **surviving** node input that is a link `[id, out]` where `id` was dropped, replace it with
   `resolve([id, out])`, where `resolve` follows `passthrough` **transitively**: if the fallback target is
   itself a dropped node, follow ITS passthrough, repeating until the link lands on a surviving node.

Transitive resolution (step 4) is the crux. It is what makes composed prunes correct and order-independent:
with both canny and pose absent, `KSampler.positive = ["82",0]` resolves `82→[112,0]→[6,0]`, landing on the
plain text encode. With all three absent, the flow degrades exactly to plain SDXL `make`.

This is a general, declarative mechanism — not SDXL-specific. Any optional-conditioning flow (flux
control/styleref, etc.) reuses it. That is why it belongs in the Compiler rather than a bespoke graph hack,
and why it does not compromise the one-Essentia-one-template organization: `sdxl-plus` stays a single atomic
flow with optional Portae; the Compiler resolves the graph per run.

## Worked branch table (the `sdxl-plus` draft)

Conditioning chain order: `CLIPTextEncode(6/7)` → `Canny-ControlNet(112)` → `OpenPose-ControlNet(82)` →
`KSampler(3)`. Model path: `MultiLora(46)` → `IPAdapterUnifiedLoader(73)` → `IPAdapterAdvanced(72)` →
`KSampler.model`. Each branch's `passthrough` is keyed on the node downstream consumers reference.

| Absent input | Drop nodes | passthrough |
|---|---|---|
| `style_image` | 20, 73, 72 | `72.0 → ["46",0]` (model path) |
| `canny_image` | 30, 111, 113, 112 | `112.0 → ["6",0]`, `112.1 → ["7",0]` |
| `pose_image` | 40, 144, 81, 82 | `82.0 → ["112",0]`, `82.1 → ["112",1]` |

All 2³ = 8 image subsets were simulated against this table (drop + transitive resolve): every one yields a
graph with no dangling links. The all-absent case == the canonical `sdxl` make graph.

## Fallback if this is deemed too costly

The three atomic flavor drafts (`sdxl-style`, `sdxl-canny`, `sdxl-pose`) need only the i2i primitive — no
pruning. They ship the single-flavor UX immediately and remain the graceful degrade path. `sdxl-plus`
supersedes them once pruning lands; until then it is parked as a blocked draft, costing nothing.
