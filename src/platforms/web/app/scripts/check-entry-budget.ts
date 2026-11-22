#!/usr/bin/env tsx
// Fails `npm run build` (and so the hermetic web-app gate) when the entry chunk — the one
// script tag dist/index.html loads on first paint — grows past the landing-load-budget cap.
// A stranger opening "/" or "/pricing" downloads only this chunk plus its stylesheet; every
// route is otherwise lazy-loaded (see App.tsx), so this number is the true first-load cost.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUDGET_BYTES, getEntryStats, kb } from './entryBudget';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(appRoot, 'dist');

const { file, bytes } = getEntryStats(distDir);

if (bytes > BUDGET_BYTES) {
  console.error(
    `check-entry-budget: entry chunk assets/${file} is ${bytes} bytes (${kb(bytes)} kB), ` +
    `over the ${BUDGET_BYTES} byte (${kb(BUDGET_BYTES)} kB) budget by ${bytes - BUDGET_BYTES} bytes.\n` +
    'A route that used to be lazy-loaded was likely pulled back into App.tsx\'s eager import graph — ' +
    'check `git diff` on src/App.tsx, or run `npm run report:route-bytes` against dist/.vite/manifest.json to find the regression.'
  );
  process.exit(1);
}

console.log(`check-entry-budget: entry chunk assets/${file} is ${bytes} bytes (${kb(bytes)} kB), under the ${kb(BUDGET_BYTES)} kB budget.`);
