import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./Profile.tsx', import.meta.url)), 'utf8');

// DESIGN.md P-1d: an anonymous visitor sees one sign-in link on the profile screen. The
// backup section carries it; the purses section refers to it in prose.
describe('the profile screen for an anonymous session', () => {
  it('offers one sign-in link', () => {
    expect(SOURCE.match(/>Sign in<\/Link>/g)).toHaveLength(1);
    expect(SOURCE).toContain('sign in above to make one');
  });
});
