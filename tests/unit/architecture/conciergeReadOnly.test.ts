import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// The ConciergeAgent's first hard invariant is that it PROPOSES and never SPENDS: its whole tool
// surface is the seven read-only discovery handlers, and it never reaches a spend method. That
// invariant was held by a runtime test (colloquiaRouter's "can never be induced to emit a spend
// tool" case) plus a grep that lived in an item's verify block rather than in the repo. A runtime
// test can only observe the tools a scripted model happened to call; this guard reads the source
// and fails on the edit itself — the import, the reference, or the extra tool spec — which is the
// form the breach would actually take.
//
// Scope: ConciergeAgent.ts only. Every other module is free to import spend tools; that is what
// the dispatch path is for.

const AGENT = path.join(process.cwd(), 'src', 'allocutio', 'api', 'ConciergeAgent.ts')

/** The seven read-only discovery handlers, plus the `list_models` alias the executor documents. */
const READ_ONLY_TOOLS = new Set([
  'list_flows',
  'describe_flow',
  'search_models',
  'list_models',
  'quote',
  'get_run',
  'list_runs',
  'status',
])

/** MCP tool wrappers that spend, write, or provision. Importing any of them into the agent puts it
 *  one call away from the thing the invariant forbids. */
const SPEND_TOOL_IMPORTS = [
  'runFlowTool',
  'provisionStudioTool',
  'collectTool',
  'saveFlowTool',
  'bindTool',
]

/** Direct CrystalApi spend/dispatch methods. `runFlow` is listed separately from `runFlowTool` so
 *  the word-boundary match catches a bare call as well as the wrapper. */
const SPEND_REFERENCES = ['invokeFlow', 'runFlow', 'provisionStudio', 'createRun']

/** Strip line and block comments so the module's own docblock — which NAMES these methods in order
 *  to forbid them — is not itself read as a breach. String literals are left in place: a tool name
 *  in a tool spec is a string, and that is exactly what this guard must see. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('ConciergeAgent imports no spend tool', () => {
  const code = stripComments(readFileSync(AGENT, 'utf8'))
  const offenders = SPEND_TOOL_IMPORTS.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
  assert.deepEqual(
    offenders,
    [],
    'ConciergeAgent must import only read-only MCP tool wrappers — it proposes, it never spends. ' +
      `Found: ${offenders.join(', ')}`,
  )
})

test('ConciergeAgent references no spend or dispatch method', () => {
  const code = stripComments(readFileSync(AGENT, 'utf8'))
  const offenders = SPEND_REFERENCES.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
  assert.deepEqual(
    offenders,
    [],
    'ConciergeAgent must not reference a spend/dispatch method; the user confirms (GO) separately, ' +
      `elsewhere. Found: ${offenders.join(', ')}`,
  )
})

test('ConciergeAgent registers no tool spec outside the read-only set', () => {
  const code = stripComments(readFileSync(AGENT, 'utf8'))

  // The tool specs the model is handed: the `name:` field of each entry in TOOL_SPECS.
  const specs = code.slice(code.indexOf('const TOOL_SPECS'), code.indexOf('export function buildSystemPrompt'))
  assert.ok(specs.length > 0, 'could not locate the TOOL_SPECS block in ConciergeAgent.ts')
  const declared = [...specs.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(declared.length > 0, 'TOOL_SPECS parsed to zero tool names — the guard has lost its anchor')
  assert.deepEqual(
    declared.filter((n) => !READ_ONLY_TOOLS.has(n)),
    [],
    `TOOL_SPECS may only declare read-only discovery tools. Declared: ${declared.join(', ')}`,
  )

  // The executor the tool calls dispatch through: every `case '<tool>':` label in executeTool.
  const executor = code.slice(code.indexOf('async function executeTool'), code.indexOf('interface UsageAcc'))
  assert.ok(executor.length > 0, 'could not locate executeTool in ConciergeAgent.ts')
  const cases = [...executor.matchAll(/case\s+'([a-z_]+)':/g)].map((m) => m[1])
  assert.ok(cases.length > 0, 'executeTool parsed to zero case labels — the guard has lost its anchor')
  assert.deepEqual(
    cases.filter((n) => !READ_ONLY_TOOLS.has(n)),
    [],
    `executeTool may only dispatch read-only discovery tools. Cases: ${cases.join(', ')}`,
  )
})
