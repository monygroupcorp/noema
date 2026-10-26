import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./Preferences.tsx', import.meta.url)), 'utf8');

// Unbuilt capability is absent from the interface, not announced (DESIGN.md D-63): the cards
// for verbs with no flow behind them, and the sentence that said so, are gone.
describe('the per-command cards on /preferences', () => {
  it('render only the verb that exists', () => {
    expect(SOURCE).toContain('<span className="accent mono">/make</span>');
    expect(SOURCE).not.toContain('no canon verb yet');
    expect(SOURCE).not.toContain("'/animate'");
    expect(SOURCE).not.toMatch(/lands next|aren't canon verbs yet/);
  });
});
