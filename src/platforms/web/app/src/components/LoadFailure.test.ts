import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BACK, LoadFailure, loadFailureCopy, loadFailureFailed, loadFailureKind, type LoadFailureProps } from './LoadFailure';
import { ApiRequestError } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see Canvas.test.ts) — the state is
// rendered to static markup under a memory router, which is enough to read its words and its
// links. There is no session store in this process, so every render below is what a visitor
// with no session sees; the signed-in sentences are checked through loadFailureCopy. These pin
// DESIGN.md D-62 (what happened, what to do, no raw code), D-42 (one primary), D-26 (sentence
// case) and D-10 (danger only for a failed read) for the one state every record screen shares.

function html(props: Partial<LoadFailureProps> = {}): string {
  const el = createElement(LoadFailure, { noun: 'collection', kind: 'missing', back: BACK.collections, ...props });
  // Static markup escapes apostrophes; the assertions below read the words a person reads.
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/collections/sample-collection'] }, el)).replace(/&#x27;/g, "'");
}

/** How many filled buttons a render carries — D-42 says exactly one. */
function primaries(out: string): number {
  return (out.match(/class="btn"/g) ?? []).length;
}

describe('loadFailureKind — what the API said, not how it said it', () => {
  it('a not_found answer is missing: no retry will change it', () => {
    expect(loadFailureKind(new ApiRequestError('not_found.collection', "Collection 'x' not found", 404))).toBe('missing');
  });

  it('a refusal asks for a sign-in', () => {
    expect(loadFailureKind(new ApiRequestError('auth.missing', 'No credential provided', 401))).toBe('signin');
    expect(loadFailureKind(new ApiRequestError('auth.forbidden', 'Not permitted', 403))).toBe('signin');
  });

  it('everything else is transient — a server fault, a dropped connection, a read that timed out', () => {
    expect(loadFailureKind(new ApiRequestError('internal.error', 'boom', 500))).toBe('transient');
    expect(loadFailureKind(new ApiRequestError('http.404', 'That is not here.', 404))).toBe('transient');
    expect(loadFailureKind(new TypeError('Failed to fetch'))).toBe('transient');
    expect(loadFailureKind(undefined)).toBe('transient');
  });
});

