import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { ApiRequestError, READ_TIMEOUT_MESSAGE } from '../lib/api';
import { describeLoadFailure, FlowLoadNotice } from './CardLoad';

// DESIGN.md D-62: a loading state is never terminal. Once the flow read fails, the card says
// what happened and offers the way out — never "Loading…" with nothing behind it. Rendered as
// static markup (react-dom/server): this toolchain has no DOM.

const render = (failure: ReturnType<typeof describeLoadFailure> | null) =>
  renderToStaticMarkup(
    createElement(StaticRouter, { location: '/card?id=flux-schnell' },
      createElement(FlowLoadNotice, { failure, id: 'flux-schnell', onRetry: () => {} })),
  );

describe('describeLoadFailure', () => {
  it('keeps the sentence the API lib wrote, and reads 401/403 as "sign in"', () => {
    const gated = describeLoadFailure(new ApiRequestError('http.401', 'You are not signed in, or not allowed to see this.', 401));
    expect(gated).toEqual({ reason: 'You are not signed in, or not allowed to see this.', needsSignIn: true });
    expect(describeLoadFailure(new ApiRequestError('http.403', 'no', 403)).needsSignIn).toBe(true);
  });

  it('treats a 404, a 500 and a timed-out read as failures that are not about sign-in', () => {
    expect(describeLoadFailure(new ApiRequestError('http.404', 'That is not here.', 404)).needsSignIn).toBe(false);
    expect(describeLoadFailure(new ApiRequestError('http.500', 'The server had a problem.', 500)).needsSignIn).toBe(false);
    const timedOut = describeLoadFailure(new Error(READ_TIMEOUT_MESSAGE));
    expect(timedOut).toEqual({ reason: READ_TIMEOUT_MESSAGE, needsSignIn: false });
  });

  it('never leaks a raw body: the reason is the error message, nothing else', () => {
    const e = new ApiRequestError('transport.not_json', 'The server did not answer with data.', 200, undefined, '<html>…</html>');
    expect(describeLoadFailure(e).reason).not.toContain('<html>');
  });
});

describe('FlowLoadNotice', () => {
  it('while the read is in flight, holds the panel and says what is loading', () => {
    const html = render(null);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Loading the run panel');
  });

  it('after a failed read, is never a loading state: it says what happened and gives the way out', () => {
    const html = render(describeLoadFailure(new ApiRequestError('http.500', 'The server had a problem. It is not something you did.', 500)));
    expect(html).not.toContain('Loading');
    expect(html).not.toContain('aria-busy');
    expect(html).toContain('role="alert"');
    expect(html).toContain('did not load');
    expect(html).toContain('The server had a problem. It is not something you did.');
    expect(html).toContain('Try again');
    expect(html).toContain('href="/catalog"');
  });

  it('after a timed-out read, the same: the deadline is a failure with a way out, not silence', () => {
    const html = render(describeLoadFailure(new Error(READ_TIMEOUT_MESSAGE)));
    expect(html).not.toContain('Loading');
    expect(html).toContain('Try again');
  });

  it('when the server gated the flow, says so and offers sign-in that returns to this card', () => {
    const html = render(describeLoadFailure(new ApiRequestError('http.401', 'You are not signed in, or not allowed to see this.', 401)));
    expect(html).not.toContain('Loading');
    expect(html).toContain('needs a signed-in account');
    expect(html).toContain('Sign in');
    expect(html).toContain('href="/onboard?next=%2Fcard%3Fid%3Dflux-schnell"');
    expect(html).toContain('href="/catalog"');
  });
});
