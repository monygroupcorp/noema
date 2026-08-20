// =============================================================================
// muse/steer — an instruction and a floor in, a VETOABLE PROPOSAL out
// =============================================================================
//
// The interpreter half of steering. A user says what they want in their own
// words ("lose the neon, keep the cactuses, try dusk light") and this module
// turns that into a PROPOSAL: fragments to take off the floor, fragments to put
// on it. Nothing here applies anything.
//
// A STEER PROPOSES. IT NEVER APPLIES. The floor changes only through the routes
// that already exist — the floor-enabled PATCH and the floor-fragments POST —
// called when the user confirms the sheet the proposal is rendered as. That
// separation is the product decision this module exists to hold: a proposal the
// user can veto pill by pill is only meaningful if the floor has not already
// moved by the time they see it.
//
// Three properties are load-bearing and each is enforced HERE rather than left
// to whatever produced the proposal:
//
//   VALIDATED — `validateProposal` is the single validation point, exactly as
//               `buildGarden` is for the decomposer. An elimination naming a
//               fragment the floor does not hold, an addition outside the
//               taxonomy, an addition the floor already holds, and a blank are
//               all dropped here and nowhere else.
//   COUNTED   — every drop increments `dropped`, and the count is returned
//               rather than swallowed. A silent drop is how a user comes to
//               believe they vetoed something that was never proposed.
//   LIMITED   — the instruction is bounded, and the bound is the server's, not
//               the UI's. The bounds live here; the refusal is made in the
//               cursor's `reserve()`, before a reservation is taken and before
//               the first provider call.
//
// A malformed or hallucinated reply is NORMAL INPUT, not an exception: the chat
// rail returns what it returns, validation drops what does not fit and reports
// the count. Throwing on a bad answer would bill a user for a run that produced
// nothing.
//
// Pure: no I/O, no clock, no randomness, no platform imports. `src/crystal` is
// the platform-neutral ring, and this module does not even reach the session
// store — it never sees a session at all, only a floor passed to it.

import { CATEGORIES, fragmentKey, isCategory, type Category, type Fragment } from './taxonomy.js'

// --- Types -------------------------------------------------------------------

/**
 * The stable identity of a fragment: its category and its text.
 *
 * The same pair the floor routes already take, so a pill in the consent sheet is
 * rendered from exactly what the confirm call will send. `fragmentKey` (owned by
 * `taxonomy.ts`) is the key rule; nothing here re-derives it.
 */
export type FragmentIdentity = Pick<Fragment, 'category' | 'text'>

/**
 * What a steer proposes — and only proposes.
 *
 * `eliminations` name fragments to take out of the draw; `additions` are
 * fragments to put on the floor. `dropped` is how many of the model's proposed
 * changes did not survive validation, so the caller can say so rather than
 * present a shorter list as if it were the whole answer.
 */
export type SteerProposal = {
  /** Fragments proposed for elimination. Every one is on the floor as given. */
  eliminations: FragmentIdentity[]
  /** Fragments proposed for addition. Every one is in the taxonomy and new to the floor. */
  additions: Fragment[]
  /** How many proposed changes were dropped in validation. */
  dropped: number
}

/**
 * The `source` a fragment a steer proposed carries.
 *
 * Attribution is load-bearing (`garden.ts`): `source` and `trigger` together are
 * what turn a roll back into model bindings. A fragment a steer proposed came from
 * no moodboard entry and binds no model, so its attribution is STATED rather than
 * inferred — the source is this literal and the trigger is empty, which `roll.ts`
 * already reads as "no binding". A literal rather than an absent field, so a
 * proposed fragment stays distinguishable from a lifted one wherever attribution
 * is read; it is deliberately NOT `MANUAL_SOURCE`, because a phrase the user typed
 * and a phrase a model offered are different provenance.
 */
export const STEER_SOURCE = 'steer'

// --- The limit ---------------------------------------------------------------

/**
 * Longest instruction a steer will accept.
 *
 * The instruction is LIMITED by design: a steer is a short push against a floor
 * ("lose the neon"), not a prompt and not a conversation. The bound is the
 * server's rather than the input field's — a UI limit is a courtesy, and this is
 * what makes the limit true for every caller.
 */
export const MAX_INSTRUCTION_CHARS = 280

/**
 * Largest floor a single steer will read.
 *
 * The whole floor goes into the one prompt this makes, so both the call's cost
 * and the quality of the answer degrade with floor size. Refusing above the cap
 * keeps a single run's ceiling — and a single user's locked balance — bounded,
 * and keeps the model's attention on a floor it can actually hold.
 */
export const MAX_FLOOR_FRAGMENTS = 300

// --- Validation --------------------------------------------------------------

/** What the model is asked to return, before validation. */
type RawChange = { category?: unknown; text?: unknown }

/** A model's raw answer, before validation. Every field is untrusted. */
export type RawProposal = {
  eliminations?: unknown
  additions?: unknown
}

/** Trimmed text off an untrusted change, or '' when it carries nothing usable. */
function changeText(raw: RawChange): string {
  return typeof raw?.text === 'string' ? raw.text.trim() : ''
}

/** The untrusted array under one key, or an empty list when it is anything else. */
function rawChanges(value: unknown): RawChange[] {
  return Array.isArray(value) ? (value as RawChange[]) : []
}

