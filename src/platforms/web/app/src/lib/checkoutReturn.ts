import { useEffect, useState } from 'react';
import { api } from './api';
import { creditsLanded } from './balance';

// Coming back from Stripe. The buyer lands on whatever page they left from (see
// lib/checkout), so the outcome cannot be the Funding screen's business any more — it is the
// shell's, which rides every app surface. One owner, so the four things that can happen to
// someone's money are said in one voice wherever they land.

export type CheckoutOutcome = 'none' | 'polling' | 'settled' | 'timeout' | 'cancelled';

const POLL_MS = 3_000;
/** How long the page watches for a webhook-driven credit before saying it stopped. */
export const GIVE_UP_MS = 5 * 60_000;

/** The outcome Stripe redirected back with, or null if this is an ordinary page load. */
export function readCheckoutFlag(search: string): 'success' | 'cancel' | null {
  const flag = new URLSearchParams(search).get('checkout');
  return flag === 'success' || flag === 'cancel' ? flag : null;
}

/**
 * Drop the `checkout` flag and nothing else, so a refresh neither re-polls nor re-announces an
 * old return. Only that one parameter goes: the rest of the query is the page's own — a
 * `/canvas?doc=17` that came back as `?doc=17&checkout=success` is still that document.
 */
export function stripCheckoutFlag(href: string): string {
  const u = new URL(href);
  u.searchParams.delete('checkout');
  return u.pathname + u.search + u.hash;
}

// The outcome belongs to this PAGE LOAD, not to a component's lifetime — so it is taken once
// and the URL cleaned once. Reading it inside the effect instead meant the effect's second run
// (StrictMode's deliberate remount, and any future remount of the shell) looked at a URL the
// first run had already cleaned, concluded nothing had happened, and started no poll — while
// the first run's "waiting for the credit to land…" stayed on screen, watched by nothing. That
// is the same silence this whole return path exists to remove.
let taken: 'success' | 'cancel' | null | undefined;

/** The outcome this page load arrived with, read once and cleared from the URL. */
export function takeCheckoutFlag(): 'success' | 'cancel' | null {
  if (taken === undefined) {
    taken = readCheckoutFlag(window.location.search);
    if (taken) window.history.replaceState({}, '', stripCheckoutFlag(window.location.href));
  }
  return taken;
}

/**
 * Watch for the credit to land. The webhook credits asynchronously, so the redirect itself is
 * not proof: poll the balance until it moves, and end on a state that has words for it —
 * settled, or watched-and-gave-up. Never a spinner with nothing behind it.
 */
export function useCheckoutReturn(): {
  outcome: CheckoutOutcome;
  credited: number | null;
  dismiss: () => void;
} {
  const [outcome, setOutcome] = useState<CheckoutOutcome>('none');
  const [credited, setCredited] = useState<number | null>(null);

  useEffect(() => {
    const flag = takeCheckoutFlag();
    if (!flag) return;
    // Backing out of Stripe returns here too, and nothing was charged. Say so.
    if (flag === 'cancel') { setOutcome('cancelled'); return; }

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setOutcome('polling');
    const start = Date.now();
    let baseline: number | null = null;
    const again = () => {
      if (Date.now() - start < GIVE_UP_MS) timer = setTimeout(poll, POLL_MS);
      else setOutcome('timeout');
    };
    const poll = () => {
      if (!live) return;
      api.meStatus().then((s) => {
        if (!live) return;
        const bal = Number(s.balanceImpetus);
        if (baseline == null) baseline = bal;
        else if (bal > baseline) {
          setCredited(bal - baseline);
          setOutcome('settled');
          creditsLanded();
          return;
        }
        again();
      }).catch(() => { if (live) again(); });
    };
    poll();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, []);

  return { outcome, credited, dismiss: () => setOutcome('none') };
}
