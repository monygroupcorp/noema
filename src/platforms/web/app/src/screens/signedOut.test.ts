import { describe, expect, it } from 'vitest';
import { holdsRight, sovereignRights } from './AccountSettings';
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
const COMPONENTS = join(SCREENS, '..', 'components');
const UI = join(SCREENS, '..', 'ui');
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
  //
  //    What identifies the card is a link to the door INSIDE an `empty` panel — not the door
  //    appearing somewhere in the same file. `empty` is also this app's loading-and-nothing-here
  //    panel (Status, Shelf, Teams' "No teams yet"), so a file-scope match would fail honest
  //    screens; and matching only what follows the panel is how the first version of this guard
  //    came to be blind. It looked for `doorPath` after the panel opened, which held while screens
  //    called `doorPath(...)` inline in the JSX — but `useDoorHere()` is a hook, so it is hoisted
  //    to the top of the component and the door is named ABOVE the card it belongs to. Every copy
  //    written in the idiom this app now uses went straight past it. `to={door` catches both.
  it('builds the whole-screen sign-in card only in AccountGate', () => {
    const card = /className="empty"[\s\S]{0,600}?to=\{door/;
    const dirs = [SCREENS, COMPONENTS, UI].flatMap(sources);
    const offenders = [...dirs, ...sources(SHELL).filter(([f]) => f !== GATE)]
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

  // 3. No control explains its own deadness by asking for an account. The check above reads the
  //    `disabled={...}` EXPRESSION, so it sees a control switched off by a session variable and
  //    nothing else — and the account screen's own version of the second design was written
  //    without one. It offered an anonymous visitor a permanently dead "Delete account & data",
  //    disabled by a bare attribute with the reason in its title: "Sign in to erase a named
  //    account". No expression to read, so the guard that was supposed to hold that half shut
  //    passed over it; restoring the old file and running this suite is how that was found.
  //
  //    So read the REASON instead of the switch. A control carrying `disabled` whose own
  //    attributes tell the visitor to sign in is the second design in a single line, whichever
  //    spelling turned it off. Scoped to the element's own attributes, because "sign in" is
  //    ordinary prose on the screens around the door: Onboard's "coming soon" buttons sit inside
  //    it, and anything measuring nearby text would fail them for their neighbours' words.
  it('explains no dead control by the want of an account', () => {
    const control = /<(?:button|a|input|select|textarea|Link)\b((?:[^<>{}]|\{[^{}]*\})*)>/g;
    const offenders: string[] = [];
    for (const [f, src] of [...sources(SCREENS), ...sources(SHELL)]) {
      if (!src.includes('useSession()') && !src.includes('useIdentity()')) continue;
      for (const [, attrs] of src.matchAll(control)) {
        if (!/\bdisabled\b/.test(attrs) || !/sign(ed)?[ -]in/i.test(attrs)) continue;
        offenders.push(`${f}: ${attrs.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});


// The account screen had its own copy of the two designs, and it is the one the cross-screen
// guard above cannot see. Its controls were never DISABLED for want of an account — they were
// LIVE and pointless: "go anonymous ▸" as a link beside an identity cell already reading
// "anonymous", and "Go anonymous" as a button 250px under it, both offering a visitor the
// footing they were already standing on, above a "Delete account & data" with nothing to erase.
//
// A live control that does nothing is not caught by reading `disabled`, so the rule it breaks
// has to be stated positively: what rights does this visitor actually hold? `sovereignRights`
// answers that and the JSX asks it, which is the only reason a machine can check this at all —
// there is no jsdom in this app, so a rendering rule earns a test by being a function first.
describe('the account screen offers only the rights the visitor holds', () => {
  it('offers an anonymous visitor export, and neither control that acts on a named account', () => {
    expect(sovereignRights(true)).toEqual(['export']);
    expect(holdsRight(true, 'goAnonymous')).toBe(false);
    expect(holdsRight(true, 'erase')).toBe(false);
  });

  it('offers a named account all three', () => {
    expect(sovereignRights(false)).toEqual(['export', 'goAnonymous', 'erase']);
  });

  // The function is only the rule if the screen actually asks it. Every control in the
  // sovereignty row must be rendered under `holdsRight(...)`; a control written back in beside
  // them, or re-guarded by a hand-rolled `!anon`, is how the two designs returned last time.
  it('renders every sovereignty control under that rule and not beside it', () => {
    const src = readFileSync(join(SCREENS, 'AccountSettings.tsx'), 'utf8');
    const row = src.match(/<div className="ac-sov">([\s\S]*?)<\/div>\s*\n/);
    expect(row, 'the ac-sov row moved or was renamed — this guard is now blind').not.toBeNull();
    const controls = [...row![1].matchAll(/<button\b/g)];
    const guards = [...row![1].matchAll(/holdsRight\(anon, '/g)];
    expect(controls.length).toBe(guards.length);
    expect(controls.length).toBe(sovereignRights(false).length);
  });

  // The link the identity cell used to carry. It pointed at /account/security — a pane this app
  // does not route — so for a named visitor it was a dead end, and for an anonymous one it was a
  // dead end offering them where they already were.
  //
  // Matched as an AFFORDANCE, never per file: the first spelling of this guard excluded any file
  // containing `holdsRight(anon, 'goAnonymous')`, which is every file that could hold the
  // duplicate — the real control lives beside it. Restoring the link proved it passed. So read
  // the elements: going anonymous is an action on this page, so its one control is a button with
  // an onClick. Any ANCHOR offering it is the second affordance, whatever it links to.
  it('spells "go anonymous" as one control, and never as a link', () => {
    const anchors: string[] = [];
    const buttons: string[] = [];
    for (const [f, src] of [...sources(SCREENS), ...sources(SHELL), ...sources(COMPONENTS), ...sources(UI)]) {
      for (const [el, tag] of src.matchAll(/<(Link|a|button)\b[\s\S]*?<\/\1>/g) as Iterable<[string, string]>) {
        if (!/go anonymous/i.test(el)) continue;
        (tag === 'button' ? buttons : anchors).push(`${f}: ${el.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(anchors).toEqual([]);
    expect(buttons.length).toBe(1);
  });
});
