import { describe, expect, it, vi, beforeEach } from 'vitest';
import { confirmLeave, guardedClick, setDirty } from './dirtyGuard';

// No jsdom/@testing-library/react in this app's toolchain (see the header comment in
// screens/Shelf.test.ts) — this is a pure module test, no render involved.

beforeEach(() => {
  setDirty(false);
});

describe('confirmLeave', () => {
  it('returns true and never calls ask when not dirty', () => {
    const ask = vi.fn(() => false);
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('returns true when dirty and the user confirms', () => {
    setDirty(true);
    const ask = vi.fn(() => true);
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).toHaveBeenCalledOnce();
  });

  it('returns false when dirty and the user declines', () => {
    setDirty(true);
    const ask = vi.fn(() => false);
    expect(confirmLeave(ask)).toBe(false);
  });

  it('setDirty(true) then setDirty(false) goes back to never asking (unmount-reset path)', () => {
    setDirty(true);
    setDirty(false);
    const ask = vi.fn(() => false);
    expect(confirmLeave(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('guardedClick', () => {
  it('does not preventDefault when the user is not dirty', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const e = { preventDefault: vi.fn() };
    guardedClick(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('preventDefaults only when the user declines to leave', () => {
    setDirty(true);
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const e = { preventDefault: vi.fn() };
    guardedClick(e);
    expect(e.preventDefault).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
