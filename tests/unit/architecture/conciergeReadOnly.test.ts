import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { READ_ONLY_TOOL_NAMES } from '../../../src/allocutio/api/ConciergeAgent.js'

// The ConciergeAgent's first hard invariant is that it PROPOSES and never SPENDS: its whole tool
// surface is the read-only discovery handlers, and it never reaches a spend method. That
// invariant was held by a runtime test (colloquiaRouter's "can never be induced to emit a spend
// tool" case) plus a grep that lived in an item's verify block rather than in the repo. A runtime
// test can only observe the tools a scripted model happened to call; this guard reads the source
// and fails on the edit itself — the import, the reference, or the extra tool spec — which is the
// form the breach would actually take.
//
// Scope: ConciergeAgent.ts only, EXCEPT the last test below, which confirms a known downstream
// consumer (the gym) derives its own notion of "read-only" from ConciergeAgent's export instead
// of re-hardcoding a copy that can silently drift (noema-366). Every other module is free to
// import spend tools; that is what the dispatch path is for.

const AGENT = path.join(process.cwd(), 'src', 'allocutio', 'api', 'ConciergeAgent.ts')
const GYM = path.join(process.cwd(), 'scripts', 'concierge-gym.ts')

/** This guard's OWN confirmed allowlist — the twelve read-only discovery handlers, plus the
 *  `list_models` alias the executor documents. Deliberately NOT sourced from ConciergeAgent's
 *  export: the guard below cross-checks the export against this list so that a name ADDED to
 *  the export (a legitimate new tool, or a spend tool slipped into TOOL_SPECS) still requires a
 *  human to update this list before the guard goes green again — it never rubber-stamps the
 *  export it partly reads. */
const READ_ONLY_TOOLS = new Set([
  'list_flows',
  'describe_flow',
  'search_models',
  'list_models',
  'quote',
  'get_run',
  'list_runs',
  'status',
  'list_collections',
  'get_collection',
  'list_studios',
  'get_studio',
  'list_fundamenta',
  'list_datasets',
  'get_dataset',
  'list_activity',
  'list_muse_sessions',
  'get_muse_session',
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

  // Cross-check against ConciergeAgent's own exported canonical set (asserts against the SAME
  // export, not just this file's independent source-text parse). Equality, not subset: if
  // TOOL_SPECS gains ANY name — legitimate tool or a fake spend-named one — the export changes
  // and this list must be updated deliberately to match, or the guard stays red.
  assert.deepEqual(
    [...READ_ONLY_TOOL_NAMES].sort(),
    [...READ_ONLY_TOOLS].sort(),
    `ConciergeAgent's exported canonical read-only set no longer matches this guard's confirmed ` +
      `allowlist. Exported: ${[...READ_ONLY_TOOL_NAMES].sort().join(', ')} | Guard: ` +
      `${[...READ_ONLY_TOOLS].sort().join(', ')}`,
  )
})

test('concierge-gym derives its read-only tool set from the canonical export (no local copy)', () => {
  const code = stripComments(readFileSync(GYM, 'utf8'))
  assert.match(
    code,
    /import\s*\{[^}]*\bREAD_ONLY_TOOL_NAMES\b[^}]*\}\s*from\s*['"]\.\.\/src\/allocutio\/api\/ConciergeAgent\.js['"]/,
    'scripts/concierge-gym.ts must import READ_ONLY_TOOL_NAMES from ConciergeAgent rather than ' +
      'declaring its own read-only tool list — that is the exact copy that drifted (noema-366).',
  )
  assert.doesNotMatch(
    code,
    /new Set\(\s*\[\s*['"]list_flows['"]/,
    'scripts/concierge-gym.ts appears to hardcode a read-only tool list literal again instead of ' +
      'importing the canonical export.',
  )
})
