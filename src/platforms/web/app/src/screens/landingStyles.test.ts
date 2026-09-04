import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The landing page namespaces every class it introduces under `lp-`, because the names it wants
// (.anon, .stage, .deck, .cat, .how, .pay) already exist in app.css and in the shared landing.css
// that Doc, Pricing and Ceremony import. That namespace was applied once by hand across ten
// stylesheets and ten components, and it went wrong in a way nothing caught: the components
// renamed `cat-in` to `lp-cat-in` while the stylesheet kept `.cat-in`, so an entire block
// rendered unstyled — bullet points, no grid, text against the window edge — and shipped.
//
// Typecheck cannot see a class name and neither can a unit test of behaviour. This is the check
// that would have caught it: every `lp-` class a component asks for must be a class some
// stylesheet defines.

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE);
const read = (f: string) => readFileSync(join(HERE, f), 'utf8');

/** Structural elements that carry a class for querying and readability but need no rule. */
const UNSTYLED_BY_DESIGN = new Set(['lp-cand-foot-brand', 'lp-cand-foot-col', 'lp-cand-kicker']);

function classesUsedInComponents(): Set<string> {
  const used = new Set<string>();
  for (const f of files.filter((n) => n.endsWith('.tsx'))) {
    const src = read(f);
    for (const m of src.matchAll(/className=\{?["'`]([^"'`]*)["'`]/g)) {
      for (const tok of m[1].split(/\s+/)) {
        if (tok.startsWith('lp-') && !tok.includes('${')) used.add(tok);
      }
    }
    for (const m of src.matchAll(/['"`](lp-[a-z0-9-]+)['"`]/g)) used.add(m[1]);
  }
  return used;
}

function classesDefinedInStylesheets(): Set<string> {
  const defined = new Set<string>();
  for (const f of files.filter((n) => n.endsWith('.css'))) {
    for (const m of read(f).matchAll(/\.([a-z][a-z0-9-]*)/g)) defined.add(m[1]);
  }
  return defined;
}

describe('landing page styling', () => {
  // Known blind spot, checked rather than assumed: this catches a class no stylesheet mentions.
  // It does NOT catch a class whose main block breaks while some other stylesheet still names it
  // — `lp-cat-brag` is styled in landing-catalog.css and also referenced in landing-page.css, so
  // breaking the first alone still leaves it "defined". Verified both ways: breaking
  // `lp-cat-bars`, which only one stylesheet names, fails this test; breaking `lp-cat-brag` does
  // not. A stronger check would have to render, which is the walk harness's job, not a unit
  // test's.
  it('defines a rule for every namespaced class its components ask for', () => {
    const used = classesUsedInComponents();
    const defined = classesDefinedInStylesheets();
    expect(used.size).toBeGreaterThan(40); // the scan found the components at all
    const orphans = [...used].filter((c) => !defined.has(c) && !UNSTYLED_BY_DESIGN.has(c)).sort();
    expect(orphans).toEqual([]);
  });

  it('namespaces every top-level selector, so no rule reaches the rest of the app', () => {
    const LANDING_CSS = [
      'landing-page.css', 'landing-catalog.css', 'landing-modes.css', 'landing-plate.css',
      'landing-pricing.css',
      'landing-open.css', 'plate-deck.css', 'scroll-stage.css', 'beat-run.css',
      'landing-wordmark.css',
    ];
    const leaked: string[] = [];
    for (const f of LANDING_CSS) {
      if (!files.includes(f)) continue;
      for (const m of read(f).matchAll(/^\.([a-z][a-z0-9-]*)/gm)) {
        if (!m[1].startsWith('lp')) leaked.push(`${f}: .${m[1]}`);
      }
    }
    expect(leaked).toEqual([]);
  });
});
