import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyFilters, CatalogFilters, distinctVerbs, sortFlows, toUI } from './Catalog';
import type { FlowSummary } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the filter's pure logic, and the control row as static markup
// (react-dom/server), rather than a live DOM render.

const FLOWS: FlowSummary[] = [
  { id: 'flux-schnell', nomen: 'FLUX Schnell — text to image', versio: '1', categoria: 'image', modusGenus: 'make' },
  { id: 'flux-i2i', nomen: 'FLUX i2i — image to image', versio: '1', categoria: 'image', modusGenus: 'effect' },
  { id: 'rmbg', nomen: 'Remove Background', versio: '1', categoria: 'image', modusGenus: 'enhance' },
  { id: 'upscale', nomen: 'Upscale', versio: '1', categoria: 'image', modusGenus: 'enhance' },
];

describe('distinctVerbs', () => {
  it('derives the chip set from the fetched flow list, no hardcoded allowlist', () => {
    expect(distinctVerbs(FLOWS.map(toUI))).toEqual(['effect', 'enhance', 'make']);
  });
});

describe('applyFilters — verb axis', () => {
  const ui = FLOWS.map(toUI);

  it('separates flux-schnell (make) and flux-i2i (effect) even though both are categoria "image"', () => {
    const make = applyFilters(ui, '', 'All', 'make').map((f) => f.id);
    const effect = applyFilters(ui, '', 'All', 'effect').map((f) => f.id);
    expect(make).toEqual(['flux-schnell']);
    expect(effect).toEqual(['flux-i2i']);
    expect(make).not.toContain('flux-i2i');
    expect(effect).not.toContain('flux-schnell');
  });

  it('groups rmbg/upscale under their own "enhance" chip rather than hiding or merging them', () => {
    const enhance = applyFilters(ui, '', 'All', 'enhance').map((f) => f.id).sort();
    expect(enhance).toEqual(['rmbg', 'upscale']);
  });

  it('"All" clears the verb filter, leaving only the media/search filters in effect', () => {
    expect(applyFilters(ui, '', 'All', 'All')).toHaveLength(4);
  });

  it('composes with the modality facet (both narrow the same list)', () => {
    const result = applyFilters(ui, '', 'image', 'make');
    expect(result.map((f) => f.id)).toEqual(['flux-schnell']);
  });
});

describe('sortFlows', () => {
  const ui = FLOWS.map(toUI);

  it('"popular" keeps the order the registry served', () => {
    expect(sortFlows(ui, 'popular').map((f) => f.id)).toEqual(['flux-schnell', 'flux-i2i', 'rmbg', 'upscale']);
  });

  it('"name" orders alphabetically without touching the input', () => {
    expect(sortFlows(ui, 'name').map((f) => f.name)).toEqual(['FLUX i2i', 'FLUX Schnell', 'Remove Background', 'Upscale']);
    expect(ui.map((f) => f.id)).toEqual(['flux-schnell', 'flux-i2i', 'rmbg', 'upscale']);
  });
});

// DESIGN.md D-31 / D-56: the list is narrowed by ONE control row with ONE filtering model —
// never two parallel rows that each begin with their own "All".
describe('CatalogFilters — one control row', () => {
  const html = renderToStaticMarkup(
    createElement(CatalogFilters, {
      verbs: ['effect', 'enhance', 'make'],
      verb: 'All', onVerb: () => {},
      media: 'All', onMedia: () => {},
      sort: 'popular', onSort: () => {},
      shown: 3, total: 4,
    }),
  );

  it('renders a single chip row, with a single "All" chip', () => {
    expect(html.match(/class="cat-filters"/g)).toHaveLength(1);
    expect(html.match(/class="cat-chip[^"]*"[^>]*>All</g)).toHaveLength(1);
  });

  it('keeps modality as a facet inside the same control row, not a second chip row', () => {
    expect(html.match(/class="cat-toolbar[^"]*"/g)).toHaveLength(1);
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html).toContain('Any modality');
  });

  it('shows the sort value without opening the control', () => {
    expect(html).toMatch(/<option value="popular" selected="">Popular<\/option>/);
  });

  it('keeps the result count visible (REFERENCES.md REF-17)', () => {
    expect(html).toContain('3 of 4 models');
  });
});

// P-1a / D-9: the heading states the shape of the list and search follows it; the count is
// not accent-coloured, since it is not a control.
describe('the catalogue heading', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./Catalog.tsx', import.meta.url)), 'utf8');
  const CSS = readFileSync(fileURLToPath(new URL('../styles/app.css', import.meta.url)), 'utf8');
  it('carries no tagline between the heading and search', () => {
    expect(SOURCE).not.toContain('nothing proprietary, nothing locked');
  });
  it('does not paint the model count in the accent', () => {
    expect(CSS).not.toMatch(/\.corpus-big \.n\{[^}]*accent/);
    expect(SOURCE).not.toContain('<span className="n">{models');
  });
});
