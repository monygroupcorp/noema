# Reference workflows (from the old bot) — NOT canon

Drop old-bot workflow JSON exports here. **These are reference, not canon.** They are deliberately
kept OUT of `src/crystal/workflows/` so the `WorkflowTemplateRegistry` never auto-loads them and the
`workflowTemplates.test.ts` integrity gate never trips on their slop.

## What they're for
- **TASK-008 Part 2 (immediate):** the source of the **comfyui-cozyness `MultiLoRALoader`** node's
  real graph shape — its `class_type`, inputs (model + clip + the `<lora:…>` tag text), outputs — and
  the **custom-node pack git URL**. That node was never ported to the crystal; we mine it from here.
- **The gen-flow backlog** (`docs/capability-map.md` — `effect`/`animate`/`direct`/… canon verbs):
  reference for the graph structure of each operation.

## How we use them (reference, not copy)
Expect slop — hardcoded paths, baked params, ad-hoc node naming. **Do NOT adopt wholesale.** Port by
*re-expressing in crystal form*:
- the model set → a `Modus.intellae` manifest (+ `Intella.familia`), not `requiredModels` ids;
- inputs → typed `Porta`s in `aditus` + a `slotMap`;
- custom nodes → the template's `customNodes` (TASK-008 Part 1 plumbing).

A ported flow isn't "done" until it passes `workflowTemplates.test.ts` and (for gen) a staging run.
The old JSON is the *graph truth*; the crystal template is the clean re-authoring.
