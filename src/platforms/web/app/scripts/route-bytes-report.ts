#!/usr/bin/env tsx
// Prints the actual first-load JS+CSS byte cost of every top-level route, computed from
// Vite's build manifest (dist/.vite/manifest.json — enabled via build.manifest in
// vite.config.ts) rather than guessed from file names. Run after `npm run build`.
//
// For a route, "cost" = the entry chunk + its CSS (every route pays this; it's the shell
// main.tsx boots) plus, if the route is lazy-loaded, its own chunk + CSS + whatever shared
// chunks that chunk statically imports — de-duplicated, since the browser only fetches a
// given file once per page load.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

interface ManifestEntry {
  file: string;
  css?: string[];
  imports?: string[];
}
type Manifest = Record<string, ManifestEntry>;

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(appRoot, 'dist');
const manifest: Manifest = JSON.parse(readFileSync(join(distDir, '.vite', 'manifest.json'), 'utf8'));

function fileBytes(assetPath: string): number {
  return statSync(join(distDir, assetPath)).size;
}

// Collects every CSS/JS file a manifest entry needs synchronously (itself + its own css +
// every chunk reachable through "imports", recursively). Does NOT follow "dynamicImports" —
// those are routes reachable by further navigation, not part of this route's first load.
function collectFiles(key: string, seen: Set<string> = new Set()): Set<string> {
  const entry = manifest[key];
  if (!entry) return seen;
  if (entry.file && !seen.has(entry.file)) {
    seen.add(entry.file);
    for (const css of entry.css ?? []) seen.add(css);
    for (const dep of entry.imports ?? []) collectFiles(dep, seen);
  }
  return seen;
}

const entryFiles = collectFiles('index.html');
const entryBytes = [...entryFiles].reduce((sum, f) => sum + fileBytes(f), 0);

// path -> the manifest key for that route's lazy()-loaded module, or null when the route
// renders Landing directly (no extra chunk — it's part of the entry bundle).
const ROUTES: Array<[string, string | null]> = [
  ['/', null],
  ['/landing', null],
  ['/pricing', 'src/screens/Pricing.tsx'],
  ['/about', 'src/screens/Doc.tsx'],
  ['/features', 'src/screens/Doc.tsx'],
  ['/blog', 'src/screens/Blog.tsx'],
  ['/app', 'src/screens/Dashboard.tsx'],
  ['/chat', 'src/screens/Chat.tsx'],
  ['/canvas', 'src/screens/Canvas.tsx'],
  ['/space', 'src/screens/Space.tsx'],
  ['/vault', 'src/screens/Vault.tsx'],
  ['/ceremony', 'src/screens/Ceremony.tsx'],
];

const rows = ROUTES.map(([path, key]) => {
  const files = key ? collectFiles(key, new Set(entryFiles)) : entryFiles;
  const totalBytes = [...files].reduce((sum, f) => sum + fileBytes(f), 0);
  return { path, totalBytes };
});

const kb = (n: number) => (n / 1000).toFixed(1);
console.log('route\tbytes\tkB');
for (const r of rows) console.log(`${r.path}\t${r.totalBytes}\t${kb(r.totalBytes)}`);
console.log(`\n(entry shell alone: ${entryBytes} bytes / ${kb(entryBytes)} kB — every route above includes it)`);
