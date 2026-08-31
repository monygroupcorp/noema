import { describe, expect, it } from 'vitest';
import {
  PLATES,
  PLATE_ASPECT,
  isPlaceholder,
  plateLabel,
  platesIn,
  validatePlateSource,
  type PlateSlot,
} from './landingPlates';

// No jsdom/@testing-library/react in this app's toolchain (see Catalog.test.ts) — so this
// exercises the slot registry and the format contract rather than rendering the component.

const slot = (over: Partial<PlateSlot> = {}): PlateSlot => ({
  id: 'test',
  name: 'hero',
  section: 'hero',
  format: '3:2',
  subject: 'figure',
  brief: 'test slot',
  source: null,
  ...over,
});

describe('the slot registry', () => {
  it('gives every slot a unique id', () => {
    const ids = PLATES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares only ruled formats — 3:2 hero, 4:5 supporting, 1:1 collection grid', () => {
    for (const s of PLATES) expect(PLATE_ASPECT[s.format]).toBeGreaterThan(0);
    expect(platesIn('hero').every((s) => s.format === '3:2')).toBe(true);
    expect(platesIn('cross-subject').every((s) => s.format === '4:5')).toBe(true);
    expect(platesIn('collection').every((s) => s.format === '1:1')).toBe(true);
  });

  it('covers all three subject classes in the row that claims the look holds across them', () => {
    const subjects = platesIn('cross-subject').map((s) => s.subject).sort();
    expect(subjects).toEqual(['figure', 'illustrated', 'mechanical']);
  });

  it('cycles the three classes through the collection grid so it reads at tile size', () => {
    const subjects = new Set(platesIn('collection').map((s) => s.subject));
    expect([...subjects].sort()).toEqual(['figure', 'illustrated', 'mechanical']);
  });

  it('carries no public caption copy on any slot — the brief is internal direction', () => {
    for (const s of PLATES) expect(s.brief.length).toBeGreaterThan(0);
    expect(PLATES.every((s) => !('caption' in s))).toBe(true);
  });
});

describe('plateLabel', () => {
  it('names the reserved shape, so a placeholder cannot pass for finished art', () => {
    expect(plateLabel(slot())).toBe('hero plate — 3:2 — figure');
    expect(plateLabel(slot({ name: 'supporting', format: '4:5', subject: 'mechanical' })))
      .toBe('supporting plate — 4:5 — mechanical');
  });
});

describe('isPlaceholder', () => {
  it('is true exactly while the slot has no source', () => {
    expect(isPlaceholder(slot())).toBe(true);
    expect(
      isPlaceholder(slot({ source: { src: '/a.webp', alt: 'a', width: 1440, height: 960 } })),
    ).toBe(false);
  });
});

describe('validatePlateSource — the format contract at swap time', () => {
  it('passes a source whose dimensions match its declared format', () => {
    expect(
      validatePlateSource(slot({ source: { src: '/a.webp', alt: 'a', width: 1440, height: 960 } })),
    ).toEqual([]);
    expect(
      validatePlateSource(
        slot({ format: '4:5', source: { src: '/a.webp', alt: 'a', width: 1080, height: 1350 } }),
      ),
    ).toEqual([]);
  });

  it('rejects art that is quietly the wrong shape for the box the layout reserved', () => {
    const problems = validatePlateSource(
      slot({ format: '3:2', source: { src: '/a.webp', alt: 'a', width: 1440, height: 1440 } }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('declared format 3:2');
  });

  it('tolerates an odd-pixel export but not a real crop difference', () => {
    expect(
      validatePlateSource(slot({ source: { src: '/a.webp', alt: 'a', width: 1441, height: 960 } })),
    ).toEqual([]);
    expect(
      validatePlateSource(slot({ source: { src: '/a.webp', alt: 'a', width: 1500, height: 960 } })),
    ).toHaveLength(1);
  });

  it('rejects a plate with no alt text', () => {
    const problems = validatePlateSource(
      slot({ source: { src: '/a.webp', alt: '   ', width: 1440, height: 960 } }),
    );
    expect(problems).toEqual(['test: source has no alt text']);
  });

  it('holds for every slot currently in the registry', () => {
    expect(PLATES.flatMap(validatePlateSource)).toEqual([]);
  });
});