describe('LoadFailure — says what happened and offers the way out (D-62)', () => {
  it('a visitor with no session is told so first, and offered the door on a missing record', () => {
    const out = html({ kind: 'missing' });
    expect(out).toContain("You're not signed in.");
    expect(out).toContain('If this collection is yours, sign in to open it.');
    // Not-found wording is for a reader who is signed in; a visitor cannot be told which it is.
    expect(out).not.toContain("doesn't exist");
    // The id is never spoken; it rides only in the door's return path (`?next=`).
    expect(out.replace(/<[^>]+>/g, ' ')).not.toContain('sample-collection');
    expect(out).toContain('href="/onboard?next=%2Fcollections%2Fsample-collection"');
    expect(out).toContain('>Sign in</a>');
    expect(out).toContain('href="/collections"');
    expect(out).toContain('Back to collections');
    expect(out).not.toContain('Try again');
  });

  it('a signed-in reader whose record is missing hears both possibilities, and is not asked to sign in', () => {
    const copy = loadFailureCopy('collection', 'missing', true);
    expect(copy.what).toBe("This collection doesn't exist, or isn't yours to open.");
    expect(copy.next).toBeNull();
  });

  it('a transient failure offers a retry and keeps the way out', () => {
    const out = html({ kind: 'transient', onRetry: () => {} });
    expect(out).toContain("This collection couldn't be loaded.");
    expect(out).toContain('Try again');
    expect(out).toContain('href="/collections"');
  });

  it('a refusal offers the door, carrying the page the visitor was on', () => {
    const out = html({ kind: 'signin', noun: 'dataset', back: BACK.datasets });
    expect(out).toContain("You're not signed in.");
    expect(out).toContain('This dataset is not open to visitors. Sign in to open it.');
    expect(out).toContain('href="/onboard?next=%2Fcollections%2Fsample-collection"');
    expect(out).toContain('Back to datasets');
  });

  it('a signed-in reader who is refused is told the record belongs to another account', () => {
    const copy = loadFailureCopy('dataset', 'signin', true);
    expect(copy.what).toBe("This dataset isn't yours to open.");
    expect(copy.next).toContain('account');
  });

  it('a failed read takes the danger frame; a door does not (D-10)', () => {
    // With no session, a missing record is a door: the app knows the visitor is not signed in,
    // not that the record is gone.
    expect(html({ kind: 'missing' })).toContain('class="load-fail"');
    expect(html({ kind: 'transient' })).toContain('class="load-fail bad"');
    expect(html({ kind: 'signin' })).toContain('class="load-fail"');
    expect(loadFailureFailed('missing', true)).toBe(true);
    expect(loadFailureFailed('signin', true)).toBe(false);
    expect(loadFailureFailed('transient', false)).toBe(true);
  });

  it('one primary action; the way back is a plain link unless it is the only action (D-42)', () => {
    const door = html({ kind: 'missing' });
    expect(primaries(door)).toBe(1);
    expect(door).toContain('class="btn" href="/onboard');
    expect(door).toContain('class="load-fail-back" href="/collections"');

    const retry = html({ kind: 'transient', onRetry: () => {} });
    expect(primaries(retry)).toBe(1);
    expect(retry).toContain('<button type="button" class="btn">Try again</button>');
    expect(retry).toContain('class="load-fail-back" href="/collections"');

    const alone = html({ kind: 'transient' });
    expect(primaries(alone)).toBe(1);
    expect(alone).toContain('class="btn" href="/collections"');
    expect(alone).not.toContain('load-fail-back');

    for (const out of [door, retry, alone]) expect(out).not.toContain('ghost');
  });

  it('the way back is sentence case: the list name is lowercase mid-label (D-26)', () => {
    for (const back of Object.values(BACK)) expect(back.label).toMatch(/^[a-z]/);
    expect(html({ back: BACK.datasets })).toContain('>Back to datasets</a>');
    expect(html({ back: BACK.home })).toContain('>Back to home</a>');
  });

  it('every sentence is sentence case with no exclamation (D-26, D-68)', () => {
    for (const kind of ['missing', 'signin', 'transient'] as const) {
      for (const signedIn of [true, false]) {
        const copy = loadFailureCopy('run', kind, signedIn);
        for (const line of [copy.what, copy.next]) {
          if (!line) continue;
          expect(line).toMatch(/^[A-Z]/);
          expect(line).not.toContain('!');
        }
      }
    }
  });
});

describe('every record screen renders the shared state with a way out', () => {
  const screens: Array<[string, string]> = [
    ['EditioHub', 'BACK.collections'],
    ['TraitsGarden', 'BACK.collections'],
    ['TraitRules', 'BACK.collections'],
    ['CanonicRun', 'BACK.collections'],
    ['Curation', 'BACK.collections'],
    ['EditioExport', 'BACK.collections'],
    ['Dataset', 'BACK.datasets'],
    ['CaptionJob', 'BACK.datasets'],
    ['Derive', 'BACK.datasets'],
    ['Muse', 'BACK.datasets'],
    ['TrainRun', 'BACK.home'],
  ];
  for (const [screen, back] of screens) {
    it(`${screen} hands a record it cannot read to LoadFailure, back to ${back}`, () => {
      const src = readFileSync(fileURLToPath(new URL(`../screens/${screen}.tsx`, import.meta.url)), 'utf8');
      expect(src).toContain('<LoadFailure ');
      expect(src).toContain(`back={${back}}`);
      expect(src).not.toMatch(/not found\./);
      expect(src).not.toContain('Couldn’t load');
    });
  }
});
