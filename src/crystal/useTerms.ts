// =============================================================================
// useTerms — upstream licence terms a user must accept before running a flow
// =============================================================================
//
// Some model licences do not stop at "you may use this": they require us to bind every user to
// terms at least as protective as the licence's own use restrictions, before that user gets
// access. MiniMax H3's Community License says so in Section V.2, and Section V.5 adds a reporting
// mechanism and the suspension of repeat violators. `licenseNote` in `modelLicense.ts` answers
// "may this be listed"; this answers "what must the person running it have agreed to".
//
// A flow DECLARES the terms it carries (`Modus.useTerms`), the same way a port declares its
// legality. The run entry point reads the declaration, refuses a caller who has not accepted the
// current version, and refuses a caller suspended under those terms. Both refusals sit above the
// reservation, so a refused run costs nothing.
//
// VERSIONING. Acceptance is recorded against a `versio`. Bumping it here (a material change to
// the published flow-down section) makes every earlier acceptance stale, so each user accepts the
// new text before their next run. Do not bump it for a wording fix that changes no obligation.
// =============================================================================

import type { Modus } from '../types/modus.js'

export interface UseTerms {
  id: string
  /** The version a recorded acceptance must match. Date of the published section it names. */
  versio: string
  /** What the user is agreeing to, in one line — shown above the accept control. */
  nomen: string
  /** Where the published terms live, relative to the site root. */
  href: string
  /** The upstream licence these terms flow down from. */
  licenseHref: string
  /** Confirmed violations under these terms at which a user is suspended from them. */
  strikeLimit: number
}

export const USE_TERMS: Record<string, UseTerms> = {
  'minimax-h3': {
    id: 'minimax-h3',
    versio: '2026-11-13',
    nomen: 'MiniMax H3 use restrictions',
    href: '/legal/terms#11-minimax-h3-additional-terms',
    licenseHref: '/legal/minimax-h3-license',
    // Two, not one: a first confirmed violation is met by removing the content and a warning;
    // the second makes the user a repeat violator. A violation that warrants immediate
    // termination on its own (Section 3 of the terms) is handled by termination, not by strikes.
    strikeLimit: 2,
  },
}

/** The terms record for an id, or undefined for an id this deployment does not know. */
export function lookupUseTerms(id: string): UseTerms | undefined {
  return USE_TERMS[id]
}

/** A recorded acceptance, as `Generatio.termsAccepted` stores it. */
export interface TermsAcceptance {
  versio: string
  acceptedAt: number
}

/** True when `accepted` covers the CURRENT version of terms `id`. An unknown id is never covered:
 *  a flow that declares terms this deployment cannot show must not run. */
export function isAccepted(id: string, accepted: Record<string, TermsAcceptance> | undefined): boolean {
  const terms = USE_TERMS[id]
  if (!terms) return false
  return accepted?.[id]?.versio === terms.versio
}

/** How deep a composite is followed when collecting terms. Composites nest rarely; a cycle in a
 *  stored definition must not hang the run entry point. */
const MAX_DEPTH = 4

/**
 * Every terms id a modus carries: its own declaration plus, for a composite, its steps'. A
 * composite whose step runs MiniMax H3 binds its caller exactly as running H3 directly does,
 * and the steps dispatch internally, below the run entry point, so they are collected here.
 */
export async function requiredUseTerms(
  modus: Pick<Modus, 'useTerms' | 'gradus'> | null | undefined,
  find: (id: string) => Promise<Pick<Modus, 'useTerms' | 'gradus'> | null>,
): Promise<string[]> {
  const out = new Set<string>()
  const seen = new Set<string>()
  async function walk(m: Pick<Modus, 'useTerms' | 'gradus'> | null | undefined, depth: number): Promise<void> {
    if (!m) return
    for (const id of m.useTerms ?? []) out.add(id)
    if (depth >= MAX_DEPTH) return
    for (const g of m.gradus ?? []) {
      if (seen.has(g.modusId)) continue
      seen.add(g.modusId)
      await walk(await find(g.modusId), depth + 1)
    }
  }
  await walk(modus, 0)
  return [...out]
}

/** Why a caller may not run a terms-bearing flow, or that they may. */
export type UseTermsVerdict =
  | { ok: true }
  | { ok: false; reason: 'required'; terms: UseTerms }
  | { ok: false; reason: 'unknown'; termsId: string }
  | { ok: false; reason: 'suspended'; terms: UseTerms }

/**
 * May this caller run this flow, as far as its licence terms go? The one question every entry
 * point that starts a run asks — the REST run route, the chat flow and a collection fire — so
 * all three refuse the same callers for the same reasons. A flow declaring no terms is `ok`
 * before any store is read.
 *
 * FAIL-CLOSED on acceptance: no `accepted` record means not accepted. Suspension reads the
 * strike count only when a counter is supplied; without one no caller counts as suspended.
 */
export async function useTermsVerdict(args: {
  modus: Pick<Modus, 'useTerms' | 'gradus'> | null | undefined
  find: (id: string) => Promise<Pick<Modus, 'useTerms' | 'gradus'> | null>
  accepted: () => Promise<Record<string, TermsAcceptance> | undefined>
  /** Confirmed violations under terms `id` for this caller. */
  strikes?: (id: string) => Promise<number>
}): Promise<UseTermsVerdict> {
  const ids = await requiredUseTerms(args.modus, args.find)
  if (ids.length === 0) return { ok: true }
  const accepted = await args.accepted()
  for (const id of ids) {
    const terms = USE_TERMS[id]
    if (!terms) return { ok: false, reason: 'unknown', termsId: id }
    if (!isAccepted(id, accepted)) return { ok: false, reason: 'required', terms }
    if (args.strikes && (await args.strikes(id)) >= terms.strikeLimit) return { ok: false, reason: 'suspended', terms }
  }
  return { ok: true }
}
