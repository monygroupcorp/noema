import { describe, expect, it } from 'vitest';
import { runBatch } from './upload';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('runBatch — fifty at once behaves (dataset-ingest-is-starved)', () => {
  it('keeps input order even when later items finish first', async () => {
    const out = await runBatch([30, 0, 15], async (ms, i) => { await tick(ms); return i; }, { concurrency: 3 });
    expect(out.ok).toEqual([0, 1, 2]);
    expect(out.failedIndexes).toEqual([]);
  });

  it('one failure does not cost the others', async () => {
    const out = await runBatch([1, 2, 3, 4, 5], async (n) => {
      if (n === 3) throw new Error('nope');
      return n;
    }, { concurrency: 2 });
    expect(out.ok).toEqual([1, 2, 4, 5]);
    expect(out.failedIndexes).toEqual([2]);
  });

  it('never runs more than the limit at once', async () => {
    let now = 0, peak = 0;
    await runBatch(Array.from({ length: 20 }), async () => {
      now++; peak = Math.max(peak, now);
      await tick(5);
      now--;
    }, { concurrency: 4 });
    expect(peak).toBe(4);
  });

  it('still runs everything when the list is longer than the pool', async () => {
    const seen: number[] = [];
    const out = await runBatch(Array.from({ length: 50 }, (_, i) => i), async (i) => { seen.push(i); return i; }, { concurrency: 4 });
    expect(seen).toHaveLength(50);
    expect(out.ok).toHaveLength(50);
  });

  it('reports every item as failed rather than throwing when all fail', async () => {
    const out = await runBatch([1, 2], async () => { throw new Error('all gone'); }, { concurrency: 2 });
    expect(out.ok).toEqual([]);
    expect(out.failedIndexes).toEqual([0, 1]);
  });

  it('reports each item running, then done or failed', async () => {
    const states: string[] = [];
    await runBatch([1, 2], async (n) => { if (n === 2) throw new Error('x'); return n; },
      { concurrency: 1, onState: (i, s) => states.push(`${i}:${s}`) });
    expect(states).toEqual(['0:running', '0:done', '1:running', '1:failed']);
  });

  it('does nothing, successfully, for an empty list', async () => {
    const out = await runBatch([], async () => 1);
    expect(out.ok).toEqual([]);
    expect(out.failedIndexes).toEqual([]);
  });
});
