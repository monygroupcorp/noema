import { describe, expect, it } from 'vitest';
import { applyExampleFilters, distinctStyles, launchTarget, type ShowcaseExample } from './exampleGallery';

// No jsdom/@testing-library/react in this app's toolchain (see Shelf.test.ts) — this
// exercises the gallery's pure facet-filter and launch-target logic rather than a DOM render.

function example(overrides: Partial<ShowcaseExample> = {}): ShowcaseExample {
  return {
    id: 'ex-1',
    title: 'A dragon at dusk',
    blurb: 'A plain make example.',
    feature: 'make',
    kind: 'image',
    style: ['cgi'],
    mediaUrl: 'https://example.noema.art/outputs/ex-1.png',
    modusId: 'modus.gpt-image',
    aditus: { prompt: 'a low-poly dragon at dusk' },
    ...overrides,
  };
}

describe('launchTarget — "launch this" one-action prefill', () => {
  it('carries every aditus key as its own query param, same shape as Shelf.tsx\'s resolveUseInFlowTarget', () => {
    const to = launchTarget(example({ modusId: 'klein', aditus: { prompt: 'stationthis a portrait', guidance: 3 } }));
    expect(to).toBe('/card?id=klein&prompt=stationthis+a+portrait&guidance=3');
  });

  it('appends loraName when the example names the model it shows', () => {
    const to = launchTarget(example({ modusId: 'klein', aditus: { prompt: 'stationthis x' }, loraName: 'impresstation' }));
    expect(to).toBe('/card?id=klein&prompt=stationthis+x&loraName=impresstation');
  });

  it('resolves to a bare /card?id=... when the example carries no aditus at all', () => {
    expect(launchTarget(example({ aditus: {} }))).toBe('/card?id=modus.gpt-image');
  });
});

describe('distinctStyles — the derived style facet', () => {
  it('derives from the result set, no hardcoded allowlist (Catalog.tsx\'s distinctVerbs rule)', () => {
    const set = [example({ style: ['cgi', 'portrait'] }), example({ id: 'ex-2', style: ['anime'] })];
    expect(distinctStyles(set)).toEqual(['anime', 'cgi', 'portrait']);
  });

  it('is empty for an empty set', () => {
    expect(distinctStyles([])).toEqual([]);
  });
});

describe('applyExampleFilters — one filtering model, "All" clears a facet', () => {
  const set = [
    example({ id: 'make-1', feature: 'make', kind: 'image', style: ['cgi'] }),
    example({ id: 'muse-1', feature: 'muse', kind: 'image', style: ['portrait'] }),
    example({ id: 'video-1', feature: 'collections', kind: 'video', style: ['cgi'] }),
  ];

  it('narrows by feature', () => {
    expect(applyExampleFilters(set, 'muse', 'All', 'All').map((e) => e.id)).toEqual(['muse-1']);
  });

  it('narrows by kind', () => {
    expect(applyExampleFilters(set, 'All', 'video', 'All').map((e) => e.id)).toEqual(['video-1']);
  });

  it('narrows by style', () => {
    expect(applyExampleFilters(set, 'All', 'All', 'cgi').map((e) => e.id).sort()).toEqual(['make-1', 'video-1']);
  });

  it('combines every facet', () => {
    expect(applyExampleFilters(set, 'collections', 'video', 'cgi').map((e) => e.id)).toEqual(['video-1']);
  });

  it('with every facet at "All", returns the whole set — the way in for someone who does not know what they want', () => {
    expect(applyExampleFilters(set, 'All', 'All', 'All')).toHaveLength(3);
  });
});
