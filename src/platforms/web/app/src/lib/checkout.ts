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
export function buildCheckoutRequest(packId: string, origin: string): { packId: string; successUrl: string; cancelUrl: string } {
  return {
    packId,
    successUrl: `${origin}/funding?checkout=success`,
    cancelUrl: `${origin}/funding?checkout=cancel`,
  };
}

// Where the front door should return a visitor who tried to buy a pack without an account.
// They asked for a specific pack; sign-in hands them back to that exact purchase rather than
// to a generic landing, so choosing the pack is not a step they repeat.
export function signInThenBuy(packId: string): string {
  return `/onboard?next=${encodeURIComponent(`/funding?pack=${packId}`)}`;
}
