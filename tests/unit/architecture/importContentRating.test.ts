import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// An imported model's content rating must stay DERIVED from the origin's own flag (noema-188).
// Two edits would quietly undo that, and neither breaks a behavioural test on its own:
//   1. re-inlining a constant rating into the Intella literal, and
//   2. reading the origin's numeric level as a "richer" signal.
// This guard reads the importer's source and refuses both.
//
// Exclusions, if one is ever genuinely needed, go in an ALLOWLIST array with a written reason —
// the pattern tests/unit/architecture/testEnrolment.test.ts uses.

const IMPORTER = 'src/crystal/ModelImporter.ts'

/** The origin's numeric level, as the resolver stores it on `origin.meta`. Captured, never read. */
const LEVEL_FIELD = 'originNsfwLevel'

// A `contentRating:` property assignment, capturing its right-hand side up to the line end.
const ASSIGNMENT = /contentRating:\s*([^,\n]*)/g

function importerSource(): string {
  return readFileSync(path.join(process.cwd(), IMPORTER), 'utf8')
}

test(`${IMPORTER}: the content rating is derived, never a constant`, () => {
  const src = importerSource()
  const assignments = [...src.matchAll(ASSIGNMENT)].map(m => m[1].trim())

  assert.equal(
    assignments.length,
    1,
    `noema-188: expected exactly one \`contentRating:\` assignment in ${IMPORTER}, found ` +
      `${assignments.length}: ${assignments.join(' | ')}. Every import's rating comes from the ` +
      `single derived value; add a branch to deriveImportContentRating rather than a second ` +
      `assignment.`,
  )

  const [rhs] = assignments
  assert.ok(
    !/^['"`]/.test(rhs),
    `noema-188: ${IMPORTER} assigns a constant content rating (\`${rhs}\`). An import's rating is ` +
      `derived from the origin's own flag by deriveImportContentRating — extend that function's ` +
      `table instead of inlining a literal.`,
  )
})

test(`${IMPORTER}: the origin's numeric nsfw level is never read`, () => {
  const src = importerSource()

  assert.ok(
    !src.includes(LEVEL_FIELD),
    `noema-188: ${IMPORTER} reads the origin's numeric nsfw level. That number is an aggregate ` +
      `bitmask over the community images posted to a model's gallery, not a statement about the ` +
      `model: DreamShaper reads 15 and Juggernaut XL 31 while both carry the boolean flag false. ` +
      `Thresholding it would rate the most mainstream checkpoints in existence as adult and hide ` +
      `them from the catalog. The level stays captured raw in origin.meta and unread; derive from ` +
      `the boolean only.`,
  )
})

test(`${IMPORTER}: the derivation seam stays exported and testable`, () => {
  const src = importerSource()

  assert.ok(
    src.includes('export function deriveImportContentRating'),
    `noema-188: ${IMPORTER} no longer exports deriveImportContentRating. The derivation is a named, ` +
      `exported, pure function so it can be unit-tested branch by branch — do not inline it into ` +
      `the Intella literal.`,
  )
})
