import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vault.tsx pulls in the in-browser proving stack, so this reads the source rather than
// importing the module — the same allowance Dataset.test.ts uses.
const SOURCE = readFileSync(fileURLToPath(new URL('./Vault.tsx', import.meta.url)), 'utf8');

describe('the empty Purses section', () => {
  it('says what a purse is for and offers funding, and promises no future (DESIGN.md D-60, D-63)', () => {
    expect(SOURCE).toContain("'A purse is bearer credit: it spends without naming you.'");
    expect(SOURCE).toContain('<Link to="/funding">add credits ▸</Link>');
    expect(SOURCE).not.toContain('once the anonymous purse unlocks');
    expect(SOURCE).not.toContain('No purses yet.');
  });
  it('prints no purse count or balance of zero in the context panel (DESIGN.md D-58)', () => {
    expect(SOURCE).toContain('{purses.length > 0 ? (');
    expect(SOURCE).toContain('<span>none held yet</span>');
  });
});
