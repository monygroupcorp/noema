import { describe, expect, it, vi } from 'vitest';
import { READ_TIMEOUT_MESSAGE, READ_TIMEOUT_MS, withReadTimeout } from './api';

// A collection screen renders "Loading…" until its read answers. Every OTHER way that read
// can go wrong now ends in an error the screen prints — no id in the route, a 200 carrying no
// collection, a rejected fetch. A request that simply never answers ends in nothing at all:
// no rejection to catch, so no error to set, so "Loading…" forever. These pin the deadline
// that turns that silence into a sentence.

describe('withReadTimeout', () => {
  it('passes a resolved read straight through', async () => {
    await expect(withReadTimeout(async () => 'the collection', 50)).resolves.toBe('the collection');
  });

  it('rejects a read that never answers, instead of waiting for the tab to close', async () => {
    vi.useFakeTimers();
    try {
      const pending = withReadTimeout(() => new Promise<never>(() => {}), 20_000);
      const settled = expect(pending).rejects.toThrow(READ_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(20_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the request on the way out, so a dead read is not left holding a socket', async () => {
    let seen: AbortSignal | undefined;
    await expect(
      withReadTimeout((signal) => {
        seen = signal;
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      }, 1),
    ).rejects.toThrow(READ_TIMEOUT_MESSAGE);
    expect(seen?.aborted).toBe(true);
  });

  it('reports a real failure as itself — the deadline does not swallow the server’s answer', async () => {
    await expect(withReadTimeout(async () => { throw new Error('404 no such collection'); }, 50))
      .rejects.toThrow('404 no such collection');
  });

  it('clears its timer once the read answers, so a fast read leaves nothing pending', async () => {
    vi.useFakeTimers();
    try {
      await withReadTimeout(async () => 'ok', 20_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has a deadline a person would wait out, not one that trips on a slow network', () => {
    expect(READ_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(READ_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
