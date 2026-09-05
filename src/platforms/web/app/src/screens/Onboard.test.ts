import { describe, expect, it } from 'vitest';
import { safeNext } from './Onboard';

// `next` decides where the door sends a visitor once their session is live, and it arrives from
// the query string — so anything that isn't a same-origin app path is an open redirect off the
// site, and is dropped in favour of the default landing.

describe('safeNext', () => {
  it('keeps an app path, so a pack purchase resumes where it left off', () => {
    expect(safeNext('/funding?pack=plus_50')).toBe('/funding?pack=plus_50');
    expect(safeNext('/app')).toBe('/app');
  });

  it('drops an absolute URL — the door never redirects off the site', () => {
    expect(safeNext('https://evil.example/phish')).toBeNull();
    expect(safeNext('http://evil.example')).toBeNull();
  });

  it('drops a protocol-relative URL, which a browser also treats as off-site', () => {
    expect(safeNext('//evil.example/phish')).toBeNull();
  });

  it('drops a missing or relative value rather than guessing a destination', () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext('')).toBeNull();
    expect(safeNext('funding')).toBeNull();
  });
});
