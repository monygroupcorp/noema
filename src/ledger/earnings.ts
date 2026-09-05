// =============================================================================
// EARNINGS — which ledger entries mean "someone was paid for their own work".
// =============================================================================
//
// Every credit on the Signorum ledger carries an `auctor` naming what issued it.
// Most are money the account put IN (a deposit, a purchase, a refund) or money the
// platform books for itself. A handful are something else: value that flowed to a
// person BECAUSE SOMEONE ELSE RAN SOMETHING. Those are earnings, and they are the
// only rows an earnings read may report — a deposit is not an earning, and neither
// is the platform's own skim.
//
// The list below is the whole of it. Each entry names the hook that mints the
// auctor, and `tests/unit/ledger/earningAuctors.test.ts` runs those hooks and
// fails if one ever emits an auctor this file does not know — so a new earning
// stream cannot ship invisible to the earner.

/** What kind of work an earning paid for — the earner-facing name of one stream. */
export type EarningKind =
  /** The author of the flow that ran (`spellRoyaltyHook`, 10% of impetus). */
  | 'spell-royalty'
  /** An author of a model the run used (`modelRoyaltyHook`, 5% split by rights weight). */
  | 'model-royalty'
  /** The host of the pod a guest gen ran on (`hostCutHook`, 20% of base impetus). */
  | 'host-cut'
  /** The ambassador bonus from a guest's warm surcharge (`hospitiumHook`). */
  | 'host-bonus'
  /** A share of a referred account's deposit (`referralSplitHook`, 5%). */
  | 'referral'

/** auctor → the stream it belongs to. The allowlist an earnings read filters on. */
export const EARNING_AUCTORS: Readonly<Record<string, EarningKind>> = Object.freeze({
  'nexus:spellRoyalty': 'spell-royalty',
  'nexus:modelRoyalty': 'model-royalty',
  'nexus:hostCut': 'host-cut',
  'nexus:hospitium': 'host-bonus',
  'nexus:referralSplit': 'referral',
})

/** The auctor values an earnings query matches on — the `$in` set. */
export const EARNING_AUCTOR_IDS: readonly string[] = Object.freeze(Object.keys(EARNING_AUCTORS))

/** The stream one auctor belongs to, or `undefined` when it is not an earning at all. */
export function earningKind(auctor: string): EarningKind | undefined {
  return EARNING_AUCTORS[auctor]
}

/** Display order for a breakdown — royalties first (what the earner published), then
 *  hosting (what their hardware served), then referral. Stable regardless of amounts. */
export const EARNING_KIND_ORDER: readonly EarningKind[] = Object.freeze([
  'spell-royalty', 'model-royalty', 'host-cut', 'host-bonus', 'referral',
])
