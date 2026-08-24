// =============================================================================
// MUSE → COLLECTION — the promotion mapping
// =============================================================================
//
// A Muse session is a collection played transiently: a floor of decomposed
// prompt fragments, a nozzle, a standing affix and a flow. A collection is the
// durable form of the same thing — a base aditus expanded over a `Tractus[]`
// grid. Promotion is therefore a MAPPING and not a new authoring surface: the
// garden as the user left it becomes the grid, and everything the session
// cannot supply (supply count, review flag, DNA) is finished in the collection
// funnel the draft lands in.
//
// PURE, AND DELIBERATELY SO. Nothing here reads a store, resolves an owner or
// mints anything. `CrystalApi.promoteMuseSession` resolves the session against
// the authenticated caller, hands this function the session VALUE, and passes
// the result to `collect` — so the mapping can be asserted field by field
// without an API, and there is no path by which a request body could reach a
// scope value through it.
//
// WHAT IS DROPPED IS PART OF THE MAPPING. A fragment turned off on the cutting
// floor does not appear in the grid: darkening a fragment IS the curation, and
// carrying it across would hand the collection back the choices the session was
// used to make.
// =============================================================================

import type { Tractus, TraitValor } from '../../types/collectio.js'
import { enabledFragments, type MuseSession, type MuseNozzleEntry } from '../../crystal/muse/session.js'
import { TEMPLATE_ORDER, type Category, type Fragment } from '../../crystal/muse/taxonomy.js'

/** The `aditusBase` key the collection mixer reads the standing prompt from. */
export const BASE_PROMPT_KEY = '_basePrompt'

/** What a promotion produces: the parts of a draft collection a session can supply. */
export interface MusePromotion {
  nomen: string
  descriptio: string
  /** The session's flow — "it even includes the workflow". Absent when it never chose one. */
  modusId?: string
  /** The batched cap, when the session was configured to fire a fixed number. */
  total?: number
  tractus: Tractus[]
  aditusBase: Record<string, unknown>
}

/** How a stacked model is written into a prompt: the trigger word, weighted when it carries one. */
function triggerToken(entry: MuseNozzleEntry): string {
  return typeof entry.weight === 'number' ? `${entry.trigger}:${entry.weight}` : entry.trigger
}

/**
 * The standing prompt the collection expands: the stacked trigger words, the standing
 * prefix, and the standing suffix, comma-joined.
 *
 * THE MODEL STACK TRAVELS AS TRIGGER WORDS, which is the whole of how a promoted
 * collection "includes the model". A `Collectio` has no field for a pinned model and
 * gains none here — the trigger word in the prompt is the binding, exactly as it is for
 * a piece fired from the muse screen (`lib/muse.ts#promptWithAffix`, whose composition
 * order this mirrors so the two paths read the same).
 *
 * A trigger word resolves against the caller's own models by name rather than by id, so
 * a bare trigger is not an unambiguous reference to one set of weights. That ambiguity
 * is CARRIED KNOWINGLY: the alternative — threading pinned model ids onto the collection
 * schema — was ruled against, and this comment exists so the tradeoff is visible at the
 * site rather than rediscovered as a defect.
 *
 * The composed value goes into `_basePrompt`, which `TraitMixer` puts FIRST and then
 * joins the winning trait fragments onto. Because that join appends, a standing suffix
 * leads the trait fragments here rather than trailing them; a draft is finished in the
 * funnel, where the base prompt is editable.
 */
function basePromptOf(session: MuseSession): string {
  const setup = session.setup
  const tokens = (setup?.nozzle ?? []).map(triggerToken).join(', ')
  const prefix = (setup?.prefix ?? '').trim()
  const suffix = (setup?.suffix ?? '').trim()
  return [tokens, prefix, suffix].filter((part) => part.length > 0).join(', ')
}

/**
 * The grid: one axis per category the enabled floor still holds, each surviving fragment
 * one option on it.
 *
 * The axes come out in TEMPLATE_ORDER — the order muse composes a prompt in — rather
 * than in floor order, because the mixer's join mode emits the winning fragments in axis
 * order and a promoted collection should read the way the session's own pieces read.
 *
 * `rarity` IS LEFT UNSET on every option, so the mixer's default spread applies. A
 * floor weight says which fragments the user was drawing more of while playing; it is
 * not a rarity table, and copying it across would silently author one.
 */
function tractusOf(session: MuseSession): Tractus[] {
  const byCategory = new Map<Category, TraitValor[]>()
  for (const fragment of enabledFragments(session)) {
    const valores = byCategory.get(fragment.category) ?? []
    valores.push(valorOf(fragment))
    byCategory.set(fragment.category, valores)
  }

  const axes: Tractus[] = []
  for (const category of TEMPLATE_ORDER) {
    const valores = byCategory.get(category)
    if (valores && valores.length > 0) axes.push({ porta: category, label: category, valores })
  }
  return axes
}

/** One fragment as a trait option: its text is both the value spliced into the port and
 *  the fragment woven into the assembled prompt. */
function valorOf(fragment: Fragment): TraitValor {
  return { value: fragment.text, label: fragment.text, promptFragment: fragment.text }
}

/** The provenance line a promoted collection carries: which session it came out of. */
export function promotionNote(sessionId: string): string {
  return `promoted from muse session ${sessionId.slice(0, 8)}`
}

/**
 * A session as the draft collection it promotes to.
 *
 * `nomen` is resolved by the caller (from the request, or derived) and passed in, so
 * this function never has to reach a dataset.
 *
 * `total` is the batched cap and nothing else: an infinite session names no supply, and
 * a draft with no supply is refused at FIRE time by the gate that already exists rather
 * than being given a number nobody chose.
 */
export function promotionFrom(
  session: MuseSession,
  opts: { sessionId: string; nomen: string },
): MusePromotion {
  const setup = session.setup
  const basePrompt = basePromptOf(session)
  const cap = setup?.mode === 'batched' ? setup.cap : undefined

  return {
    nomen: opts.nomen,
    descriptio: promotionNote(opts.sessionId),
    ...(setup?.modusId ? { modusId: setup.modusId } : {}),
    ...(cap !== undefined ? { total: cap } : {}),
    tractus: tractusOf(session),
    aditusBase: basePrompt ? { [BASE_PROMPT_KEY]: basePrompt } : {},
  }
}
