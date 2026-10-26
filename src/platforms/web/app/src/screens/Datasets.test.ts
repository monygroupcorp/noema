import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMPTY_DATASET_LINE, datasetStatsLine } from '../lib/datasets';

const SOURCE = readFileSync(fileURLToPath(new URL('./Datasets.tsx', import.meta.url)), 'utf8');
const DETAIL = readFileSync(fileURLToPath(new URL('./Dataset.tsx', import.meta.url)), 'utf8');

const set = (over: { modality?: string; captionsets?: unknown[]; versions?: { v: string }[] } = {}) =>
  ({ modality: 'image', captionsets: [], versions: [], ...over });

describe('datasetStatsLine — the facts line under a dataset name', () => {
  it('prints no zero: a set with nothing in it reads as new (DESIGN.md D-58)', () => {
    expect(datasetStatsLine(set(), 0)).toBe(EMPTY_DATASET_LINE);
    expect(datasetStatsLine(set(), 0)).not.toMatch(/\b0\b/);
  });
  it('joins only the counts that are non-zero, then the version', () => {
    expect(datasetStatsLine(set({ versions: [{ v: 'v1' }, { v: 'v2' }] }), 9)).toBe('9 images · v2');
    expect(datasetStatsLine(set({ captionsets: [1, 2] }), 1)).toBe('1 image · 2 captionsets');
    expect(datasetStatsLine(set({ modality: 'video', captionsets: [1] }), 1)).toBe('1 clip · 1 captionset');
  });
  it('carries a trailing fact that is not a count, with or without counts before it', () => {
    expect(datasetStatsLine(set(), 0, 'updated 2d ago')).toBe(`${EMPTY_DATASET_LINE} · updated 2d ago`);
    expect(datasetStatsLine(set({ versions: [{ v: 'v3' }] }), 12, 'updated now')).toBe('12 images · v3 · updated now');
  });
});

describe('the datasets library for a signed-out visitor (REFERENCES.md REF-20)', () => {
  it('opens the public catalogue it promises, and both screens read the shared facts line', () => {
    expect(SOURCE).toContain('useState(!signedIn)');
    expect(SOURCE).toContain('datasetStatsLine(d, media.length)');
    expect(DETAIL).toContain('datasetStatsLine(d, live.length');
  });
  it('asks "No set of your own yet?" in sentence case (DESIGN.md D-26)', () => {
    expect(SOURCE).toContain('>No set of your own yet?<');
    expect(SOURCE).not.toContain('>no set of your own yet?<');
  });
});
