// =============================================================================
// muse/garden — captions in, a validated fragment garden out
// =============================================================================
//
// The front half of the Muse pipeline. `sampler` and `weaver` already turn a
// GARDEN into prompts; this module is what produces the garden in the first
// place: a set of captions is decomposed into categorized fragments, and those
// fragments are pooled per category.
//
// Three properties are load-bearing and each is enforced here rather than left
// to whatever produced the fragments:
//
//   VALIDATED — a fragment whose category is outside the taxonomy is dropped and
//               counted. An extractor backed by a language model will
//               occasionally answer with a category nobody declared; keeping it
//               would create a pool the sampler never reads (it iterates
//               `CATEGORIES`) holding fragments the user never sees.
//   DEDUPED   — identical fragment text within ONE category collapses to a
//               single entry. Caption sets repeat themselves, and a repeated
//               fragment silently weights the roll toward itself. The same text
//               under two DIFFERENT categories is two different fragments and is
//               kept, because the category is what the fragment means.
//   ATTRIBUTED— every fragment keeps the `source` it was lifted from and that
//               source's `trigger`. That pair is what later turns a roll back
//               into a set of model bindings; dropping it loses the binding.
//
// Ring rules: `src/crystal` is the platform-neutral core. Nothing here reads
// `process.env`, and nothing constructs an extractor implicitly — the API key
// and the injected `fetch` arrive from the caller at the platform boundary.

import { CATEGORIES, isCategory, type Category, type Fragment, type Garden } from './taxonomy.js'

// --- The extraction seam -----------------------------------------------------

/**
 * Decompose captions into categorized fragments.
 *
 * The one seam between "some captions" and "a garden". Every caller takes one;
 * tests inject a fake, the CLI injects the chat-backed one below, and a future
 * metered run injects one that settles credits. Implementations MAY return
 * fragments whose category is outside the taxonomy — validation is
 * `buildGarden`'s job, in one place, so it can be counted.
 *
 * @param captions the caption text to decompose
 * @param source   the moodboard entry these captions came from
 * @param trigger  that source's model binding (a LoRA trigger word); '' when none
 */
export type FragmentExtractor = (
  captions: string[],
  source: string,
  trigger: string,
) => Promise<Fragment[]>

/** One moodboard entry: its captions and the model binding they carry. */
export type CaptionSource = {
  /** Human-readable name for the entry; becomes each fragment's `source`. */
  name: string
  /** The entry's LoRA trigger word, or '' when the entry has none. */
  trigger: string
  captions: string[]
}

// --- Garden construction -----------------------------------------------------

/** What building a garden discarded, so a caller can report it rather than guess. */
export type GardenDrops = {
  /** Fragments whose category is not in the taxonomy. */
  unknownCategory: number
  /** Fragments repeating text already held by the same category. */
  duplicate: number
  /** Fragments with no usable text. */
  blank: number
  /** The distinct out-of-taxonomy category names that were seen, sorted. */
  unknownCategories: string[]
}

/** A garden plus the accounting for everything that did not make it in. */
export type GardenBuild = {
  garden: Garden
  /** Fragments actually pooled. */
  kept: number
  drops: GardenDrops
}

/** Trimmed fragment text, or '' when the fragment carries nothing usable. */
function fragmentText(fragment: Fragment): string {
  return typeof fragment.text === 'string' ? fragment.text.trim() : ''
}

/**
 * Pool fragments by category, validating and deduping as they land.
 *
 * Pure: no I/O, no clock, no randomness. Insertion order within a category is
 * preserved, so a garden built from the same fragments always rolls the same
 * way (`sampler.rollFragments` indexes into these pools).
 */
