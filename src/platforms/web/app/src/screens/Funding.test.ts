import { describe, expect, it } from 'vitest';
import { buildCheckoutRequest, canCheckout } from './Funding';

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

describe('canCheckout — the identified-account gate', () => {
  it('rejects an anon/purse caller (no session)', () => {
    expect(canCheckout(null)).toBe(false);
    expect(canCheckout(undefined)).toBe(false);
  });

  it('allows an identified caller (a session object)', () => {
    expect(canCheckout({ token: 't', animaId: 'a1' })).toBe(true);
  });
});
