import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// An anonymous visitor used to meet two different answers to the same question. Four screens
// stopped them with a "Sign in to continue" card and drew nothing else; others drew their whole
// working surface to a session with no account, two of them behind a create form whose every
// field was disabled — a form inviting work it could never submit, over a list reading "No teams
// yet" when the truth was "we don't know who you are".
//
// Neither half was a decision anybody made. They are what four hand-copied gate cards and two
// hand-rolled notices come to after a year. `shell/AccountGate.tsx` carries the one rule now, and
// this file is what stops the next screen from inventing a third answer. It checks the two things
// about that rule a machine can check.

const SCREENS = dirname(fileURLToPath(import.meta.url));
const SHELL = join(SCREENS, '..', 'shell');
const GATE = 'AccountGate.tsx';

const sources = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe('one rule for the signed-out visitor', () => {
  // 1. The full-screen gate card — an `empty` panel whose call to action is the door — belongs to
  //    AccountGate alone. Four copies is how its wording drifted apart in the first place (one read
  //    "Sign in to see your review status", one carried an icon the others lacked), and a fifth copy
  //    is also how a screen opts out of the rule while still looking like it follows it.
  //
  //    Not caught, deliberately: an INLINE sign-in link inside a working screen (Funding, Profile,
  //    Vault). That is the rule's other half — the action stays live, and its prose is local to
  //    what it is offering. Only the whole-screen card is centralized.
  it('builds the whole-screen sign-in card only in AccountGate', () => {
    const card = /className="empty"[\s\S]{0,600}?\bdoorPath\b/;
    const offenders = [...sources(SCREENS), ...sources(SHELL).filter(([f]) => f !== GATE)]
      .filter(([, src]) => card.test(src))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
    expect(readFileSync(join(SHELL, GATE), 'utf8')).toContain('Sign in to continue');
  });

  // 2. No control is disabled for want of an account. This is the whole of the second design: draw
  //    the working surface to a visitor who cannot use it, grey the controls out, call it an answer.
  //    The rule admits two endings and this is neither — either the screen is account-bound and
  //    renders <AccountGate/> INSTEAD of its surface, or the action stays LIVE and routes through the
  //    door, which hands the visitor back here. A dead control is the one thing it may never be.
  //
  //    Scoped to files that actually read the auth session: `session` also names a Muse session and
  //    a studio lease elsewhere, and a control disabled on one of those is about its own state, not
  //    about who the visitor is.
  it('disables no control for want of an account', () => {
    const offenders: string[] = [];
    for (const [f, src] of [...sources(SCREENS), ...sources(SHELL)]) {
      if (!src.includes('useSession()') && !src.includes('useIdentity()')) continue;
      for (const [, expr] of src.matchAll(/disabled=\{([^}]*)\}/g)) {
        if (/\bsession\b|\banon\b|\bsignedIn\b/.test(expr)) offenders.push(`${f}: disabled={${expr}}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
