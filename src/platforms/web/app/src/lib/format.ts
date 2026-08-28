// Shared credit-amount formatting (noema-361) — ONE unit word everywhere an impetus
// amount is shown. Extracted from Studio.tsx's local `cr` helper so ProposalCard and
// Studio render the exact same unit instead of drifting ("credits" vs "cr").
export function formatImpetus(impetus: string | number): string {
  return `${Number(impetus).toLocaleString()} cr`;
}

// The proposal quote's shape (mirrors api.ts's ConciergeQuote) — kept structural here
// so this module (a plain .ts file, unlike the .tsx components that call it) needs no
// JSX-aware typecheck program to compile.
export interface QuoteLike { impetus: string; recipient: string }

// Pure formatting for a proposal's authoritative quote (noema-361): the amount always
// carries its unit (via formatImpetus), and the recipient (the zk spend-proof binding,
// not a customer identifier) is reduced to a short, labeled secondary detail rather
// than a raw hash jammed beside the price.
export function formatQuote(quote: QuoteLike): { amount: string; recipientShort: string } {
  const amount = formatImpetus(quote.impetus);
  const r = quote.recipient;
  const recipientShort = r.length > 10 ? `${r.slice(0, 6)}…${r.slice(-4)}` : r;
  return { amount, recipientShort };
}
