import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildCheckoutRequest, canCheckout, FundingHead, WAYS_IN } from './Funding';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the fiat-pack rail's pure logic rather than a full DOM render. The pack
// numbers are no longer a frontend constant: they come from GET /v1/payments/packs (the single
// server catalog), verified in the backend packCatalog test.

describe('buildCheckoutRequest', () => {
  it('carries the exact pack id — never a client-computed credit figure', () => {
    const req = buildCheckoutRequest('standard_25', 'https://noema.example');
    expect(req.packId).toBe('standard_25');
  });

  it('points success/cancel back at /funding with a checkout flag', () => {
    const req = buildCheckoutRequest('starter_10', 'https://noema.example');
    expect(req.successUrl).toBe('https://noema.example/funding?checkout=success');
    expect(req.cancelUrl).toBe('https://noema.example/funding?checkout=cancel');
  });
});

describe('the funding screen lists both ways in', () => {
  it('is headed by its name, with the card and the wallet named in the line beneath', () => {
    const html = renderToStaticMarkup(createElement(FundingHead));
    expect(html).toContain('<h1>Funding</h1>');
    expect(WAYS_IN.map((w) => w.title)).toEqual(['Card', 'On-chain wallet']);
    for (const w of WAYS_IN) expect(html.toLowerCase()).toContain(w.title.toLowerCase());
    expect(html.toLowerCase()).not.toContain('coming soon');
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
