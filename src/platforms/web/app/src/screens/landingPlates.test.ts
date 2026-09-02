import { describe, expect, it } from 'vitest';
import {
  DECK_FORMATS,
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
  name: 'deck',
  section: 'deck',
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

  it('puts every plate in a deck run — the page has no standing image box', () => {
    expect(PLATES.length).toBeGreaterThan(0);
    for (const s of PLATES) expect(['deck', 'deck-coda']).toContain(s.section);
  });

  it('crops every deck card wide, since a card holds most of a banner', () => {
    for (const s of PLATES) {
      expect(DECK_FORMATS).toContain(s.format);
      expect(PLATE_ASPECT[s.format]).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('keeps one crop within a run, so the fan does not change shape as it passes', () => {
    for (const section of ['deck', 'deck-coda'] as const) {
      const formats = new Set(platesIn(section).map((s) => s.format));
      expect(formats.size).toBe(1);
    }
  });

  it('alternates subject class along each run, so the motion carries the cross-subject claim', () => {
    for (const section of ['deck', 'deck-coda'] as const) {
      const run = platesIn(section);
      expect(run.length).toBeGreaterThan(1);
      for (let i = 1; i < run.length; i++) {
        expect(run[i].subject).not.toBe(run[i - 1].subject);
      }
    }
  });

  it('covers all three subject classes across the page', () => {
    const subjects = new Set(PLATES.map((s) => s.subject));
    expect([...subjects].sort()).toEqual(['figure', 'illustrated', 'mechanical']);
  });

  it('carries no public caption copy on any slot — the brief is internal direction', () => {
    for (const s of PLATES) expect(s.brief.length).toBeGreaterThan(0);
    expect(PLATES.every((s) => !('caption' in s))).toBe(true);
  });
});

describe('plateLabel', () => {
  it('names the reserved shape, so a placeholder cannot pass for finished art', () => {
    expect(plateLabel(slot())).toBe('deck plate — 3:2 — figure');
    expect(plateLabel(slot({ name: 'coda', format: '16:9', subject: 'mechanical' })))
      .toBe('coda plate — 16:9 — mechanical');
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
        slot({ format: '2:1', source: { src: '/a.webp', alt: 'a', width: 2400, height: 1200 } }),
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
