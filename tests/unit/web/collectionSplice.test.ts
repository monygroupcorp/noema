import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  axisSplice,
  spliceMechanismLine,
  SPLICE_WHEN,
} from '../../../src/platforms/web/app/src/lib/collections.js'

// =============================================================================
// The in-flow guidance is DERIVED from the trait→piece path, not written from memory.
// =============================================================================
//
// These pin it to the five routes a winning value can actually take, as
// `TraitMixer.selectForPiece` and `CollectioCursor`'s dispatch implement them:
//
//   port-only     join mode, and no value carries a promptFragment — the axis sets
//                 aditus[porta] and prompt assembly never sees it.
//   prompt-append join mode: fragments are pushed onto [basePrompt, ...] and joined.
//   prompt-token  token mode: a basePrompt containing `{{porta}}` has that token
//                 replaced in place (by promptFragment ?? label ?? value), not appended.
//   token-missing token mode, no `{{porta}}`. The mode is chosen for the prompt as a
//                 WHOLE — `basePrompt.includes('{{')` — so an axis with a fragment and
//                 no token of its own is NOT appended as a fallback. It contributes
//                 nothing. This is the rule a from-memory description gets wrong.
//   whole-prompt  an axis on the `prompt` port — CollectioCursor takes
//                 `selectedAditus.prompt ?? selection.prompt`, so the mixer's value
//                 for that port beats the assembled prompt outright.
//
// If any of those rules changes, one of these fails — which is the point of deriving
// the copy rather than describing it.
// =============================================================================

const valor = (value: string, promptFragment?: string) =>
  promptFragment !== undefined ? { value, promptFragment } : { value }

const axis = (porta: string, valores: Array<{ value: string; promptFragment?: string }>) =>
  ({ porta, valores })

// ── Route 1: the port, and only the port ─────────────────────────────────────

test('an axis whose values carry no prompt fragment is named as port-only', () => {
  const s = axisSplice(axis('seed', [valor('1'), valor('2')]), 'a lighthouse at dusk')
  assert.equal(s.route, 'port-only')
  assert.match(s.line, /seed/, 'the line names the port it is talking about')
  assert.match(s.line, /[Nn]othing from this axis reaches the prompt/)
})

test('port-only holds when the collection has no base prompt at all', () => {
  assert.equal(axisSplice(axis('seed', [valor('1')])).route, 'port-only')
})

// ── Route 2: appended to the base prompt ─────────────────────────────────────

test('a fragment-carrying axis with no matching token is named as appended', () => {
  const s = axisSplice(axis('style', [valor('a', 'in ink'), valor('b', 'in oil')]), 'a lighthouse')
  assert.equal(s.route, 'prompt-append')
  assert.match(s.line, /style/)
  assert.match(s.line, /added to the end of the base prompt/)
})

// ── The asymmetry: token mode is chosen for the whole prompt ─────────────────

test('a fragment-carrying axis with no token of its own reaches the prompt not at all', () => {
  // `{{mood}}` puts assembly in token mode for the WHOLE prompt. `style`'s fragment is not
  // appended as a fallback — the join branch never runs. Calling this "appended" would send
  // the author looking for text that is never there.
  const s = axisSplice(axis('style', [valor('a', 'in ink')]), 'a lighthouse, {{mood}}')
  assert.equal(s.route, 'token-missing')
  assert.match(s.line, /nothing from this axis reaches the prompt/i)
  assert.match(s.line, /\{\{style\}\}/, 'and it says what to add to fix it')
})

test('the same axis IS appended once the base prompt carries no token at all', () => {
  // The only difference between this and the case above is the `{{mood}}` in the base
  // prompt — which is the whole point: the mode is a property of the prompt, not the axis.
  const s = axisSplice(axis('style', [valor('a', 'in ink')]), 'a lighthouse')
  assert.equal(s.route, 'prompt-append')
})

test('an axis where only some values carry a fragment says so, rather than overclaiming', () => {
  const all = axisSplice(axis('style', [valor('a', 'in ink'), valor('b', 'in oil')]), 'x')
  const some = axisSplice(axis('style', [valor('a', 'in ink'), valor('b')]), 'x')
  assert.equal(some.route, 'prompt-append')
  assert.notEqual(some.line, all.line, 'a partially-fragmented axis is not described as a full one')
  assert.match(some.line, /[Ww]here the chosen value has a prompt fragment/)
})

