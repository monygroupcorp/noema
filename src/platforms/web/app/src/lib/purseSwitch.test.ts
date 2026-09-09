import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { purseIsOff } from './purseSwitch';

describe('purseIsOff — unknown and unreachable read as off', () => {
  it('is off before the config has been read', () => {
    expect(purseIsOff(null)).toBe(true);
    expect(purseIsOff(undefined)).toBe(true);
  });

  it('is off when the config arrived without the field', () => {
    expect(purseIsOff({})).toBe(true);
  });

  it('is off when the switch says off', () => {
    expect(purseIsOff({ enabled: false })).toBe(true);
  });

  it('is on only for an explicit true', () => {
    expect(purseIsOff({ enabled: true })).toBe(false);
  });
});

// The bug this closes was not the rule but the FOUR copies of it: /pricing and the landing panel
// derived "off" one way, /funding and /vault another, and the two that got it wrong were the two
// pages carrying the mint button. A fifth page reading the switch by hand would be the same bug
// again, so the check is on the source rather than on a rendered page — this app has no jsdom.
describe('every page that reads the switch reads it through purseIsOff', () => {
  const SCREENS = join(dirname(fileURLToPath(import.meta.url)), '..', 'screens');

  const readers = readdirSync(SCREENS)
    .filter((f) => f.endsWith('.tsx'))
    .filter((f) => /api\.arcanum\.config\(\)/.test(readFileSync(join(SCREENS, f), 'utf8')));

  it('finds the pages that read GET /arcanum/config', () => {
    expect(readers.sort()).toEqual(['Funding.tsx', 'LandingAnon.tsx', 'Pricing.tsx', 'Vault.tsx']);
  });

  for (const file of readers) {
    it(`${file} derives its offer from purseIsOff`, () => {
      const src = readFileSync(join(SCREENS, file), 'utf8');
      expect(src, `${file} must import purseIsOff`).toContain("from '../lib/purseSwitch'");
      const own = src.match(/const\s+purseOff\s*=\s*([^;]+);/);
      expect(own?.[1], `${file} must not derive purseOff by hand`).toMatch(/^purseIsOff\(/);
    });
  }
});
