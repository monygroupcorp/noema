import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The marketing pages are markdown rendered by <Doc/>, so every link in them is a plain anchor
// the router never sees until the page has already navigated. A link to a path with no route
// therefore lands a visitor on the 404 stub, silently — no build error, no failing test, nothing
// in the console. `/features` shipped `[API docs →](/docs)` that way, an invitation to read the
// API that answered "Not found", and it survived several passes over that copy.
//
// Nothing else checks this: the routes live in App.tsx and the links live in markdown, and no
// type connects them. So this walks both and insists every internal link resolves — either to a
// declared route or to one of the server paths below, which the SPA fallback never reaches
// because Express registers them first.
//
// The walk is RECURSIVE because the guides live a directory down, in `content/blog/`. A flat
// read of `content/` covered the six top-level pages and silently skipped every guide — the
// exact blind spot this file exists to close, reopened by a folder.

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(HERE, '..', 'content');
const APP = join(HERE, '..', 'App.tsx');

/** Paths served by the API, not by the router. Each must be a real registered route. */
const SERVER_PATHS = new Set(['/v1/openapi.json', '/v1/flows', '/v1/mcp']);

function declaredRoutes(): Set<string> {
  const src = readFileSync(APP, 'utf8');
  const routes = new Set<string>();
  for (const m of src.matchAll(/<Route\s+path="([^"]+)"/g)) routes.add(m[1]);
  return routes;
}

/** Every markdown file under `dir`, at any depth, as paths relative to `dir`. */
function markdownUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? markdownUnder(join(dir, e.name), join(prefix, e.name))
      : e.name.endsWith('.md')
        ? [join(prefix, e.name)]
        : []
  );
}

/** True when `link` is matched by a declared route pattern, `:param` segments included. */
function resolves(link: string, routes: Set<string>): boolean {
  if (SERVER_PATHS.has(link)) return true;
  const parts = link.split('/').filter(Boolean);
  for (const route of routes) {
    if (route === '*') continue; // the 404 stub matches everything and proves nothing
    const rp = route.split('/').filter(Boolean);
    if (rp.length !== parts.length) continue;
    if (rp.every((seg, i) => seg.startsWith(':') || seg === parts[i])) return true;
  }
  return false;
}

describe('links in published marketing copy', () => {
  const routes = declaredRoutes();

  it('finds the routes declared in App.tsx', () => {
    expect(routes.size).toBeGreaterThan(20);
    expect(routes.has('/features')).toBe(true);
  });

  // A file this walk misses is a file whose links nothing checks, and it fails silently — the
  // suite still passes, just over less. So assert the reach, not only the result.
  it('reaches the guides, which are a directory down', () => {
    const found = markdownUnder(CONTENT);
    expect(found).toContain(join('blog', 'train-a-model.md'));
    expect(found.filter((f) => f.startsWith(`blog${sep}`)).length).toBeGreaterThan(0);
  });

  for (const file of markdownUnder(CONTENT)) {
    it(`${file} links only to paths that exist`, () => {
      const md = readFileSync(join(CONTENT, file), 'utf8');
      const links = [...md.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
      const dead = links.filter((l) => !resolves(l.split(/[?#]/)[0], routes));
      expect(dead, `dead internal links in ${file}`).toEqual([]);
    });
  }
});
