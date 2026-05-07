# Workflow Templates

Canonical ComfyUI graph templates consumed by the fractal-Tool Compiler.

## File naming

`<templateId>-v<major>.json` flat in this directory. Example: `flux-schnell-v1.json`.

When the breaking change requires a new major version, add `<templateId>-v2.json` alongside; the registry keeps both reachable.

## Schema

```jsonc
{
  "templateId": "<slug>",                 // matches filename, required
  "version": "<integer string>",          // matches filename, required
  "displayName": "<human readable>",
  "seedInputKey": "<inputSchema key>",    // which Tool input carries the seed
  "comfyApiPayload": { ... },             // raw ComfyUI graph with placeholder values
  "slotMap": {                            // JSON-pointer => Tool input key
    "/<node>/inputs/<param>": "<inputKey>"
  },
  "requiredModels": [
    {
      "role": "unet|vae|clip|lora",
      "id": "<slug>",
      "url": "https://models.miladystation2.net/<role>/<filename>",
      "dest": "<role>/<filename>"        // relative to /root/ComfyUI/models/
    }
  ],
  "platformHints": { "vramGb": 24, "expectedSteps": 4 }
}
```

## Conventions

- **Seed placeholder:** `88888888`. The Compiler always overwrites it with the resolved seed; the value on disk is illustrative.
- **Text placeholders:** `"PLACEHOLDER"`. The Compiler substitutes via `slotMap`.
- **Slot-map keys** are JSON pointers into `comfyApiPayload`. Phase 1 handles string values (lookup in `inputs`). Phase 2+ may accept object values like `{ "kind": "expression", "expr": "width * 2" }`.
- **Model URLs** must be public (Compiler emits unauthenticated `wget`). Self-hosted on `models.miladystation2.net` (R2-backed, free egress).
- **Model `dest`** is relative to `/root/ComfyUI/models/`; mkdir is automatic.

## Adding a new template

1. Author the `comfyApiPayload` (lift from a working benchmark or a tested graph).
2. Identify which inputs slot in; write `slotMap`.
3. List `requiredModels` with stable URLs.
4. Save as `<templateId>-v1.json`.
5. Add a smoke check assertion in `WorkflowTemplateRegistry.js` that `get('<templateId>', '1')` resolves and the slot map covers all expected inputs.