export function buildGarden(fragments: readonly Fragment[]): GardenBuild {
  const garden: Garden = {}
  const seen = new Map<Category, Set<string>>()
  const unknown = new Set<string>()
  const drops: GardenDrops = { unknownCategory: 0, duplicate: 0, blank: 0, unknownCategories: [] }
  let kept = 0

  for (const fragment of fragments) {
    const category = String(fragment?.category ?? '')
    if (!isCategory(category)) {
      drops.unknownCategory++
      unknown.add(category)
      continue
    }

    const text = fragmentText(fragment)
    if (!text) {
      drops.blank++
      continue
    }

    // Dedupe is per category and case-insensitive on the text alone: the same
    // phrase under two categories is two distinct fragments and both are kept.
    let texts = seen.get(category)
    if (!texts) {
      texts = new Set<string>()
      seen.set(category, texts)
    }
    const key = text.toLowerCase()
    if (texts.has(key)) {
      drops.duplicate++
      continue
    }
    texts.add(key)

    const pool = garden[category] ?? (garden[category] = [])
    pool.push({ category, text, source: fragment.source, trigger: fragment.trigger })
    kept++
  }

  drops.unknownCategories = [...unknown].sort()
  return { garden, kept, drops }
}

/**
 * Run one extractor across several caption sources and pool the result.
 *
 * Sources are processed in order and their fragments concatenated before
 * pooling, so the garden is a function of the sources alone. A source with no
 * captions contributes nothing and does not reach the extractor.
 */
export async function growGarden(
  sources: readonly CaptionSource[],
  extract: FragmentExtractor,
): Promise<GardenBuild> {
  const fragments: Fragment[] = []
  for (const source of sources) {
    const captions = source.captions.map((c) => c.trim()).filter(Boolean)
    if (captions.length === 0) continue
    fragments.push(...(await extract(captions, source.name, source.trigger)))
  }
  return buildGarden(fragments)
}

/** Fragments pooled per category, in `CATEGORIES` order. Categories with an empty pool are included. */
export function gardenCounts(garden: Garden): Array<{ category: Category; count: number }> {
  return CATEGORIES.map((category) => ({ category, count: garden[category]?.length ?? 0 }))
}

// --- The OpenAI-compatible extractor ----------------------------------------
//
// One chat call per caption against a provider descriptor from
// `src/crystal/apiProviders.ts`. No SDK and no hardcoded URL or model: the
// descriptor owns the base URL, the `chat` capability path, and the default
// model, so pointing this at any OpenAI-compatible provider is a descriptor
// swap. The API key is supplied by the caller — this ring does not read the
// environment.

/**
 * The decomposition rules, carried across from the validated prototype.
 *
 * The tight-tagging rules are a finding, not decoration: keeping `lighting` off
 * places and `mood` adjectival is what makes the categories separable, and
 * separable categories are what make recombination cohere. `{TRIGGER}` is
 * substituted with the source's trigger word so it is stripped from fragments —
 * a fragment carrying the trigger is branded to one model and not reusable.
 */
export const GARDEN_SYS = `You decompose an image caption into short, reusable PROMPT FRAGMENTS, each tagged with one category.

Categories (use ONLY these):
- subject: who/what the figure fundamentally is (e.g. "a young woman", "a winged angel")
- hair: hair description (e.g. "long silver wavy hair")
- outfit: clothing/attire (e.g. "a black frilly Victorian dress with lace")
- pose: body posture/action (e.g. "curled in a fetal position", "raising one hand")
- expression: face/emotion (e.g. "a melancholic distant gaze")
- props: held/worn HANDHELD or WORN objects only (e.g. "a parasol", "a small crown"). NOT scenery.
- setting: the PLACE / environment / background — the one location the figure is in (e.g. "a computer motherboard", "a sunlit meadow", "a dimly lit room")
- style: art medium/rendering style (e.g. "pixel art", "digital painting", "grainy retro photo")
- palette: dominant colors ONLY — adjectives + color words, no objects (e.g. "cool blues and whites", "muted earthy browns")
- lighting: the QUALITY of light ONLY — never a place. (e.g. "soft dappled sunlight", "a single dramatic spotlight", "harsh backlight")
- mood: overall feeling as ADJECTIVES, never a noun phrase (e.g. "serene and dreamlike", "eerie and mysterious"). Say "nostalgic", not "a nostalgic moment".

Hard rules to prevent fragments that collide when recombined:
- lighting describes HOW light falls, not WHERE. "a dimly lit room" is a SETTING, not lighting — only extract lighting if there is a distinct light QUALITY ("dim, diffuse light"). If the caption only implies a place is dark, put it in setting and leave lighting empty.
- setting is the ONE place. Do not also smuggle a place into props or lighting.
- palette is colors, not lit scenes. mood is adjectives, not events.

General rules:
- Each fragment is a SHORT noun/adjective phrase usable directly in an image prompt (3-12 words). Not a sentence.
- STRIP the trigger word "{TRIGGER}" and any "in X style" boilerplate — fragments must be reusable, not branded.
- Skip a category if the caption doesn't clearly support it. Quality over coverage.
- Return at most one fragment per category per caption (the most salient).`

