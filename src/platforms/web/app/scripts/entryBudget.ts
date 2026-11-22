// Shared by scripts/check-entry-budget.ts (the build-time gate) and
// src/entryBudget.test.ts (the vitest-visible version of the same check).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BUDGET_BYTES = 350_000;

export function kb(bytes: number): string {
  return (bytes / 1000).toFixed(1);
}

export interface EntryStats {
  file: string;
  bytes: number;
}

// Reads dist/index.html for the entry <script type="module"> tag and stats that file —
// the one chunk a visitor's browser must download and run before React can render anything,
// Landing included. Throws if `npm run build` (vite build, specifically) hasn't produced a
// dist/ yet.
export function getEntryStats(distDir: string): EntryStats {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const match = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/);
  if (!match) {
    throw new Error(`no <script type="module"> entry tag found in ${join(distDir, 'index.html')}`);
  }
  const file = match[1];
  const bytes = statSync(join(distDir, 'assets', file)).size;
  return { file, bytes };
}
