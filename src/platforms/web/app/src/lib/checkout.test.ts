import { describe, expect, it } from 'vitest';
import { buildCheckoutRequest, canCheckout, safeReturn, signInThenBuy } from './checkout';

// No jsdom/@testing-library/react in this app's toolchain, so this covers the card rail's pure
// logic. Both surfaces that can start a checkout — the Funding page and the buy-credits modal
// behind the credits pill — build their request through these, so they cannot drift apart.

describe('buildCheckoutRequest', () => {
  it('carries the exact pack id — never a client-computed credit figure', () => {
    expect(buildCheckoutRequest('standard_25', 'https://noema.example').packId).toBe('standard_25');
  });

  it('falls back to /funding when the buyer came from nowhere in particular', () => {
    const req = buildCheckoutRequest('starter_10', 'https://noema.example');
    expect(req.successUrl).toBe('https://noema.example/funding?checkout=success');
    expect(req.cancelUrl).toBe('https://noema.example/funding?checkout=cancel');
  });

  it('carries no pack param back, so returning from Stripe cannot re-start the purchase', () => {
    const req = buildCheckoutRequest('plus_50', 'https://noema.example');
    expect(req.successUrl).not.toContain('pack=');
    expect(req.cancelUrl).not.toContain('pack=');
  });
});

describe('canCheckout — the identified-account gate', () => {
  it('rejects an anon/purse caller (no session)', () => {
    expect(canCheckout(null)).toBe(false);
    expect(canCheckout(undefined)).toBe(false);
  });

  it('allows an identified caller (a session object)', () => {
    expect(canCheckout({ token: 't', animaId: 'a1' })).toBe(true);
  });
});

describe('signInThenBuy — the door finishes the purchase it interrupted', () => {
  it('sends the visitor to the door carrying the pack, and nowhere in between', () => {
    expect(signInThenBuy('creator_100')).toBe('/onboard?buy=creator_100');
  });

  it('names no intermediate page — the door starts the checkout itself', () => {
    const url = new URL(signInThenBuy('plus_50', '/canvas?doc=17'), 'https://noema.example');
    expect(url.pathname).toBe('/onboard');
    expect(url.searchParams.get('buy')).toBe('plus_50');
    expect(url.searchParams.get('next')).not.toContain('/funding');
  });
});

describe('buildCheckoutRequest — Stripe returns you to where you were', () => {
  it('returns to the page the buyer left, on both outcomes — not to a page nobody asked for', () => {
    const req = buildCheckoutRequest('plus_50', 'https://noema.example', '/app');
    expect(req.successUrl).toBe('https://noema.example/app?checkout=success');
    expect(req.cancelUrl).toBe('https://noema.example/app?checkout=cancel');
  });

  it('keeps the query of the page it came from — a task is often identified by it', () => {
    const url = new URL(buildCheckoutRequest('plus_50', 'https://noema.example', '/canvas?doc=17').successUrl);
    expect(url.pathname).toBe('/canvas');
    expect(url.searchParams.get('doc')).toBe('17');
    expect(url.searchParams.get('checkout')).toBe('success');
  });

  it('refuses an off-site return — the value comes back through a URL Stripe redirects to', () => {
    for (const evil of ['https://evil.example', '//evil.example', 'app']) {
      expect(buildCheckoutRequest('plus_50', 'https://noema.example', evil).successUrl)
        .toBe('https://noema.example/funding?checkout=success');
    }
  });

  it('never returns to a /funding URL holding a pack, which would re-start the purchase', () => {
    const req = buildCheckoutRequest('plus_50', 'https://noema.example', '/funding?pack=plus_50');
    expect(req.successUrl).toBe('https://noema.example/funding?checkout=success');
    expect(req.successUrl).not.toContain('pack=');
  });
});

describe('safeReturn — what is worth carrying through Stripe', () => {
  it('accepts a same-origin app path', () => {
    expect(safeReturn('/app')).toBe(true);
    expect(safeReturn('/canvas?doc=17')).toBe(true);
  });

  it('drops an off-site URL — the value returns through a URL Stripe redirects to', () => {
    expect(safeReturn('https://evil.example')).toBe(false);
    expect(safeReturn('//evil.example')).toBe(false);
    expect(safeReturn('app')).toBe(false);
  });

  it('drops the funding page itself, which is where a return with nowhere to go already lands', () => {
    expect(safeReturn('/funding')).toBe(false);
    expect(safeReturn('/funding?pack=plus_50')).toBe(false);
  });

  it('drops a missing value rather than inventing a destination', () => {
    expect(safeReturn(null)).toBe(false);
    expect(safeReturn(undefined)).toBe(false);
    expect(safeReturn('')).toBe(false);
  });
});

describe('signInThenBuy — the page they came from survives the door', () => {
  it('carries the page as the door\'s own next, which is what Stripe returns them to', () => {
    const url = new URL(signInThenBuy('plus_50', '/canvas?doc=17'), 'https://noema.example');
    expect(url.searchParams.get('next')).toBe('/canvas?doc=17');
  });

  it('drops an off-site return the same way the checkout request does', () => {
    expect(signInThenBuy('plus_50', 'https://evil.example')).toBe('/onboard?buy=plus_50');
    expect(signInThenBuy('plus_50', '//evil.example')).toBe('/onboard?buy=plus_50');
  });

  it('drops the funding page itself — a return with nowhere to go already lands there', () => {
    expect(signInThenBuy('plus_50', '/funding')).toBe('/onboard?buy=plus_50');
  });

  it('escapes a pack id rather than letting it open a second query parameter', () => {
    const url = new URL(signInThenBuy('a&next=/evil'), 'https://noema.example');
    expect(url.searchParams.get('buy')).toBe('a&next=/evil');
    expect(url.searchParams.get('next')).toBeNull();
  });
});
