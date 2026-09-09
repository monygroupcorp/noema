import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isWriteConfirmed, markWriteConfirmed, CONFIRMED_MAX } from './writeConfirmed';

// The author ladder's replay guard. A reply carrying an un-confirmed write card persists
// serialized, so a resumed thread re-renders it — these are the edges that decide whether the
// card comes back live (nobody pressed GO) or settled (somebody did).
//
// No jsdom in this app's toolchain (see api.purse.test.ts), so stand up a minimal in-memory
// localStorage — including one that THROWS, which is the case the guard has to fail open on.

const KEY = 'noema-concierge-writes-confirmed';

const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

describe('writeConfirmed', () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', localStorageStub);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reads as unconfirmed until GO lands', () => {
    expect(isWriteConfirmed('turn-1')).toBe(false);
    markWriteConfirmed('turn-1');
    expect(isWriteConfirmed('turn-1')).toBe(true);
  });

  it('confirms one turn without confirming another', () => {
    markWriteConfirmed('turn-1');
    expect(isWriteConfirmed('turn-2')).toBe(false);
  });

  // A turn with no key is every turn before this shipped, and any path that lost it. It fails
  // OPEN: a live card the user must press, never a silently suppressed one.
  it('treats a missing key as unconfirmed and records nothing', () => {
    markWriteConfirmed(undefined);
    expect(isWriteConfirmed(undefined)).toBe(false);
    expect(store.get(KEY)).toBeUndefined();
  });

  it('is idempotent — marking twice keeps one entry', () => {
    markWriteConfirmed('turn-1');
    markWriteConfirmed('turn-1');
    expect(JSON.parse(store.get(KEY) ?? '[]')).toEqual(['turn-1']);
  });

  // A recency window, not an archive: the oldest fall off so the key cannot grow without bound.
  it('keeps the newest CONFIRMED_MAX keys and drops the oldest', () => {
    for (let i = 0; i < CONFIRMED_MAX + 5; i++) markWriteConfirmed(`turn-${i}`);
    const kept: string[] = JSON.parse(store.get(KEY) ?? '[]');
    expect(kept).toHaveLength(CONFIRMED_MAX);
    expect(kept[kept.length - 1]).toBe(`turn-${CONFIRMED_MAX + 4}`);
    expect(isWriteConfirmed('turn-0')).toBe(false);
    expect(isWriteConfirmed(`turn-${CONFIRMED_MAX + 4}`)).toBe(true);
  });

  // Storage that holds junk (another tab, an older build, a user editing it) must not throw on a
  // path whose whole job is deciding whether to show a button.
  it('survives a corrupt or wrongly-shaped stored value', () => {
    store.set(KEY, 'not json');
    expect(isWriteConfirmed('turn-1')).toBe(false);
    store.set(KEY, JSON.stringify({ turnKey: 'turn-1' }));
    expect(isWriteConfirmed('turn-1')).toBe(false);
    store.set(KEY, JSON.stringify(['turn-1', 7, null]));
    expect(isWriteConfirmed('turn-1')).toBe(true);
  });

  // A browser that refuses storage (private mode, site data blocked) must leave the card live and
  // pressable rather than throw on the way to rendering it.
  it('fails open when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(() => markWriteConfirmed('turn-1')).not.toThrow();
    expect(isWriteConfirmed('turn-1')).toBe(false);
  });
});
