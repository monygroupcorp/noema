import { describe, expect, it } from 'vitest';
import { doorPath, entryPath } from './entry';

// Every surface that turns a visitor away for want of an account sends them through `doorPath`,
// so signing in hands them back to the page they were already on. The pair with `safeNext` in
// Onboard.tsx is the whole contract: this side encodes it, that side refuses anything off-site.

describe('doorPath', () => {
  it('carries the page the visitor was on, so signing in returns them to it', () => {
    expect(doorPath('/teams')).toBe('/onboard?next=%2Fteams');
  });

  it('encodes a path that carries its own query, rather than truncating at the ?', () => {
    const url = new URL(doorPath('/review?tab=held'), 'https://noema.example');
    expect(url.searchParams.get('next')).toBe('/review?tab=held');
  });

  it('is the bare door when there is nowhere in particular to return to', () => {
    expect(doorPath()).toBe('/onboard');
    expect(doorPath(null)).toBe('/onboard');
    expect(doorPath('')).toBe('/onboard');
  });
});

describe('entryPath', () => {
  it('sends a visitor we know nothing about to the door', () => {
    // No localStorage in this environment: no onboarded flag and no held login, which is
    // exactly the state of a browser that has never been here.
    expect(entryPath()).toBe('/onboard');
  });
});
