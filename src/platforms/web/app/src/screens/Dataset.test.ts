import { describe, expect, it } from 'vitest';
import { captionFor, categoryColor, curatedFragments } from './Dataset';
import type { DatasetCaptionset, Fragment } from '../lib/api';

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

function capset(id: string, captions?: Record<string, string>): DatasetCaptionset {
  return { id, name: id, method: 'manual', coverage: '', captions };
}

describe('captionFor — the active captionset\'s caption for a tile (noema-319)', () => {
  it('returns the active set\'s caption for a captioned media id', () => {
    const dataset = { captionsets: [capset('a', { m1: 'a fox in a foggy harbor' })] };
    expect(captionFor(dataset, 'a', 'm1')).toBe('a fox in a foggy harbor');
  });

  it('returns null when the media id has no entry in the active set', () => {
    const dataset = { captionsets: [capset('a', { m1: 'captioned' })] };
    expect(captionFor(dataset, 'a', 'm2')).toBeNull();
  });

  it('returns null when no captionset is active', () => {
    const dataset = { captionsets: [capset('a', { m1: 'captioned' })] };
    expect(captionFor(dataset, '', 'm1')).toBeNull();
  });

  it('returns null for a captionset written before the captions field existed', () => {
    const dataset = { captionsets: [capset('a', undefined)] };
    expect(captionFor(dataset, 'a', 'm1')).toBeNull();
  });

  it('switching the active set switches the text', () => {
    const dataset = {
      captionsets: [
        capset('a', { m1: 'caption from set a' }),
        capset('b', { m1: 'caption from set b' }),
      ],
    };
    expect(captionFor(dataset, 'a', 'm1')).toBe('caption from set a');
    expect(captionFor(dataset, 'b', 'm1')).toBe('caption from set b');
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
