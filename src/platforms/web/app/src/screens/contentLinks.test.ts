import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// The same hole exists one step over, and it is wider: the landing page, the site footer, the
// pricing page and the ceremony page write their links as `<Link to="/…">` in TSX. React Router
// does not validate a `to` against the route table either — an unrouted path renders as a normal
// link and lands the visitor on the 404 stub. The landing page alone carries sixteen of them in a
// footer nobody re-reads. So the walk below covers both surfaces: markdown by file, and every
// literal `to=` / `href=` path in the screens.

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

  for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.md'))) {
    it(`${file} links only to paths that exist`, () => {
      const md = readFileSync(join(CONTENT, file), 'utf8');
      const links = [...md.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
      const dead = links.filter((l) => !resolves(l.split(/[?#]/)[0], routes));
      expect(dead, `dead internal links in ${file}`).toEqual([]);
    });
  }

  // Every screen, not a hand-kept list of the marketing ones: a list is a second place the truth
  // lives, and it goes stale the first time a page is added. Only literal paths are read — a
  // template or a variable is skipped rather than guessed at.
  for (const file of readdirSync(HERE).filter((f) => f.endsWith('.tsx'))) {
    it(`${file} links only to paths that exist`, () => {
      const src = readFileSync(join(HERE, file), 'utf8');
      const links = [...src.matchAll(/\b(?:to|href)=["'](\/[^"'\s]*)["']/g)].map((m) => m[1]);
      const dead = links.filter((l) => !resolves(l.split(/[?#]/)[0], routes));
      expect(dead, `dead internal links in ${file}`).toEqual([]);
    });
  }
});
