import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source-level checks on the words the user reads. There is no DOM renderer in this app's
// toolchain (see BuyCreditsModal.test.ts), so these read the screen sources directly.

const dir = fileURLToPath(new URL('.', import.meta.url));
const screens = readdirSync(dir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ f, src: readFileSync(dir + f, 'utf8') }));
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('loading text is sentence case (DESIGN.md D-26)', () => {
  it('no screen shows a loading line that starts in lower case', () => {
    // shelfKicker's 'loading…' is excluded: it fills the lower-case mono kicker above the
    // Models heading ("your models · 3"), not a status line.
    const offenders = screens
      .map(({ f, src }) => ({ f, src: src.replace("if (!models) return 'loading…';", '') }))
      .flatMap(({ f, src }) => [...src.matchAll(/[>'"]loading[ .…]/g)].map((m) => `${f}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });
});

describe('one spelling for the catalogue (DESIGN.md D-69)', () => {
  it('the rail names it "Catalogue"', () => {
    expect(readFileSync(fileURLToPath(new URL('../shell/Rail.tsx', import.meta.url)), 'utf8'))
      .toContain("label: 'Catalogue'");
  });
  it('no screen copy spells it "catalog"', () => {
    // Text between tags, or inside a quoted string, that says "catalog" as a word. Routes
    // (/catalog), identifiers (catalogOpen, setCatalog) and comments are not user copy.
    const offenders = screens.flatMap(({ f, src }) =>
      src.split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
        .flatMap((line) => [...line.matchAll(/(?:[>'"`]|\b(?:the|a|public|live|model|scoped|browse|hide) )[Cc]atalog(?![ue\w/])/g)]
          .map((m) => `${f}: ${line.trim()}`)));
    expect(offenders).toEqual([]);
  });
});

describe('the datasets catalogue when nothing is published (DESIGN.md D-60)', () => {
  const src = read('./Datasets.tsx');
  it('tells a signed-out visitor what will appear, rather than stopping at "nothing"', () => {
    expect(src).toContain('>Nothing published yet<');
    expect(src).toContain('Sets members publish from their own page appear here.');
  });
});

describe('a signed-out visitor on sponsorships (DESIGN.md D-46)', () => {
  const src = read('./Sponsorships.tsx');
  it('is offered the control that fixes what is missing, not a dimmed "Create pledge"', () => {
    expect(src).toContain('Sign in to pledge</Link>');
    expect(src).not.toMatch(/disabled=\{[^}]*!session[^}]*\}>\s*<Ic name="hand-coins"/);
  });
});
