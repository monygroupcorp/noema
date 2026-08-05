#!/usr/bin/env npx tsx
/**
 * port-workflow.ts — convert an old ComfyDeploy workflow (ComfyUI API JSON) into the crystal form.
 *
 * The old bot exposed user inputs via `ComfyUIDeployExternal*` nodes wired into consuming nodes.
 * Crystal exposes them via a `slotMap` (JSON-pointer → aditus key) + typed `aditus` Portae. This
 * scrubs the deploy-specific nodes and emits: { inputTemplate (clean graph), slotMap, aditus,
 * customNodes, loraCapable, outputs }. It is a PORT AID, not a one-click — review the draft aditus
 * + pin model defaults by hand (see docs/reference/old-workflows/README.md).
 *
 *   npx tsx scripts/port-workflow.ts docs/reference/old-workflows/sdxl
 */
import fs from 'node:fs'

// ── External-node type → crystal Porta type ──────────────────────────────────
const EXT_TYPE: Record<string, string> = {
  text: 'text', numberint: 'int', number: 'float', image: 'image', video: 'video',
  checkpoint: 'checkpoint', lora: 'lora', boolean: 'boolean',
}

// ── class_type → custom-node pack (authoritative: comfydeploy machine manifest, 2026-06-19; see INVENTORY.md) ────
const PACKS: Array<[RegExp, { url: string; name?: string }]> = [
  [/MultiLoraLoader|LoraTextExtractor/, { url: 'https://github.com/skfoo/ComfyUI-Coziness', name: 'ComfyUI-Coziness' }],
  [/IPAdapter/,                          { url: 'https://github.com/cubiq/ComfyUI_IPAdapter_plus', name: 'ComfyUI_IPAdapter_plus' }],
  [/rgthree|Any Switch/,                 { url: 'https://github.com/rgthree/rgthree-comfy', name: 'rgthree-comfy' }],
  [/OpenPose - Get poses/,               { url: 'https://github.com/alessandrozonta/ComfyUI-OpenPose', name: 'ComfyUI-OpenPose' }],
  [/WD14Tagger|pysssss/,                 { url: 'https://github.com/pythongosssss/ComfyUI-WD14-Tagger', name: 'ComfyUI-WD14-Tagger' }],
  [/InspyrenetRembg/,                    { url: 'https://github.com/john-mnz/ComfyUI-Inspyrenet-Rembg', name: 'ComfyUI-Inspyrenet-Rembg' }],
  [/ResizeAndPadImage|ImageConcanate/,   { url: 'https://github.com/kijai/ComfyUI-KJNodes', name: 'ComfyUI-KJNodes' }],
  [/UltimateSDUpscale/,                  { url: 'https://github.com/ssitu/ComfyUI_UltimateSDUpscale', name: 'ComfyUI_UltimateSDUpscale' }],
]

type Node = { class_type?: string; type?: string; inputs?: Record<string, unknown>; _meta?: unknown }

const path = process.argv[2]
if (!path) { console.error('usage: port-workflow.ts <old-workflow-file>'); process.exit(1) }
const graph = JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, Node>
if (graph.nodes) { console.error('UI format (has nodes[]) — re-grab the API export'); process.exit(1) }

const externals = new Map<string, { inputId: string; type: string; default: unknown; description: string; required: boolean }>()
const slotMap: Record<string, string> = {}
const aditus: Record<string, { type: string; required?: boolean; default?: unknown; description?: string }> = {}
const customNodes: Array<{ url: string; name?: string }> = []
const outputs: string[] = []
let loraCapable = false

// 1. Catalogue ComfyUIDeployExternal* nodes (the exposed inputs).
for (const [id, node] of Object.entries(graph)) {
  const ct = node.class_type ?? node.type ?? ''
  if (ct.startsWith('ComfyUIDeployExternal')) {
    const suffix = ct.replace('ComfyUIDeployExternal', '').toLowerCase()
    const inp = (node.inputs ?? {}) as Record<string, unknown>
    const inputId = String(inp.input_id ?? `input_${id}`)
    const def = inp.default_value
    externals.set(id, {
      inputId,
      type: EXT_TYPE[suffix] ?? 'text',
      default: def,
      description: String(inp.description ?? inp.display_name ?? ''),
      required: def === undefined || def === null || def === '',
    })
  }
  if (/MultiLoraLoader|LoraTextExtractor/.test(ct)) loraCapable = true
  if (/ComfyDeployOutput|SaveImage|SaveVideo|SaveAudio|VHS_VideoCombine/.test(ct)) outputs.push(`${id}:${ct}`)
  for (const [re, pack] of PACKS) {
    if (re.test(ct) && !customNodes.some(c => c.url === pack.url)) customNodes.push(pack)
  }
}

// 2. Resolve each external node's consumers → slotMap, and strip the external (rewire to default).
const cleaned: Record<string, Node> = JSON.parse(JSON.stringify(graph))
for (const [extId, ext] of externals) {
  for (const [cid, node] of Object.entries(cleaned)) {
    for (const [slot, val] of Object.entries(node.inputs ?? {})) {
      // a link is [sourceNodeId, outputIndex]
      if (Array.isArray(val) && String(val[0]) === extId) {
        slotMap[`/${cid}/inputs/${slot}`] = ext.inputId
        ;(node.inputs as Record<string, unknown>)[slot] = ext.default ?? null   // placeholder; slotMap injects at compile
      }
    }
  }
  aditus[ext.inputId] = {
    type: ext.type,
    ...(ext.required ? { required: true } : { default: ext.default }),
    ...(ext.description ? { description: ext.description } : {}),
  }
  delete cleaned[extId]   // scrub the deploy node
}

// 3. Report.
const out = {
  name: path.split('/').pop(),
  loraCapable,
  externalInputs: externals.size,
  aditus,
  slotMap,
  customNodes,
  outputs,
  inputTemplate: cleaned,
}
console.log(JSON.stringify(out, (_k, v) => v, 2))
