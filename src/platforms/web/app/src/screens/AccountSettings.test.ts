import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { liveLine } from './AccountSettings';

const SOURCE = readFileSync(fileURLToPath(new URL('./AccountSettings.tsx', import.meta.url)), 'utf8');

describe('liveLine — what the posture instrument says beside the meter', () => {
  it('says nothing is running instead of printing a count of zero (DESIGN.md D-58)', () => {
    expect(liveLine(0)).toBe('the meter · nothing running');
    expect(liveLine(0)).not.toMatch(/0/);
  });
  it('counts live sessions, singular and plural', () => {
    expect(liveLine(1)).toBe('the meter · 1 live session');
    expect(liveLine(3)).toBe('the meter · 3 live sessions');
  });
});

describe('the account home — one balance figure, and no second zero', () => {
  it('keeps the credits row as the one balance and offers a way to a first session instead of "0 live"', () => {
    expect(SOURCE).toContain('<Row k="Credits"');
    expect(SOURCE).not.toContain('{liveStudios} live</>} />');
    expect(SOURCE).toContain('none yet — run something ▸');
  });
});
