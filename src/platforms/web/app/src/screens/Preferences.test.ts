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

const CSS = readFileSync(fileURLToPath(new URL('../styles/app.css', import.meta.url)), 'utf8');

// The section index under the header jumps to each card (REF-34). Its links are set in the
// actionable tier, not the muted one, so they read as navigation rather than as static copy.
describe('the section index on /preferences', () => {
  it('is the shared section-jump nav', () => {
    expect(SOURCE).toContain('<nav className="section-jump" aria-label="Jump to a section">');
  });
  it('styles its links as navigation, with hover and focus states', () => {
    const link = CSS.match(/\.section-jump a\{([^}]*)\}/)?.[1] ?? '';
    expect(link).toMatch(/color:var\(--accent(-soft)?\)/);
    expect(link).not.toContain('color:var(--muted)');
    expect(CSS).toMatch(/\.section-jump a:hover\{[^}]*color:var\(--accent\)/);
    expect(CSS).toMatch(/\.section-jump a:focus-visible\{[^}]*outline/);
  });
});
