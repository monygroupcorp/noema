import { describe, expect, it } from 'vitest';
import { categoryColor, curatedFragments } from './Dataset';
import type { Fragment } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) — so
// this exercises the chip garden's pure curation/color logic rather than a full DOM render,
// per the item's "any component test the app supports" allowance.

function frag(category: Fragment['category'], text: string): Fragment {
  return { category, text, source: 'moodboard-1', trigger: 'stationthis' };
}

describe('curatedFragments — the chip garden curation subset (noema-221)', () => {
  it('returns every fragment when nothing is excluded', () => {
    const fragments = [frag('setting', 'a foggy harbor'), frag('mood', 'wistful')];
    expect(curatedFragments(fragments, new Set())).toEqual(fragments);
  });

  it('excludes the fragment at an unchecked chip\'s index — the curated subset excludes unchecked chips', () => {
    const fragments = [frag('setting', 'a foggy harbor'), frag('mood', 'wistful'), frag('style', 'watercolor')];
    const curated = curatedFragments(fragments, new Set([1]));
    expect(curated).toEqual([fragments[0], fragments[2]]);
    expect(curated).not.toContainEqual(fragments[1]);
  });

  it('excludes everything when every chip is unchecked', () => {
    const fragments = [frag('subject', 'a fox'), frag('hair', 'braided')];
    expect(curatedFragments(fragments, new Set([0, 1]))).toEqual([]);
  });
});

describe('categoryColor — every taxonomy category resolves to a distinct, stable color', () => {
  it('resolves every category and never repeats a color across categories', () => {
    const categories: Fragment['category'][] = [
      'subject', 'hair', 'outfit', 'pose', 'expression', 'props',
      'setting', 'style', 'palette', 'lighting', 'mood',
    ];
    const colors = categories.map((c) => categoryColor(c));
    expect(new Set(colors).size).toBe(categories.length);
  });

  it('is deterministic — the same category always resolves to the same color', () => {
    expect(categoryColor('setting')).toBe(categoryColor('setting'));
  });
});
