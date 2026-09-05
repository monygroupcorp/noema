import { describe, expect, it } from 'vitest';
import { buildCheckoutRequest, canCheckout, signInThenBuy } from './checkout';

// No jsdom/@testing-library/react in this app's toolchain, so this covers the card rail's pure
// logic. Both surfaces that can start a checkout — the Funding page and the buy-credits modal
// behind the credits pill — build their request through these, so they cannot drift apart.

describe('buildCheckoutRequest', () => {
  it('carries the exact pack id — never a client-computed credit figure', () => {
    expect(buildCheckoutRequest('standard_25', 'https://noema.example').packId).toBe('standard_25');
  });

  it('points success/cancel back at /funding with a checkout flag', () => {
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

describe('signInThenBuy — the door returns you to the pack you picked', () => {
  it('sends the visitor to the door carrying the purchase they started', () => {
    expect(signInThenBuy('creator_100')).toBe('/onboard?next=%2Ffunding%3Fpack%3Dcreator_100');
  });

  it('round-trips to the funding page for that exact pack', () => {
    const url = new URL(signInThenBuy('plus_50'), 'https://noema.example');
    expect(url.searchParams.get('next')).toBe('/funding?pack=plus_50');
  });
});
