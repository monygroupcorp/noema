// walk/routes.ts — the route census: DERIVED from source, not hand-maintained.
//
// Reads `src/App.tsx`'s router table at run time and emits one row per route. This is the
// input every other instrument (screenshots, axe, future LLM-critique passes) rides — a route
// that exists in the app but is missing here is invisible to all of them, so the extraction
// re-parses the real route table on every run rather than caching a snapshot.
//
// Portability: the only App.tsx-specific code is `extractFromAppTsx` below. Porting this
// harness to another codebase means swapping that one function for an adapter that
// reads that codebase's router table — everything else (fixtures, CLI, the walker) is generic.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fixtures } from './walk.config.ts';

export interface RouteRow {
  /** The route path template exactly as written in source, e.g. "/datasets/:id". */
  path: string;
  /** Param names in declaration order, e.g. ["id"]. Empty for a static route. */
  params: string[];
  /** Heuristic — see PUBLIC_PATHS below. Not derived from a route-level source marker: the
   *  app has none (auth is enforced per-screen / server-side, and many screens work anon). */
  authRequired: boolean;
  /** `path` with every `:param` substituted from walk.config.ts — what the walker navigates to. */
  resolvedPath: string;
}

// --- adapter: App.tsx-specific extraction. Swap this one function to port the harness. -------
function extractFromAppTsx(source: string): { path: string; params: string[] }[] {
  const rows: { path: string; params: string[] }[] = [];
  const routeRe = /<Route\s+path="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(source))) {
    const path = m[1];
    if (path === '*') continue; // catch-all 404 — not a real page to walk
    const params = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((p) => p[1]);
    rows.push({ path, params });
  }
  return rows;
}
// -----------------------------------------------------------------------------------------------

// Public (no-session-required) surface, by structural reading of App.tsx: the marketing
// Landing/Doc/Pricing pages and the sign-in door itself. HEURISTIC, not a route-level marker —
// update this set if a route's public/auth posture changes.
const PUBLIC_PATHS = new Set<string>([
  '/', '/about', '/features', '/pricing', '/blog',
  '/legal/privacy', '/legal/cookies', '/legal/terms',
  '/landing', '/onboard',
]);

function appTsxPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../src/App.tsx');
}

function resolvePath(path: string, params: string[]): string {
  let out = path;
  for (const p of params) {
    const fx = fixtures[path]?.[p];
    if (fx === undefined) {
      throw new Error(
        `walk/routes.ts: route "${path}" has param ":${p}" with no fixture in walk/walk.config.ts. ` +
        `Add one there — the census fails loudly instead of silently dropping the route.`,
      );
    }
    out = out.replace(`:${p}`, fx);
  }
  return out;
}

export function census(): RouteRow[] {
  const source = readFileSync(appTsxPath(), 'utf8');
  return extractFromAppTsx(source).map(({ path, params }) => ({
    path,
    params,
    authRequired: !PUBLIC_PATHS.has(path),
    resolvedPath: params.length ? resolvePath(path, params) : path,
  }));
}

// CLI: `npx tsx walk/routes.ts` prints the census. Static — no server, no network.
const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const rows = census();
  console.log(`${rows.length} routes`);
  for (const r of rows) {
    const tag = r.authRequired ? 'auth' : 'pub ';
    const paramTag = r.params.length ? `  [${r.params.join(',')}]` : '';
    console.log(`  ${tag}  ${r.path}${paramTag}`);
  }
}
