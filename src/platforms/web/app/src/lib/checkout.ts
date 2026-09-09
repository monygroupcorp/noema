import { doorPath } from './entry';

// The card rail's shared request shape. Both surfaces that can start a Stripe checkout — the
// Funding page's pack row and the buy-credits modal reachable from the credits pill — build the
// request here, so the two agree on where Stripe returns you and on who is allowed to start.

// Identified-account gate for the fiat rail: a card purchase requires a signed-in anima
// (client_reference_id = animaId) — an anon/purse-only caller is 401'd server-side, so we
// send them to the door instead of ever starting checkout for one.
export function canCheckout(session: unknown): boolean {
  return session != null;
}

// The checkout request sent to POST /v1/payments/checkout. successUrl/cancelUrl point back at
// the Funding page with a `checkout` query flag so we know to poll on return (Stripe's webhook
// credits async — the redirect itself carries no proof of payment).
//
// `returnTo` is the page the visitor was actually on when they decided to buy. Credits are
// bought from the pill in the top bar, so the usual buyer is mid-task somewhere else and Stripe
// returns everyone to /funding; carrying the page lets the return offer the way back instead of
// leaving them to re-find it. It is a same-origin app path or it is dropped — the value comes
// back to us through a URL Stripe redirects to, which is exactly the position `next` is in at
// the door.
export function buildCheckoutRequest(
  packId: string,
  origin: string,
  returnTo?: string | null,
): { packId: string; successUrl: string; cancelUrl: string } {
  const back = safeReturn(returnTo) ? `&back=${encodeURIComponent(returnTo as string)}` : '';
  return {
    packId,
    successUrl: `${origin}/funding?checkout=success${back}`,
    cancelUrl: `${origin}/funding?checkout=cancel${back}`,
  };
}

/** A return target worth carrying: a same-origin app path, and not the Funding page itself —
 *  offering "back to Funding" to someone standing on Funding is a link to nowhere. */
export function safeReturn(returnTo: string | null | undefined): boolean {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return false;
  return !returnTo.split('?')[0].replace(/\/$/, '').endsWith('/funding');
}

// Where the front door should return a visitor who tried to buy a pack without an account.
// They asked for a specific pack; sign-in hands them back to that exact purchase rather than
// to a generic landing, so choosing the pack is not a step they repeat.
//
// `returnTo` is the page they were standing on when they reached for credits — the pill opens
// the buy modal anywhere in the app, so that is usually mid-task. It rides along to the funding
// page, which puts it into the checkout request, so a buyer who had to sign in on the way is
// offered the same way back from Stripe as one who was signed in already. Without it the return
// path is dropped at the door, and the longest version of this walk is the one that ends
// furthest from where it started.
export function signInThenBuy(packId: string, returnTo?: string | null): string {
  const back = safeReturn(returnTo) ? `&back=${encodeURIComponent(returnTo as string)}` : '';
  return doorPath(`/funding?pack=${packId}${back}`);
}
