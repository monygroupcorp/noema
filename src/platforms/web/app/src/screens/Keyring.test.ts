import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ANON_NOTE, KeyringRow, removeLoss, type KeyringRowProps } from './Keyring';
import type { Ident } from '../lib/idents';

// No jsdom/@testing-library/react in this app's toolchain (see Canvas.test.ts) — the row is
// rendered statically. The walker only ever sees the anonymous row (it is not signed in), so
// the saved-login rows are covered here.

const named = (id: string, name: string): Ident =>
  ({ id, name, role: name, funding: 'named', glyph: name[0].toUpperCase(), bal: '12 credits', exp: '—', chipColor: '#cdd2ff' });
const anon: Ident = { id: 'anon', name: 'anonymous', role: 'bearer purse', funding: 'bearer', glyph: '◷', bal: '…', exp: '—' };

const noop = () => {};
const render = (over: Partial<KeyringRowProps>) =>
  renderToStaticMarkup(createElement(KeyringRow, {
    d: named('a1', 'alice'), active: false, confirming: false, nextName: null,
    onSwitch: noop, onRemoveAsk: noop, onRemoveConfirm: noop, onRemoveCancel: noop,
    ...over,
  }));

describe('KeyringRow — a saved login acts from its own row (REF-33)', () => {
  it('the active row shows its state and no switch control, but can still be removed', () => {
    const html = render({ active: true });
    expect(html).toContain('>active<');
    expect(html).not.toContain('kr-switch');
    expect(html).toContain('kr-remove');
    expect(html).toContain('aria-label="Remove alice from this browser"');
  });

  it('a row that is not active carries one "Switch to" control and keeps the single active pill off (D-51)', () => {
    const html = render({});
    expect(html.match(/kr-switch/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Switch to alice"');
    expect(html).not.toContain('>active<');
  });

  it('the anonymous slot can be switched to but has no remove control, and says why in its place', () => {
    const html = render({ d: anon });
    expect(html).toContain('kr-switch');
    expect(html).not.toContain('kr-remove');
    expect(html).toContain(ANON_NOTE);
    expect(html).toContain('unlinkable');
  });

  it('the active anonymous slot shows only its state and the same note', () => {
    const html = render({ d: anon, active: true });
    expect(html).toContain('>active<');
    expect(html).not.toContain('kr-switch');
    expect(html).not.toContain('kr-remove');
    expect(html).toContain(ANON_NOTE);
  });

  it('removal is two steps on the row: the second says what is lost and offers yes / keep', () => {
    const html = render({ confirming: true });
    expect(html).toContain('Remove alice from this browser?');
    expect(html).toContain('This browser forgets the login for alice');
    expect(html).toContain('kr-remove-yes');
    expect(html).toContain('kr-remove-no');
    expect(html).not.toContain('class="btn ghost kr-remove"');
  });
});

describe('removeLoss — what the second step says', () => {
  it('a login that is not active loses only its place on this browser', () => {
    const s = removeLoss('alice', false, null);
    expect(s).toContain('This browser forgets the login for alice');
    expect(s).toContain('stay as they are');
    expect(s).not.toContain('switched');
  });
  it('removing the active login also names who takes over', () => {
    expect(removeLoss('alice', true, 'bob')).toContain('You are switched to bob');
    expect(removeLoss('alice', true, null)).toContain('You are switched to the anonymous slot');
  });
});
