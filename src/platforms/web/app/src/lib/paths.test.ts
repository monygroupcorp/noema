import { describe, expect, it } from 'vitest';
import { buildCheckoutRequest, signInThenBuy } from './checkout';
import { readCheckoutFlag, stripCheckoutFlag } from './checkoutReturn';
import { doorPath } from './entry';
import { safeNext } from '../screens/Onboard';

// The two paths a new visitor walks — getting a session, and getting credits — counted by
// composing the functions that actually route them, rather than by anyone's recollection of
// the screens. Each `itinerary` below is every URL the browser stands on from the first click
// to the last, so its LENGTH is the count, and a step reappearing in either path fails a test
// here before anyone has to walk it again.
//
// Only our own surfaces are counted. Stripe's hosted page is one entry because that is what it
// is to the buyer: somewhere else they go and come back from.

const ORIGIN = 'https://noema.example';
const rel = (url: string) => url.replace(ORIGIN, '');

describe('signing in — what a visitor crosses to get a session', () => {
  it('is the marketing page, the door, and the app: three surfaces, one form', () => {
    // `entryPath()` answers '/onboard' for a browser that holds no login and carries no
    // onboarded flag — the state of one that has never been here (see entry.test.ts).
    const itinerary = ['/', '/onboard', '/app'];
    expect(itinerary).toHaveLength(3);
    expect(itinerary).not.toContain('/keyring');   // the door lands in the app, not on a list of logins
  });

  it('adds no page to a visitor stopped mid-task — the door returns them to it', () => {
    const stopped = '/canvas?doc=17';
    const door = doorPath(stopped);
    const back = safeNext(new URL(door, ORIGIN).searchParams.get('next'));
    expect([stopped, door, back]).toEqual([stopped, '/onboard?next=%2Fcanvas%3Fdoc%3D17', stopped]);
    // They end where they began: the door is the only page the interruption cost them.
    expect(back).toBe(stopped);
  });
});

describe('funding — what a buyer crosses to turn a card into credits', () => {
  it('is two surfaces and Stripe for a buyer who already has an account', () => {
    const standingOn = '/canvas?doc=17';
    // The credits pill opens the buy modal over the page — no navigation — and a pack chip
    // posts the checkout and leaves.
    const req = buildCheckoutRequest('plus_50', ORIGIN, standingOn);
    const itinerary = [standingOn, 'stripe', rel(req.successUrl)];
    expect(itinerary).toEqual(['/canvas?doc=17', 'stripe', '/canvas?doc=17&checkout=success']);
    expect(itinerary).toHaveLength(3);
  });

  it('costs a buyer with no account exactly one more surface: the door', () => {
    const standingOn = '/canvas?doc=17';
    const door = signInThenBuy('plus_50', standingOn);
    // The door holds the pack and the page. It starts the checkout itself once the account is
    // live, so nothing stands between the door and Stripe.
    const q = new URL(door, ORIGIN).searchParams;
    const req = buildCheckoutRequest(q.get('buy') as string, ORIGIN, safeNext(q.get('next')));
    const itinerary = [standingOn, door, 'stripe', rel(req.successUrl)];
    expect(itinerary).toEqual([
      '/canvas?doc=17',
      '/onboard?next=%2Fcanvas%3Fdoc%3D17&buy=plus_50',
      'stripe',
      '/canvas?doc=17&checkout=success',
    ]);
    expect(itinerary).toHaveLength(4);
    // The page this walk used to detour through, to be told what it already knew.
    expect(itinerary.join(' ')).not.toContain('/funding');
  });

  it('ends on the page it started from, holding what that page was working on', () => {
    const req = buildCheckoutRequest('plus_50', ORIGIN, '/canvas?doc=17');
    const landed = new URL(req.successUrl);
    expect(readCheckoutFlag(landed.search)).toBe('success');
    // And once the outcome has been said, the URL is the task's again — not a step back to it.
    expect(stripCheckoutFlag(req.successUrl)).toBe('/canvas?doc=17');
  });

  it('sends a buyer from the pricing page to the same two places and no others', () => {
    // /pricing's Buy links at /funding?pack=<id>; that page resumes the purchase rather than
    // asking for it again — starting the checkout, or taking an anon buyer to the door with the
    // pack in hand. Either way it is passed through, never stopped on.
    const fromPricing = '/pricing';
    const signedIn = [fromPricing, '/funding?pack=plus_50', 'stripe', '/funding?checkout=success'];
    const anon = [fromPricing, '/funding?pack=plus_50', signInThenBuy('plus_50'), 'stripe', '/funding?checkout=success'];
    expect(signInThenBuy('plus_50')).toBe('/onboard?buy=plus_50');
    expect(rel(buildCheckoutRequest('plus_50', ORIGIN).successUrl)).toBe('/funding?checkout=success');
    // One surface between the two of them: the door, and only for the buyer who needs one.
    expect(anon.length - signedIn.length).toBe(1);
  });
});
