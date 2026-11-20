import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUDGET_BYTES, getEntryStats, kb } from '../scripts/entryBudget';

// landing-load-budget: a stranger opening "/" or "/pricing" downloads the entry chunk and
// nothing else — every other screen is lazy-loaded (see App.tsx). This holds that chunk to
// a byte budget so a future eager import doesn't silently regress it back to shipping the
// whole app on first paint.
//
// `npm run build` already fails on a budget breach on its own (scripts/check-entry-budget.ts
// runs as its last step) — that's the hard gate. This test is the same check surfaced to
// `npm test`/vitest for a developer who already has a dist/ around; `npm test` alone doesn't
// build one (vite build takes a few seconds and plenty of test runs don't want it), so this
// skips rather than fails when there's no dist/ to read yet.
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

describe('entry chunk budget', () => {
  it.skipIf(!existsSync(distDir))(`stays under ${kb(BUDGET_BYTES)} kB (run "npm run build" first if this skipped)`, () => {
    const { file, bytes } = getEntryStats(distDir);
    expect(bytes, `entry chunk assets/${file} is ${bytes} bytes (${kb(bytes)} kB), over the ${kb(BUDGET_BYTES)} kB budget`)
      .toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