/**
 * Validate a raw proposal against the floor it was made about.
 *
 * THE SINGLE VALIDATION POINT — the equivalent of `buildGarden` for the
 * decomposer, and equally single: no second filter runs in the cursor or at the
 * API layer. Four rules, each dropping rather than throwing, and each counted:
 *
 *   - an ELIMINATION naming a fragment the floor does not hold is dropped. A
 *     proposal that names a phrase nobody has is a pill the user cannot honestly
 *     veto: saying no to it changes nothing, and saying yes to it changes nothing.
 *   - an ADDITION whose category is outside `CATEGORIES` is dropped. A fragment
 *     filed outside the taxonomy would sit in a pool no roll ever reads — on the
 *     floor, counted in its totals, never drawn.
 *   - an ADDITION the floor already holds is dropped. The manual-add route already
 *     treats a duplicate as a no-op, so offering it as a pill offers a change that
 *     does nothing.
 *   - a blank or whitespace-only text is dropped on either side.
 *
 * A repeat within one answer is dropped too, on both sides: one identity named
 * twice is one change, and two pills for it would let a user veto it once and
 * still have it applied.
 *
 * @param raw   the model's answer, entirely untrusted
 * @param floor the fragment identities the session's floor holds
 */
export function validateProposal(
  raw: RawProposal,
  floor: readonly FragmentIdentity[],
): SteerProposal {
  const held = new Set(floor.map((f) => fragmentKey(f)))

  const eliminations: FragmentIdentity[] = []
  const additions: Fragment[] = []
  const seen = new Set<string>()
  let dropped = 0

  for (const change of rawChanges(raw?.eliminations)) {
    const category = String(change?.category ?? '')
    const text = changeText(change)
    if (!text || !isCategory(category)) {
      dropped++
      continue
    }
    const key = fragmentKey({ category, text })
    // Named against the floor as it stands: an identity the floor does not hold
    // cannot be taken off it.
    if (!held.has(key) || seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    eliminations.push({ category, text })
  }

  for (const change of rawChanges(raw?.additions)) {
    const category = String(change?.category ?? '')
    const text = changeText(change)
    if (!text || !isCategory(category)) {
      dropped++
      continue
    }
    const key = fragmentKey({ category, text })
    // Already on the floor, or already proposed in this same answer — either way
    // adding it changes nothing.
    if (held.has(key) || seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    additions.push({ category: category as Category, text, source: STEER_SOURCE, trigger: '' })
  }

  return { eliminations, additions, dropped }
}

// --- The prompt --------------------------------------------------------------

/**
 * The steering rules.
 *
 * Written against the same two-tier taxonomy the decomposer extracts into, so a
 * proposed fragment reads like a lifted one and composes with it. The hard rule
 * is the one that matters: an elimination must quote a fragment from the floor
 * VERBATIM, because an approximate quote is dropped by `validateProposal` and the
 * user then sees a shorter sheet than the instruction deserved.
 */
export const STEER_SYS = `You steer a set of image-prompt FRAGMENTS. The user gives a short instruction and the current floor of fragments; you propose which fragments to REMOVE and which to ADD.

Categories (use ONLY these): ${CATEGORIES.join(', ')}.
- subject: who/what the figure fundamentally is. hair / outfit / pose / expression / props describe that one figure (props = handheld or worn objects, never scenery).
- setting: the ONE place. style: art medium/rendering style. palette: colors only. lighting: the QUALITY of light, never a place. mood: adjectives, never a noun phrase.

Hard rules:
- An elimination MUST quote a fragment from the floor EXACTLY as it is written there — same category, same text. Anything else is discarded.
- An addition must be a SHORT noun/adjective phrase usable directly in an image prompt (3-12 words), not a sentence, and must not repeat a fragment already on the floor.
- Propose only what the instruction asks for. An instruction that only removes should add nothing, and one that only adds should remove nothing.
- Leave a list empty rather than filling it. A change nobody asked for is worse than no change.
- Every proposal is shown to the user for approval and any part of it may be rejected, so propose the honest reading of the instruction rather than the safe one.`

/** One chat message, as an OpenAI-compatible completions endpoint takes it. */
export type ChatMessage = { role: 'system' | 'user'; content: string }

/** The floor as the prompt shows it: one `category: text` line per fragment, in category order. */
export function floorLines(floor: readonly FragmentIdentity[]): string {
  const byCategory = new Map<string, FragmentIdentity[]>()
  for (const fragment of floor) {
    const pool = byCategory.get(fragment.category) ?? []
    pool.push(fragment)
    byCategory.set(fragment.category, pool)
  }
  const lines: string[] = []
  for (const category of CATEGORIES) {
    for (const fragment of byCategory.get(category) ?? []) {
      lines.push(`${category}: ${fragment.text}`)
    }
  }
  return lines.join('\n')
}

/**
 * The messages one steer sends: the rules, the floor, and the instruction.
 *
 * The floor is rendered in `CATEGORIES` order so the same floor always produces
 * the same prompt, and the instruction is quoted last so it is what the model
 * reads most recently.
 */
export function steerMessages(
  instruction: string,
  floor: readonly FragmentIdentity[],
): ChatMessage[] {
  return [
    { role: 'system', content: STEER_SYS },
    {
      role: 'user',
      content:
        `Current floor:\n${floorLines(floor)}\n\n` +
        `Instruction:\n${instruction.trim()}\n\n` +
        'Return JSON: {"eliminations":[{"category":"...","text":"..."}],"additions":[{"category":"...","text":"..."}]}',
    },
  ]
}

/**
 * Pull the raw proposal out of a chat completion body.
 *
 * A malformed envelope, a non-string content, or content that is not JSON all
 * yield an EMPTY proposal rather than a throw — the same tolerance
 * `createChatExtractor` gives a malformed decomposition, and for the same reason:
 * the answer is the model's, and a run that produced nothing usable should say so
 * rather than fail.
 */
export function parseProposal(body: string): RawProposal {
  let content: unknown
  try {
    const envelope = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> }
    content = envelope.choices?.[0]?.message?.content
  } catch {
    return {}
  }
  if (typeof content !== 'string') return {}
  try {
    const parsed = JSON.parse(content) as RawProposal
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
