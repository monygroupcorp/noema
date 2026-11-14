// The published flow-down terms for MiniMax H3. Its licence (Section V.2) requires us to bind every
// user to terms "at least as protective as" its Section V and Exhibit A, and (III.1) to give every
// user a copy of the agreement. This pins the published text, not a summary of it:
//   - Section 11 of /legal/terms carries every Exhibit A restriction, the no-training clause (V.3),
//     the territory clause (V.4), and the reporting and suspension promise (V.5);
//   - the licence itself is published at the page the terms link to;
//   - the anchor a `terms.required` refusal points users at is the anchor the page renders;
//   - the reference copy under docs/legal matches the published page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { USE_TERMS } from '../../../src/crystal/useTerms.js'

const WEB = 'src/platforms/web/app/src'
const terms = readFileSync(`${WEB}/content/terms.md`, 'utf8')
const license = readFileSync(`${WEB}/content/minimax-h3-license.md`, 'utf8')
const H3 = USE_TERMS['minimax-h3']

/** The slug rule Doc.tsx gives an h2 (its `slugOf`), so an href can be checked against a heading. */
const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const flat = (s: string) => s.replace(/\s+/g, ' ')

function section11(): string {
  const start = terms.indexOf('\n## 11.')
  assert.ok(start >= 0, 'the terms have a Section 11')
  const rest = terms.slice(start + 1)
  const next = rest.indexOf('\n## ', 3)
  return next < 0 ? rest : rest.slice(0, next)
}

function exhibitA(): string[] {
  const at = license.indexOf('## Exhibit A')
  assert.ok(at >= 0, 'the published licence carries Exhibit A')
  return license.slice(at).split('\n').filter(l => /^\d+\\?\.\s/.test(l))
}

test('the terms.required anchor is the Section 11 heading the page renders', () => {
  const heading = section11().split('\n')[0].replace(/^##\s+/, '')
  assert.equal(H3.href, `/legal/terms#${slugOf(heading)}`)
  assert.equal(H3.licenseHref, '/legal/minimax-h3-license')
})

test('Section 11 carries every Exhibit A restriction', () => {
  const s = flat(section11())
  const items = [...s.matchAll(/\s(\d+)\. /g)].map(m => Number(m[1]))
  const upstream = exhibitA()
  assert.equal(upstream.length, 20, 'Exhibit A lists twenty uses')
  for (let n = 1; n <= upstream.length; n++) assert.ok(items.includes(n), `11.2 has item ${n}`)
  // The restrictions that carry the most weight, by their own words.
  for (const phrase of [
    'exploits or harms, or intends to exploit or harm, minors',
    'influencing elections',
    'impersonate another person',
    'without clearly and prominently disclosing that it is machine-generated',
    'violent extremism or terrorism',
    'for military purposes',
    'high-risk automated decisions',
    'circumvent or bypass any safety guardrail',
    'social, ethical or moral standards of other countries or regions',
  ]) assert.ok(s.includes(phrase), `11.2 says: ${phrase}`)
})

test('Section 11 carries no-training, territory, acceptance, reporting and suspension', () => {
  const s = flat(section11())
  assert.match(s, /improve any other artificial-intelligence model/)                 // V.3
  assert.match(s, /European Union, the United Kingdom or the Republic of Korea/)    // V.4
  assert.match(s, /must accept this section before your first MiniMax H3 run/)       // V.2
  assert.match(s, /Report this output/)                                              // V.5
  assert.match(s, /two confirmed violations is suspended from MiniMax H3 flows/)     // V.5
  assert.ok(s.includes('](/legal/minimax-h3-license)'), 'links the licence itself')   // III.1
  assert.ok(s.includes(`${H3.strikeLimit === 2 ? 'two' : String(H3.strikeLimit)} confirmed violations`),
    'the published strike limit is the one the run gate enforces')
})

test('the MiniMax licence is published in full, with the clauses we flow down', () => {
  const s = flat(license)
  assert.match(s, /MiniMax H3 Community License Agreement/)
  assert.match(s, /bind each recipient or user to enforceable terms at least as protective as the use restrictions in this Section V and Exhibit A/)
  assert.match(s, /suspending or terminating repeat violators where appropriate/)
  assert.match(s, /Excluded Territories” means the European Union, the United Kingdom, the Republic of Korea and the United States of America/)
})

test('the licence page is routed', () => {
  const app = readFileSync(`${WEB}/App.tsx`, 'utf8')
  assert.match(app, /path="\/legal\/minimax-h3-license" element={<Doc md={minimaxH3LicenseMd} \/>}/)
})

test('the reference copy matches the published terms', () => {
  const ref = readFileSync('docs/legal/terms-and-conditions.md', 'utf8').split('\n').slice(3).join('\n')
  assert.equal(ref, terms)
})
