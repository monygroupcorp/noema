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

/** Add the `checkout` outcome flag to an app path, keeping the query it already carries — that
 *  query is often what identifies the task the buyer broke off (`/canvas?doc=17`). */
function withCheckoutFlag(path: string, outcome: 'success' | 'cancel'): string {
  // `safeReturn` has already established this is a rooted, same-origin path, so the base here
  // only supplies a host for the parser and never reaches the built URL.
  const u = new URL(path, 'https://checkout.invalid');
  u.searchParams.set('checkout', outcome);
  return u.pathname + u.search + u.hash;
}

// The checkout request sent to POST /v1/payments/checkout.
//
// Stripe returns the buyer to the page they were standing on when they reached for credits,
// carrying a `checkout` flag so the app knows to poll (the webhook credits async — the redirect
// itself carries no proof of payment). Credits are bought from the pill in the top bar, so that
// page is usually mid-task; returning everyone to /funding instead meant the shortest purchase
// still ended with a page nobody asked for and a link to press to leave it. The outcome is said
// wherever they land, by the shell that carries the balance.
//
// `returnTo` is a same-origin app path or it is dropped for /funding — the value comes back to
// us through a URL Stripe redirects to, which is exactly the position `next` is in at the door.
export function buildCheckoutRequest(
  packId: string,
  origin: string,
  returnTo?: string | null,
): { packId: string; successUrl: string; cancelUrl: string } {
  const back = safeReturn(returnTo) ? (returnTo as string) : '/funding';
  return {
    packId,
    successUrl: `${origin}${withCheckoutFlag(back, 'success')}`,
    cancelUrl: `${origin}${withCheckoutFlag(back, 'cancel')}`,
  };
}

/** A return target worth carrying: a same-origin app path, and not the Funding page — which is
 *  where a buyer with nowhere in particular to go back to already lands, and whose URL can
 *  still hold a `?pack=` that would re-start the purchase the moment Stripe returned to it. */
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
// page, which puts it into the checkout request, so a buyer who had to sign in on the way comes
// back from Stripe to the same place as one who was signed in already. Without it the return
// path is dropped at the door, and the longest version of this walk is the one that ends
// furthest from where it started.
export function signInThenBuy(packId: string, returnTo?: string | null): string {
  const back = safeReturn(returnTo) ? `&back=${encodeURIComponent(returnTo as string)}` : '';
  return doorPath(`/funding?pack=${packId}${back}`);
}
