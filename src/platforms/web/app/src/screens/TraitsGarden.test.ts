import { describe, expect, it } from 'vitest';
import { gardenCountLine } from './TraitsGarden';
import type { Tractus } from '../lib/api';

const axis = (n: number): Tractus => ({ porta: 'prompt', label: 'a', valores: Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: '' })) });

describe('gardenCountLine — the count beside a collection’s title', () => {
  it('is absent when there is nothing to count: no "0 axes · 0 combinations · 0 pieces" (DESIGN.md D-58)', () => {
    expect(gardenCountLine([], 0)).toBeNull();
  });
  it('counts combinations only once there is an axis, and pieces only once there is a supply', () => {
    expect(gardenCountLine([], 100)).toBe('100 pieces');
    expect(gardenCountLine([axis(2)], 0)).toBe('1 axis · 2 combinations');
    expect(gardenCountLine([axis(2), axis(3)], 12)).toBe('2 axes · 6 combinations · 12 pieces');
  });
});
