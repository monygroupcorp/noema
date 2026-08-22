import assert from 'node:assert/strict'
import type { CompiledSpec, ComfyUICompiledSpec } from '../../../src/crystal/Compiler.js'

/**
 * Narrow + assert a compiled spec is the ComfyUI graph member, returning it typed.
 *
 * `CompiledSpec` is a structurally discriminated union (ADR-0007): `workflow`/`seed`/
 * `customNodes`/`mediaInputs` live only on `ComfyUICompiledSpec`, so a test that reads them
 * has to say which member it expects. This is the ComfyUI counterpart of the `asInference`
 * helper in `Compiler.inference.test.ts`.
 */
export function asComfyUI(spec: CompiledSpec): ComfyUICompiledSpec {
  assert.ok('workflow' in spec && spec.workflow != null, 'expected a ComfyUICompiledSpec (has .workflow)')
  return spec as ComfyUICompiledSpec
}