/** The slice of a provider descriptor this extractor needs. Structural, so any descriptor fits. */
export type ChatEndpoint = {
  baseUrl: string
  capabilities: { chat?: { path: string; defaultModel: string } }
}

/** The `fetch` shape used here, so a caller can inject one in tests. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export type ChatExtractorOpts = {
  /** A provider descriptor, e.g. `OPENAI_PROVIDER`. Must declare a `chat` capability. */
  provider: ChatEndpoint
  /** Bearer key, resolved by the caller from the descriptor's `authEnv`. */
  apiKey: string
  /** Overrides the descriptor's default chat model. */
  model?: string
  /** Injected transport; defaults to the global `fetch`. */
  fetchImpl?: FetchLike
  /** Called once per caption after it is decomposed — progress for a CLI. */
  onCaption?: (index: number, total: number) => void
}

/** What the model is asked to return, before validation. */
type RawFragment = { category?: unknown; text?: unknown }

/**
 * Build a `FragmentExtractor` backed by an OpenAI-compatible `/chat/completions`
 * endpoint: one call per caption, JSON response, low temperature.
 *
 * The returned fragments are NOT filtered against the taxonomy — `buildGarden`
 * is the single validation point so out-of-taxonomy answers can be counted
 * rather than disappearing here.
 */
export function createChatExtractor(opts: ChatExtractorOpts): FragmentExtractor {
  const chat = opts.provider.capabilities.chat
  if (!chat) throw new Error('provider descriptor declares no chat capability')
  if (!opts.apiKey) throw new Error('an API key is required to build a chat extractor')

  const url = `${opts.provider.baseUrl}${chat.path}`
  const model = opts.model ?? chat.defaultModel
  const call: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init))

  return async (captions, source, trigger) => {
    const out: Fragment[] = []
    for (let i = 0; i < captions.length; i++) {
      const response = await call(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: GARDEN_SYS.replace('{TRIGGER}', trigger) },
            {
              role: 'user',
              content:
                `Caption:\n${captions[i]}\n\n` +
                'Return JSON: {"fragments":[{"category":"...","text":"..."}]}',
            },
          ],
        }),
      })

      const body = await response.text()
      if (!response.ok) {
        throw new Error(`chat completion failed (${response.status}): ${body.slice(0, 200)}`)
      }

      for (const raw of parseFragments(body)) {
        const text = typeof raw.text === 'string' ? raw.text.trim() : ''
        if (!text) continue
        out.push({ category: String(raw.category ?? '') as Category, text, source, trigger })
      }
      opts.onCaption?.(i + 1, captions.length)
    }
    return out
  }
}

/** Pull the fragment array out of a chat completion body; a malformed answer yields none. */
function parseFragments(body: string): RawFragment[] {
  let content: unknown
  try {
    const envelope = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> }
    content = envelope.choices?.[0]?.message?.content
  } catch {
    return []
  }
  if (typeof content !== 'string') return []
  try {
    const parsed = JSON.parse(content) as { fragments?: unknown }
    return Array.isArray(parsed.fragments) ? (parsed.fragments as RawFragment[]) : []
  } catch {
    return []
  }
}
