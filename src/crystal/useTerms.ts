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
    versio: '2026-11-14',
    nomen: 'MiniMax H3 use restrictions',
    href: '/legal/terms#11-minimax-h3-additional-terms',
    licenseHref: '/legal/minimax-h3-license',
    // Two, not one: a first confirmed violation is met by removing the content and a warning;
    // the second makes the user a repeat violator. A violation that warrants immediate
    // termination on its own (Section 9 of the terms) is handled by termination, not by strikes.
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

/** How many linked flows (steps and saved-from parents) are read when collecting terms. Real
 *  lineages are a handful of links; the bound only keeps a pathological stored definition from
 *  hanging the run entry point. */
const MAX_LINKS = 64

/** Stands in for terms that could not be collected because the lineage ran past `MAX_LINKS`. It
 *  names no published terms, so a flow carrying it is refused (`unknown`) — the walk fails
 *  CLOSED: a chain too long to read is never taken to carry no terms. */
export const UNRESOLVED_LINEAGE = 'unresolved-lineage'

/**
 * Every terms id a modus carries: its own declaration, its steps' for a composite, and its
 * parent's for a saved flow (`fonte`), followed all the way up. A composite whose step runs
 * MiniMax H3 binds its caller exactly as running H3 directly does, and the steps dispatch
 * internally, below the run entry point, so they are collected here. A flow a user saved from H3
 * runs H3's weights; following `fonte` holds it — and anything saved from it in turn — to H3's
 * terms even when it was saved before the parent declared them.
 */
export async function requiredUseTerms(
  modus: Pick<Modus, 'useTerms' | 'gradus' | 'fonte'> | null | undefined,
  find: (id: string) => Promise<Pick<Modus, 'useTerms' | 'gradus' | 'fonte'> | null>,
): Promise<string[]> {
  const out = new Set<string>()
  const seen = new Set<string>()
  const queue: Array<Pick<Modus, 'useTerms' | 'gradus' | 'fonte'> | null | undefined> = [modus]
  while (queue.length > 0) {
    const m = queue.shift()
    if (!m) continue
    for (const id of m.useTerms ?? []) out.add(id)
    for (const next of [...(m.fonte ? [m.fonte] : []), ...(m.gradus ?? []).map(g => g.modusId)]) {
      if (seen.has(next)) continue
      if (seen.size >= MAX_LINKS) { out.add(UNRESOLVED_LINEAGE); return [...out] }
      seen.add(next)
      queue.push(await find(next))
    }
  }
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
  modus: Pick<Modus, 'useTerms' | 'gradus' | 'fonte'> | null | undefined
  find: (id: string) => Promise<Pick<Modus, 'useTerms' | 'gradus' | 'fonte'> | null>
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

/**
 * Wrap a dispatcher so every run it starts is held to its flow's licence terms under the run's
 * own `by`. For runs that start below the run entry point, such as the pieces a collection
 * cursor dispatches tick by tick: a funder suspended mid-collection gets no further pieces, and
 * a collection fired before its flow declared terms gets none until the funder accepts. A
 * refused run throws before `dispatch` is called, so nothing is initiated or reserved. An
 * arcanum-proof spender has no account to accept on, so a terms-bearing flow is refused for it.
 */
export function gateDispatch<I extends { modusId: string; by: object }, R>(
  dispatch: (inc: I) => Promise<R>,
  deps: {
    find: (id: string) => Promise<Pick<Modus, 'useTerms' | 'gradus' | 'fonte'> | null>
    accepted: (by: I['by']) => Promise<Record<string, TermsAcceptance> | undefined>
    strikes: (by: I['by'], termsId: string) => Promise<number>
  },
): (inc: I) => Promise<R> {
  return async (inc) => {
    const anonymousProof = 'arcanumProof' in inc.by
    const verdict = await useTermsVerdict({
      modus: await deps.find(inc.modusId),
      find: deps.find,
      accepted: async () => (anonymousProof ? undefined : deps.accepted(inc.by)),
      ...(anonymousProof ? {} : { strikes: (id: string) => deps.strikes(inc.by, id) }),
    })
    if (!verdict.ok) throw new Error(`run refused under licence terms (${verdict.reason})`)
    return dispatch(inc)
  }
}
