import { describe, expect, it } from 'vitest';
import { applyFilters, distinctVerbs, toUI } from './Catalog';
import type { FlowSummary } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the verb-chip filter's pure logic rather than a full DOM render.

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

  it('composes with the modality filter (both axes narrow the same list)', () => {
    const result = applyFilters(ui, '', 'image', 'make');
    expect(result.map((f) => f.id)).toEqual(['flux-schnell']);
  });
});
