import { describe, expect, it } from 'vitest';
import { census } from './routes.ts';

// census() throws when a parameterized route in App.tsx has no fixture in walk.config.ts
// (routes.ts's resolvePath, by design — see the comment there). That refusal used to surface
// only when a person ran `npm run walk` by hand: /blog/:slug landed without a fixture and left
// the census broken on every invocation until this seat noticed. This test runs in `npm test`,
// which CI's web-tests job already runs on every PR, so a future route without a fixture fails
// CI instead of waiting for someone to run the walk.
describe('route census', () => {
  it('resolves every route without throwing on a missing fixture', () => {
    expect(() => census()).not.toThrow();
  });

  it('tags every route either pub or auth', () => {
    for (const row of census()) {
      expect(typeof row.authRequired).toBe('boolean');
    }
  });
});
