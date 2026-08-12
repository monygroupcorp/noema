import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// =============================================================================
// HARD SAFETY INVARIANT (load-bearing, and deliberately not softenable)
// =============================================================================
//
// `spicyMode` must NEVER be read by, entangle with, or weaken the CSAM/moderation
// gates. This test enforces that mechanically so no future refactor can silently
// cross the line: it reads each TRACKED moderation-gate source and asserts ZERO
// occurrences of `spicy` (case-insensitive) or `Generatio` in any of them.
//
// The adult toggle is a PREFERENCE (`Generatio.spicyMode`) that gates model
// *selection* and concierge model *routing* — always DOWNSTREAM of, and
// independent from, output moderation. A gate that referenced `spicyMode`/
// `Generatio` would be an entanglement; this is the tripwire.
//
// SCAN LIMITATION (stated per the item spec): only TRACKED files under `src/` are
// scannable. `CsamReviewReporter.ts` IS tracked at `src/crystal/` and is scanned
// here. The `src/private/` compliance layer is gitignored and ABSENT from every
// worktree (its tree does not exist), so it cannot be scanned — asserted below.
// =============================================================================

const GATE_FILES = [
  'src/crystal/PromptGuard.ts',
  'src/crystal/ModerationGate.ts',
  'src/crystal/SexualContentRouter.ts',
  'src/crystal/CsamReviewReporter.ts',
]

// Mirror the item's authoritative verify grep (`\bspicy|\bGeneratio\b`):
//  - `spicy` — case-INSENSITIVE, at a word start (catches spicyMode / Spicy / SPICY).
//  - `Generatio` — the preference TYPE/object — case-SENSITIVE whole-word, so it does NOT match the
//    unrelated word "generation" (a lowercase substring that would otherwise false-positive here).
const SPICY_RE = /\bspicy/gi
const GENERATIO_RE = /\bGeneratio\b/g

test('no moderation/CSAM gate references spicyMode or Generatio (hard safety invariant)', () => {
  const offenders: string[] = []
  for (const rel of GATE_FILES) {
    const abs = path.join(process.cwd(), rel)
    // Every listed gate must be present and tracked — a typo/rename that silently skipped a gate
    // would blind the tripwire, so a missing file is itself a failure.
    assert.ok(existsSync(abs), `expected tracked moderation gate to exist: ${rel}`)
    const src = readFileSync(abs, 'utf8')
    const matches = [...(src.match(SPICY_RE) ?? []), ...(src.match(GENERATIO_RE) ?? [])]
    if (matches.length) offenders.push(`${rel}: ${[...new Set(matches)].join(', ')}`)
  }
  assert.deepEqual(
    offenders,
    [],
    `A moderation/CSAM gate references spicyMode/Generatio — spicy must NEVER reach the moderation path. Offenders: ${offenders.join(' | ')}`,
  )
})

test('the gitignored src/private compliance layer is absent from the worktree (unscannable — stated limitation)', () => {
  // This documents (and pins) the scan boundary: `src/private/` is gitignored and does not exist in a
  // fresh worktree, so its contents cannot be verified here. The always-on, output-side, identity-blind
  // CSAM/moderation scan is what actually protects that boundary at runtime.
  assert.equal(existsSync(path.join(process.cwd(), 'src', 'private')), false)
})
