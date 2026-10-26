import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SECTIONS, SectionPane, resolveSection } from './accountSections';

// Every section the settings nav lists must land somewhere real: a pane with content of its
// own, or a redirect to a route the app actually mounts. A "building this later" box is not
// content (D-63), so the pane render is checked for placeholder language too.

const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
const mounted = (path: string) => appSource.includes(`path="${path}"`);

const PLACEHOLDER = /coming soon|later pass|building this|not wired|placeholder/i;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const renderPane = (key: string, studios: Parameters<typeof SectionPane>[0]['studios'] = []) => {
  const route = resolveSection(key);
  if (route.kind !== 'pane') throw new Error(`${key} is not a pane`);
  return renderToStaticMarkup(
    <MemoryRouter>
      <SectionPane section={route.section} studios={studios} initialAvailability="balanced" />
    </MemoryRouter>,
  );
};

describe('account sections', () => {
  it('lists each nav section once, under a key its route can address', () => {
    const keys = SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+$/);
  });

  for (const s of SECTIONS) {
    it(`${s.label} renders content or redirects to a mounted route`, () => {
      const route = resolveSection(s.key);
      expect(route.kind).not.toBe('home');
      if (route.kind === 'redirect') {
        expect(route.to).toBe(s.to);
        expect(mounted(route.to), `${route.to} is not a route in App.tsx`).toBe(true);
        return;
      }
      const body = text(renderPane(s.key));
      expect(body.length).toBeGreaterThan(40);
      expect(body).toContain(s.label);
      expect(body).not.toMatch(PLACEHOLDER);
    });
  }

  it('renders the compute pane with its availability choice and session list', () => {
    const html = renderPane('compute', [
      { studioId: 'st-1', label: 'studio one', status: 'running', guestsToday: 3, netUsd: 1.5, warmRemainingMs: 120000 } as never,
    ]);
    expect(html).toContain('aria-pressed="true"');
    expect(text(html)).toContain('studio one');
    expect(text(html)).toContain('~2m left');
  });

  it('sends an unlisted section back to the account home instead of showing another section', () => {
    expect(resolveSection('profile')).toEqual({ kind: 'redirect', to: '/account' });
    expect(resolveSection('api')).toEqual({ kind: 'redirect', to: '/account' });
    expect(resolveSection(undefined)).toEqual({ kind: 'home' });
  });
});
