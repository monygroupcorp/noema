// The credits number in the top bar is the app's own statement of what you hold, and it was
// read once, when the shell mounted. Every way a credit actually lands — a card purchase
// settling, a wallet deposit confirming, a code redeemed — happens after that read, so the one
// number a funder looks at to see whether their money arrived was the one number that could not
// have changed until a reload.
//
// A tiny pub/sub, the same shape as lib/pins: whoever lands a credit says so, and the pill
// re-reads. Not a store — the balance is server-authoritative and is always fetched, never
// computed here.

const EVT = 'noema-credits-landed';

/** Announce that a credit has landed server-side. Anything showing a balance re-reads it. */
export function creditsLanded(): void {
  window.dispatchEvent(new Event(EVT));
}

/** Subscribe to credit landings. Returns the unsubscribe. */
export function onCreditsLanded(fn: () => void): () => void {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}
