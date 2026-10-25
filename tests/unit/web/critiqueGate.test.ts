import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  designRules,
  referenceRows,
  discardReason,
  majorityMerge,
  sameFinding,
  type Admitted,
  type Finding,
  type GateContext,
} from '../../../src/platforms/web/app/walk/critique.ts'

// The Phase-2 critic (`src/platforms/web/app/walk/critique.ts`) stands between a multimodal model
// and rth. A multimodal critic reports issues it never observed, confidently and in the house
// format, and the only thing that catches an invented finding is a citation that can be checked:
// the shot it came from, a rule that exists, and what that rule says. This suite proves the gate
// discards exactly those findings and no others, and that the majority merge keeps what two of
// three independent passes saw and drops what one pass imagined.

const here = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(here, '../../../src/platforms/web/app')
const design = readFileSync(resolve(appDir, 'DESIGN.md'), 'utf8')
const references = readFileSync(resolve(appDir, 'REFERENCES.md'), 'utf8')

const rules = designRules(design)
const rows = referenceRows(references)
const designIds = new Set([...rules.keys()].filter(k => !k.startsWith('EX-')))

const catalog = rows.find(r => r.routes.includes('/catalog'))!
const ctx: GateContext = { shotKey: 'catalog/mobile.png', ref: catalog, designIds }

const good: Finding = {
  rule: 'D-56',
  shot: 'catalog/mobile.png',
  element: 'sort control',
  where: 'top',
  observed: 'The sort control reads "Sort" with no current value shown until it is opened.',
  convention: 'Sort is a single control, and its current value is visible without opening it.',
  severity: 'should',
}

test('the standards parse into the ids the gate checks against', () => {
  assert.ok(rules.has('D-1') && rules.has('P-1a') && rules.has('EX-1'), 'DESIGN.md rules, priorities and exceptions are indexed')
  assert.match(rules.get('D-20')!, /11px/, 'a rule carries its own text')
  assert.ok(rows.length > 30, `the map yields its rows (${rows.length})`)
  assert.equal(catalog.id, 'REF-17')
  assert.ok(rows.find(r => r.routes.includes('/vault'))?.unnamed, 'an unnamed row is read as unnamed')
  assert.ok(rows.find(r => r.id === 'REF-41')?.reference.includes('Stripe'), 'the outside-the-census row (§1.9) parses despite its shorter table')
})

test('a finding with shot, rule and the rule\'s words is admitted', () => {
  assert.equal(discardReason(good, ctx), null)
  assert.equal(discardReason({ ...good, rule: 'REF-17', convention: 'Civitai\'s browse keeps the result count visible beside the filters.' }, ctx), null)
  assert.equal(discardReason({ ...good, rule: 'p-2a' }, ctx), null, 'ids are matched case-insensitively')
})

test('a finding citing neither a shot nor a rule it can be checked against is discarded', () => {
  const reasons = [
    discardReason({ ...good, rule: '' }, ctx),
    discardReason({ ...good, rule: 'D-999' }, ctx),
    discardReason({ ...good, rule: 'Jakob\'s Law' }, ctx),
    discardReason({ ...good, shot: '' }, ctx),
    discardReason({ ...good, shot: 'catalog/desktop.png' }, ctx),
    discardReason({ ...good, shot: 'baseline/catalog/mobile.png' }, { ...ctx, shotKey: 'run/catalog/mobile.png' }),
    discardReason({ ...good, observed: 'bad' }, ctx),
    discardReason({ ...good, convention: '' }, ctx),
    discardReason({ ...good, severity: 'critical' as Finding['severity'] }, ctx),
  ]
  for (const r of reasons) assert.ok(r, 'each is discarded with a reason')
  assert.match(reasons[1]!, /DESIGN.md does not have/)
  assert.match(reasons[4]!, /not the shot of this run/)
})

test('a finding that re-files an adjudicated exception is discarded', () => {
  assert.match(discardReason({ ...good, rule: 'EX-7' }, ctx)!, /already adjudicated/)
})

test('a REF citation must be this screen\'s own row, and never an unnamed one', () => {
  assert.match(discardReason({ ...good, rule: 'REF-14' }, ctx)!, /not this screen's row/)
  const vault = rows.find(r => r.routes.includes('/vault'))!
  assert.match(discardReason({ ...good, rule: vault.id, shot: 'vault/mobile.png' }, { ...ctx, shotKey: 'vault/mobile.png', ref: vault })!, /deliberately names no reference/)
  assert.match(discardReason({ ...good, rule: 'REF-17', shot: 'x/mobile.png' }, { ...ctx, shotKey: 'x/mobile.png', ref: undefined })!, /no row in the map/)
})

test('two passes describing the same thing under the same rule are one finding', () => {
  const a: Finding = { ...good, element: 'Sort control', observed: 'Sort shows no current value.' }
  const b: Finding = { ...good, element: 'sort control', observed: 'The sort dropdown does not display which order is active.' }
  const c: Finding = { ...good, element: 'result count', observed: 'No count of models is shown beside the filters.' }
  assert.ok(sameFinding(a, b), 'same element name merges')
  assert.ok(!sameFinding(a, c), 'a different element under the same rule does not')
  assert.ok(!sameFinding(a, { ...b, rule: 'D-55' }), 'a different rule never merges')
})

test('the majority merge keeps what two of three passes saw and drops a single pass\'s opinion', () => {
  const admitted: Admitted[] = [
    { ...good, run: 1 },
    { ...good, run: 2, element: 'Sort control', severity: 'nit' },
    { ...good, run: 2, rule: 'D-55', element: 'list header', observed: 'The list does not say how many models it holds before the first card.' },
    { ...good, run: 3, rule: 'D-55', element: 'list header', observed: 'No model count precedes the grid.' },
    { ...good, run: 3, rule: 'D-20', element: 'badge text', observed: 'Badge text on the cards is visibly smaller than the 11px floor.', severity: 'blocking' },
  ]
  const { merged, minority } = majorityMerge(admitted, 3)
  assert.deepEqual(merged.map(f => [f.rule, f.runs, f.of]), [['D-56', [1, 2], 3], ['D-55', [2, 3], 3]])
  assert.equal(merged[0]!.severity, 'should', 'severity is the one most passes gave; a tie falls to the more severe bin')
  assert.deepEqual(minority.map(f => [f.rule, f.runs]), [['D-20', [3]]])
})

test('the majority is over the passes that returned, so a crashed pass cannot veto', () => {
  const admitted: Admitted[] = [{ ...good, run: 1 }, { ...good, run: 2, element: 'Sort control' }]
  assert.equal(majorityMerge(admitted, 2).merged.length, 1, '2 of 2 returned passes agree')
  assert.equal(majorityMerge([{ ...good, run: 1 }], 2).merged.length, 0, '1 of 2 is not a majority')
})
