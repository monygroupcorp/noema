import { describe, expect, it } from 'vitest';
import {
  buildFallbackItems, formatVestigiumDate, vestigiumSnippet,
  computeBounds, normalizeToUnitScale, frameCameraToBounds, SCENE_EXTENT,
  axesGridSize,
} from './Space';
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

// noema-050: a small real space's PCA output can be orders of magnitude smaller than the
// demo corpus's — normalize every cloud to a fixed envelope so 2 points and 2000 both fill
// the view legibly, framed, with no per-axis distortion of the projection's layout.
describe('computeBounds', () => {
  it('finds the centroid and the largest single-axis range', () => {
    // x spans 4 (-2..2), y spans 2 (-1..1), z spans 0 (always 3) -> maxExtent is the x span
    const positions = new Float32Array([-2, 1, 3, 2, -1, 3]);
    const { center, maxExtent } = computeBounds(positions);
    expect(center).toEqual([0, 0, 3]);
    expect(maxExtent).toBe(4);
  });
  it('a single point has zero extent, centered on itself', () => {
    const { center, maxExtent } = computeBounds(new Float32Array([5, -5, 2]));
    expect(center).toEqual([5, -5, 2]);
    expect(maxExtent).toBe(0);
  });
  it('empty input -> zero bounds, no crash', () => {
    expect(computeBounds(new Float32Array([]))).toEqual({ center: [0, 0, 0], maxExtent: 0 });
  });
});

describe('normalizeToUnitScale', () => {
  it('centers on the centroid and scales the max extent to SCENE_EXTENT', () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0]);   // extent 10 on x, centroid (5,0,0)
    const out = normalizeToUnitScale(positions);
    const { maxExtent, center } = computeBounds(out);
    expect(maxExtent).toBeCloseTo(SCENE_EXTENT, 5);
    expect(center).toEqual([0, 0, 0]);
  });
  it('uniform scale only — a stretched cloud keeps its axis proportions (no per-axis distortion)', () => {
    // x spans 20, y spans 10: y must stay exactly half of x post-normalize
    const positions = new Float32Array([-10, -5, 0, 10, 5, 0]);
    const out = normalizeToUnitScale(positions);
    const xSpan = out[3] - out[0];
    const ySpan = out[4] - out[1];
    expect(xSpan).toBeCloseTo(SCENE_EXTENT, 5);
    expect(ySpan).toBeCloseTo(SCENE_EXTENT / 2, 5);
  });
  it('n=1: a single point normalizes to the origin, visible and framed (no divide-by-zero)', () => {
    const out = normalizeToUnitScale(new Float32Array([42, -7, 3]));
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
  it('all-coincident points (zero extent, n>1): skip scale, just center — no NaN/Infinity', () => {
    const out = normalizeToUnitScale(new Float32Array([3, 3, 3, 3, 3, 3, 3, 3, 3]));
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it('empty cloud in -> empty array out (no crash)', () => {
    expect(normalizeToUnitScale(new Float32Array([]))).toEqual(new Float32Array([]));
  });
});

describe('frameCameraToBounds', () => {
  it('derives a camera position/fov from the fixed SCENE_EXTENT envelope (not per-corpus)', () => {
    const a = frameCameraToBounds();
    const b = frameCameraToBounds();
    expect(a).toEqual(b);               // deterministic — same envelope every time
    expect(a.fov).toBe(42);
    const dist = Math.hypot(...a.position);
    expect(dist).toBeGreaterThan(SCENE_EXTENT / 2);   // sits outside the normalized cloud
  });
});

// noema-051: the reference grid/axes (regression fix — restores the wireframe cube +
// labeled axes dropped in the noema-033 real-data rewrite) must scale off the CURRENT
// SCENE_EXTENT envelope, not the old hardcoded 5.4, so it fits both a 2-point real space
// and the 2000-point demo corpus post-normalization.
describe('axesGridSize', () => {
  it('sizes the box/axis a fixed margin past the given extent', () => {
    expect(axesGridSize(5)).toEqual({ boxSize: 5.4, axisLength: 2.6 });
  });
  it('scales with extent — not pinned to the old hardcoded 5.4', () => {
    expect(axesGridSize(10)).toEqual({ boxSize: 10.4, axisLength: 5.1 });
  });
  it('the box always encloses the labeled axis length', () => {
    const { boxSize, axisLength } = axesGridSize(SCENE_EXTENT);
    expect(boxSize / 2).toBeGreaterThan(axisLength - 0.2);
  });
});
