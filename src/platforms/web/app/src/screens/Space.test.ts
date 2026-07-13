import { describe, expect, it } from 'vitest';
import { buildFallbackItems, formatVestigiumDate, vestigiumSnippet } from './Space';
import type { Vestigium } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts,
// Canvas.test.ts) — this exercises the fallback-grid's pure data-shaping/formatting logic
// (product ruling 2026-07-13: the space falls back to a flat chronological list/grid when
// the 3D projection isn't available, rather than an empty screen).

describe('vestigiumSnippet', () => {
  it('returns the prompt unchanged when it fits', () => {
    expect(vestigiumSnippet('a red dragon')).toBe('a red dragon');
  });
  it('truncates with an ellipsis past the length cap', () => {
    const long = 'x'.repeat(200);
    const out = vestigiumSnippet(long, 160);
    expect(out.length).toBe(161);
    expect(out.endsWith('…')).toBe(true);
  });
  it('handles an empty/undefined prompt without throwing', () => {
    expect(vestigiumSnippet('')).toBe('');
    expect(vestigiumSnippet(undefined as unknown as string)).toBe('');
  });
});

describe('formatVestigiumDate', () => {
  it('formats an ISO date to YYYY-MM-DD', () => {
    expect(formatVestigiumDate('2026-07-10T12:34:56.000Z')).toBe('2026-07-10');
  });
  it('returns empty string for an absent or unparsable date, never throws', () => {
    expect(formatVestigiumDate('')).toBe('');
    expect(formatVestigiumDate('not-a-date')).toBe('');
  });
});

describe('buildFallbackItems — the full-history flat-grid shape', () => {
  it('narrows every vestigium to the grid-relevant fields, preserving order', () => {
    const vestigia: Vestigium[] = [
      { id: 'v2', promptum: 'a blue whale', imagoUrl: 'https://x/whale.png', intellaIds: ['m1'], natum: '2026-07-11T00:00:00.000Z', genus: 'image' },
      { id: 'v1', promptum: 'a red dragon', natum: '2026-07-10T00:00:00.000Z', genus: 'image' },
    ];
    const items = buildFallbackItems(vestigia);
    expect(items).toEqual([
      { id: 'v2', promptum: 'a blue whale', imagoUrl: 'https://x/whale.png', natum: '2026-07-11T00:00:00.000Z' },
      { id: 'v1', promptum: 'a red dragon', imagoUrl: undefined, natum: '2026-07-10T00:00:00.000Z' },
    ]);
  });
  it('never drops an item to an empty screen — one vestigium in, one item out', () => {
    const vestigia: Vestigium[] = [{ id: 'v1', promptum: 'p', natum: '2026-07-10T00:00:00.000Z', genus: 'image' }];
    expect(buildFallbackItems(vestigia)).toHaveLength(1);
  });
  it('empty history in -> empty grid out (no crash)', () => {
    expect(buildFallbackItems([])).toEqual([]);
  });
});