// ── Route 3: replaced in place ───────────────────────────────────────────────

test('a base prompt carrying this axis’s token is named as replacement, and shows the token', () => {
  const s = axisSplice(axis('style', [valor('a', 'in ink')]), 'a lighthouse, {{style}}, at dusk')
  assert.equal(s.route, 'prompt-token')
  assert.match(s.line, /\{\{style\}\}/, 'the author is shown the exact token to look for')
  assert.doesNotMatch(s.line, /added to the end of the base prompt/, 'a replaced token is not also appended')
})

test('token mode is recognised for an axis whose values carry no fragment', () => {
  // The mixer falls back to `label ?? String(value)` for the replacement, so the token
  // is still replaced — the append reading would be wrong here.
  assert.equal(axisSplice(axis('style', [valor('a')]), '{{style}}').route, 'prompt-token')
})

// ── Route 4: the whole prompt ────────────────────────────────────────────────

test('an axis on the prompt port is named as replacing the whole prompt', () => {
  const s = axisSplice(axis('prompt', [valor('a lone lighthouse'), valor('a neon street')]), 'ignored')
  assert.equal(s.route, 'whole-prompt')
  assert.match(s.line, /entire prompt|whole prompt/)
})

test('the prompt port wins even when the base prompt carries its token', () => {
  // CollectioCursor takes `selectedAditus.prompt` over `selection.prompt`, so the
  // token-replaced assembly is discarded. Describing this as token mode would be a lie.
  assert.equal(axisSplice(axis('prompt', [valor('a lighthouse')]), 'x {{prompt}} y').route, 'whole-prompt')
})

// ── The run screen's account of the whole grid ───────────────────────────────

test('the mechanism line always says when the draw happens and that it is reproducible', () => {
  for (const t of [undefined, [], [axis('style', [valor('a', 'in ink')])]]) {
    assert.ok(spliceMechanismLine(t, 'x').includes(SPLICE_WHEN), 'the timing sentence is never dropped')
  }
  assert.match(SPLICE_WHEN, /same grid always produces the same collection/)
})

test('the mechanism line names every port the run varies', () => {
  const line = spliceMechanismLine(
    [axis('style', [valor('a', 'in ink')]), axis('mood', [valor('b', 'sombre')]), axis('seed', [valor('1')])],
    'a lighthouse',
  )
  for (const port of ['style', 'mood', 'seed']) assert.match(line, new RegExp(port))
  assert.match(line, /inputs/, 'three ports are pluralised')
})

test('the mechanism line reports the strongest route present, not an average of them', () => {
  const appendOnly = spliceMechanismLine([axis('style', [valor('a', 'in ink')])], 'a lighthouse')
  const withToken = spliceMechanismLine(
    [axis('mood', [valor('b', 'sombre')])],
    'a lighthouse, {{mood}}',
  )
  // One axis has its token, one does not — the grid where the asymmetry actually bites.
  const mixed = spliceMechanismLine(
    [axis('style', [valor('a', 'in ink')]), axis('mood', [valor('b', 'sombre')])],
    'a lighthouse, {{mood}}',
  )
  const withPromptAxis = spliceMechanismLine([axis('prompt', [valor('a lighthouse')])], undefined)
  const portsOnly = spliceMechanismLine([axis('seed', [valor('1')])], 'a lighthouse')

  assert.match(appendOnly, /in axis order/)
  assert.match(withToken, /\{\{token\}\}/)
  assert.match(mixed, /reaches the prompt not at all/, 'the mixed grid warns about the token-less axis')
  assert.match(withPromptAxis, /supplies the whole prompt/)
  assert.match(portsOnly, /the base prompt as written/)
})

test('a collection with one axis is not described in the plural', () => {
  const line = spliceMechanismLine([axis('style', [valor('a', 'in ink')])], 'a lighthouse')
  assert.match(line, /style input\./, 'one port, singular')
})
