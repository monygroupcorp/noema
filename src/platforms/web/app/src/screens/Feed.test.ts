import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./Feed.tsx', import.meta.url)), 'utf8');

// DESIGN.md P-1d: the topbar's "Start" begins a piece from every screen, so the feed's
// heading says how a piece arrives here rather than offering a second way to start one.
describe('the feed heading', () => {
  it('carries no start link of its own', () => {
    const sub = SOURCE.match(/<div className="sub">\{feedShape\(items\)\}[^\n]*/)?.[0] ?? '';
    expect(sub).not.toBe('');
    expect(sub).not.toContain('<Link');
  });
});
