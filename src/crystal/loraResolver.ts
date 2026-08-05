// =============================================================================
// loraResolver — port of the legacy JS loraResolutionService to TypeScript
// =============================================================================
//
// Reads a prompt, finds trigger words that match LoRAs the caller can access,
// and rewrites them in-place into `<lora:slug:weight>` tokens so the downstream
// ComfyUI multi-LoRA extraction node can stack them. Returns the modified
// prompt + a list of the LoRAs that were applied (so the caller can add them
// to the required-models download list).
//
// Pure: no DB, no Intellarum calls — caller supplies the trigger map. The
// resolver is invoked by the Compiler when the workflow template carries
// `loraCapable: true`.
//
// Syntax legacy upholds:
//   trigger             → applies LoRA at the trigger's `defaultWeight` (default 1.0)
//   trigger:0.5         → explicit weight override
//   trigger:0.0         → SILENCES: LoRA is NOT applied; original word kept
//   trigger!!           → defaultWeight + (0.2 × number of !)
//   trigger..           → defaultWeight − (0.2 × number of .)
//   <lora:slug:weight>  → explicit-form tag; passes through if the slug is
//                         known to the caller, otherwise stripped with a warning
//
// Conflict resolution when one trigger maps to multiple Intellae:
//   private (owned by animaId)  >  shared private (someone else's, accessible)
//                               >  public
//   ties broken by `mutatum` descending (most recent wins). A multi-public
//   match emits a warning naming the winner.

import type { Intella, Intellae } from '../types/intelligendi.js'

export interface ResolvedLora {
  slug: string
  weight: number
  /** What the user typed (trigger word, weighted form, or original tag). */
  originalWord: string
  /** What it became in the modified prompt. */
  replacedWord: string
  /** FK → Intella, so the caller can add it to required-models for download. */
  intellaId: string
  /** Forwarded for permission/audit trails downstream. */
  ownerAnimaId?: string
}

export interface LoraResolveResult {
  modifiedPrompt: string
  rawPrompt: string
  appliedLoras: ResolvedLora[]
  warnings: string[]
}

export interface LoraResolveOptions {
  /** Pre-built trigger map: lowercased trigger word → matching Intellae. */
  triggerMap: Map<string, Intellae>
  /** The executing user's anima — gates private-LoRA conflict resolution. */
  animaId?: string
}

const LORA_TAG_REGEX            = /<lora:([^:]+):([^>]+)>/g
const WORD_WEIGHT_REGEX         = /^([a-zA-Z0-9_.-]+)(?::(\d*\.?\d+))?/
const SPLIT_KEEP_DELIMITERS     = /(\s+|[.,!?()[\]{}'"]+)/g
const PLAIN_WORD_TOKEN          = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/
const ALL_DOTS                  = /^\.+$/
const ALL_EXCLAMATIONS          = /^!+$/
const PLAIN_TRIGGER_KEY         = /^[a-z0-9_-]+$/
const REGEX_META                = /[.*+?^${}()|[\]\\]/g

/**
 * Pick the winning Intella from a set of candidates sharing one trigger key.
 * Private (owned by animaId) > shared private > public; ties by `mutatum`
 * descending. A multi-public match emits a warning naming the winner.
 */
function pickIntella(
  candidates: Intellae,
  animaId: string | undefined,
  warnings: string[],
  triggerKey: string,
): Intella | undefined {
  const owned   = candidates.filter(i => i.access === 'private' && i.ownerAnimaId === animaId)
  const shared  = candidates.filter(i => i.access === 'private' && i.ownerAnimaId !== animaId)
  // Canonical (platform-curated) Intellae are public by definition — seeded LoRAs set no `access`
  // field, so without `|| i.canonica` they fall into no bucket and the trigger silently no-ops.
  // (Mirrors the same canonica=public rule in MongoIntella.buildAccessOrClauses.)
  const publics = candidates.filter(i => i.access === 'public' || i.canonica)
  const byRecency = (a: Intella, b: Intella) =>
    (b.mutatum?.getTime() ?? b.natum.getTime()) - (a.mutatum?.getTime() ?? a.natum.getTime())

  if (owned.length)  { owned.sort(byRecency);  return owned[0] }
  if (shared.length) { shared.sort(byRecency); return shared[0] }
  if (publics.length) {
    publics.sort(byRecency)
    if (publics.length > 1) {
      warnings.push(`Multiple public LoRAs for trigger '${triggerKey}'. Slugs: ${publics.map(l => l.slug).join(', ')}. Using: ${publics[0].slug}.`)
    }
    return publics[0]
  }
  return undefined
}

/**
 * Substring scan for triggers the tokenizer can't reach — keys containing
 * colons, spaces, escaped parens, dots, or other regex metacharacters.
 * Examples from real legacy data: `artist:moriimee`, `1990s \(style\)`,
 * `retro artstyle`.
 *
 * Plain alphanumeric keys (e.g. `milady`) are left for Pass 2 — substring
 * scanning those would risk matching inside larger words.
 *
 * Returns the prompt with matched triggers (+ optional weight modifier)
 * replaced by `<lora:slug:weight>` tags. Mutates `state` to record the
 * applied LoRAs and emitted warnings.
 */
interface ScanState {
  applied: ResolvedLora[]
  lorasApplied: Set<string>
  warnings: string[]
}

function _substringScan(
  prompt: string,
  triggerMap: Map<string, Intellae>,
  animaId: string | undefined,
  state: ScanState,
): string {
  const specialKeys = Array.from(triggerMap.keys())
    .filter(k => !PLAIN_TRIGGER_KEY.test(k))
    .sort((a, b) => b.length - a.length)
  if (specialKeys.length === 0) return prompt

  type Match = {
    start: number
    end: number
    key: string
    userWeight: number | null
    dotExclOffset: number
  }
  const matches: Match[] = []

  for (const key of specialKeys) {
    const escaped = key.replace(REGEX_META, '\\$&')
    // Trigger optionally followed by :N.N (explicit weight), !+ (boost), or .+ (drop).
    const re = new RegExp(`${escaped}(?::(\\d*\\.?\\d+)|(!+)|(\\.+))?`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(prompt)) !== null) {
      const userWeight = m[1] !== undefined ? parseFloat(m[1]) : null
      const dotExclOffset = m[2] ? 0.2 * m[2].length : (m[3] ? -0.2 * m[3].length : 0)
      matches.push({ start: m.index, end: m.index + m[0].length, key, userWeight, dotExclOffset })
      if (m[0].length === 0) re.lastIndex++
    }
  }

  // Greedy left-to-right, longest-trigger-wins on tie at the same start.
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start))
  const accepted: Match[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start < cursor) continue
    accepted.push(m)
    cursor = m.end
  }

  const parts: string[] = []
  let lastIndex = 0
  for (const m of accepted) {
    parts.push(prompt.substring(lastIndex, m.start))
    const candidates = triggerMap.get(m.key) ?? []
    const chosen = pickIntella(candidates, animaId, state.warnings, m.key)

    if (!chosen?.slug) {
      // No accessible LoRA — keep the matched text verbatim (including any
      // weight modifier we consumed for inspection).
      parts.push(prompt.substring(m.start, m.end))
    } else if (m.userWeight === 0.0) {
      // :0.0 silences — keep the original trigger text, drop the modifier.
      parts.push(m.key)
    } else if (state.lorasApplied.has(chosen.slug)) {
      // Already applied via an earlier occurrence — drop the trigger from the
      // prompt; modifier (if any) is consumed.
    } else {
      const baseWeight  = chosen.defaultWeight ?? 1.0
      const finalWeight = m.userWeight !== null
        ? m.userWeight
        : Math.round((baseWeight + m.dotExclOffset) * 100) / 100
      const loraTag = `<lora:${chosen.slug}:${finalWeight}>`
      state.applied.push({
        slug: chosen.slug,
        weight: finalWeight,
        originalWord: prompt.substring(m.start, m.end),
        replacedWord: loraTag,
        intellaId: chosen.id,
        ...(chosen.ownerAnimaId ? { ownerAnimaId: chosen.ownerAnimaId } : {}),
      })
      state.lorasApplied.add(chosen.slug)
      parts.push(loraTag)
      // Preserve the trigger text after the tag for CLIP — mirrors Pass 2.
      parts.push(m.key)
    }
    lastIndex = m.end
  }
  parts.push(prompt.substring(lastIndex))
  return parts.join('')
}

/**
 * Pure trigger resolver. Returns the modified prompt + the LoRAs that ended
 * up in it. Empty `triggerMap` is a no-op (returns rawPrompt unmodified).
 */
export function resolveLoraTriggers(
  prompt: string,
  opts: LoraResolveOptions,
): LoraResolveResult {
  const rawPrompt = prompt
  const { triggerMap, animaId } = opts
  const appliedLoras: ResolvedLora[] = []
  const warnings: string[] = []
  const lorasAppliedThisRun = new Set<string>()

  if (!triggerMap || triggerMap.size === 0) {
    return { modifiedPrompt: rawPrompt, rawPrompt, appliedLoras, warnings }
  }

  // ── Pass 1: handle pre-existing <lora:slug:weight> tags ──────────────────
  // Validate each tag's slug against the caller's accessible map. Unknown
  // tags get stripped (with a warning) so a prompt can't smuggle in LoRAs
  // the caller doesn't have permission for.
  const knownSlugs = new Set<string>()
  for (const list of triggerMap.values()) for (const i of list) if (i.slug) knownSlugs.add(i.slug)

  const finalPromptParts: string[] = []
  let tagMatch: RegExpExecArray | null
  let lastIndex = 0
  LORA_TAG_REGEX.lastIndex = 0
  while ((tagMatch = LORA_TAG_REGEX.exec(prompt)) !== null) {
    finalPromptParts.push(prompt.substring(lastIndex, tagMatch.index))
    const fullTag = tagMatch[0]
    const slug    = tagMatch[1]
    const weight  = parseFloat(tagMatch[2])

    if (Number.isNaN(weight)) {
      warnings.push(`Invalid weight in inline tag ${fullTag}. Tag preserved as text.`)
      finalPromptParts.push(fullTag)
    } else if (lorasAppliedThisRun.has(slug)) {
      finalPromptParts.push(fullTag)
    } else if (knownSlugs.has(slug)) {
      // Look up the actual Intella behind the slug for the lineage entry.
      let inlineIntella: Intella | undefined
      for (const list of triggerMap.values()) {
        const m = list.find(i => i.slug === slug)
        if (m) { inlineIntella = m; break }
      }
      appliedLoras.push({
        slug, weight, originalWord: fullTag, replacedWord: fullTag,
        intellaId: inlineIntella?.id ?? 'INLINE_TAG',
        ...(inlineIntella?.ownerAnimaId ? { ownerAnimaId: inlineIntella.ownerAnimaId } : {}),
      })
      lorasAppliedThisRun.add(slug)
      finalPromptParts.push(fullTag)
    } else {
      warnings.push(`Inline tag ${fullTag} refers to an unknown or inaccessible LoRA. Stripped.`)
      // Don't push — strips the tag.
    }
    lastIndex = LORA_TAG_REGEX.lastIndex
  }
  finalPromptParts.push(prompt.substring(lastIndex))

  // ── Pass 1.5: substring scan for legacy multi-char / multi-word triggers ─
  // Triggers like `artist:moriimee`, `1990s \(style\)`, `retro artstyle` —
  // anything the tokenizer can't reach — are resolved here, in-place, before
  // Pass 2 runs. The resulting <lora:...> tags pass through Pass 2 untouched
  // (the existing inline-tag short-circuit catches them).
  let currentText = finalPromptParts.join('')
  finalPromptParts.length = 0
  currentText = _substringScan(currentText, triggerMap, animaId, {
    applied: appliedLoras,
    lorasApplied: lorasAppliedThisRun,
    warnings,
  })

  // ── Pass 2: walk remaining text for trigger words ────────────────────────

  const segments = currentText.split(SPLIT_KEEP_DELIMITERS).filter(s => s && s.length > 0)
  // Merge `trigger:` + `.` + `4` → `trigger:.4` and `word` + `..` → `word..`
  // (the legacy split breaks decimal weights and dot/excl modifiers apart).
  const merged: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const next = segments[i + 1]
    const next2 = segments[i + 2]
    const hasColon = seg.includes(':')
    const weightPrefix = /^[a-zA-Z0-9_.-]+(?::\d*)?$/.test(seg)

    if (hasColon && weightPrefix && next === '.' && next2 && /^\d+$/.test(next2)) {
      merged.push(seg + '.' + next2); i += 2; continue
    }
    const isPlainWord = PLAIN_WORD_TOKEN.test(seg)
    if (isPlainWord && next && (ALL_DOTS.test(next) || ALL_EXCLAMATIONS.test(next))) {
      merged.push(seg + next); i += 1; continue
    }
    merged.push(seg)
  }

  for (const segment of merged) {
    // Skip already-processed <lora:...> tags or pure-delimiter tokens.
    if (LORA_TAG_REGEX.test(segment)) { LORA_TAG_REGEX.lastIndex = 0; finalPromptParts.push(segment); continue }
    LORA_TAG_REGEX.lastIndex = 0
    const isDelimiter = SPLIT_KEEP_DELIMITERS.test(segment) && segment.match(SPLIT_KEEP_DELIMITERS)?.[0] === segment
    SPLIT_KEEP_DELIMITERS.lastIndex = 0
    if (isDelimiter) { finalPromptParts.push(segment); continue }

    const wordMatch = segment.match(WORD_WEIGHT_REGEX)
    let baseToken = ''
    let userWeight: number | null = null
    let trailing  = ''

    if (wordMatch) {
      baseToken = wordMatch[1].toLowerCase()
      if (wordMatch[2] !== undefined) userWeight = parseFloat(wordMatch[2])
      const matchLen = wordMatch[0].length
      if (segment.length > matchLen) trailing = segment.substring(matchLen)
    } else {
      baseToken = segment.toLowerCase().replace(/[.,!?()[\]{}'"]+$/, '')
    }

    // Dot/exclamation modifiers — consumed (do NOT appear in output). Only
    // honored when no explicit :weight was given. Each '.' = -0.2; each '!' = +0.2.
    let dotExclOffset = 0
    if (userWeight === null) {
      const dots = baseToken.match(/\.+$/)
      if (dots) { dotExclOffset = -0.2 * dots[0].length; baseToken = baseToken.slice(0, -dots[0].length) }
      else {
        const excl = trailing.match(/^!+/)
        if (excl) { dotExclOffset = 0.2 * excl[0].length; trailing = trailing.slice(excl[0].length) }
      }
    }

    if (!triggerMap.has(baseToken)) { finalPromptParts.push(segment); continue }

    // :0.0 silences — keep the original word, don't apply LoRA.
    if (userWeight === 0.0) { finalPromptParts.push(segment); continue }

    const candidates = triggerMap.get(baseToken) ?? []
    const chosen     = pickIntella(candidates, animaId, warnings, baseToken)
    if (!chosen?.slug) { finalPromptParts.push(segment); continue }

    if (lorasAppliedThisRun.has(chosen.slug)) {
      // Already applied — drop the trigger word from the prompt, keep trailing punctuation.
      finalPromptParts.push(trailing)
      continue
    }

    const baseWeight = chosen.defaultWeight ?? 1.0
    const finalWeight = userWeight !== null
      ? userWeight
      : Math.round((baseWeight + dotExclOffset) * 100) / 100
    const loraTag = `<lora:${chosen.slug}:${finalWeight}>`

    appliedLoras.push({
      slug: chosen.slug,
      weight: finalWeight,
      originalWord: segment,
      replacedWord: loraTag,
      intellaId: chosen.id,
      ...(chosen.ownerAnimaId ? { ownerAnimaId: chosen.ownerAnimaId } : {}),
    })
    lorasAppliedThisRun.add(chosen.slug)

    finalPromptParts.push(loraTag)
    finalPromptParts.push(baseToken)  // preserve the original word for CLIP
    finalPromptParts.push(trailing)
  }

  return {
    modifiedPrompt: finalPromptParts.join(''),
    rawPrompt,
    appliedLoras,
    warnings,
  }
}

/**
 * Update the weight of a specific LoRA tag in an already-resolved prompt.
 * Used by the bulletin/UI when the user adjusts a weight after the fact.
 */
export function setLoraWeight(prompt: string, slug: string, newWeight: number): string {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(<lora:${escaped}:)[^>]+(>)`)
  return prompt.replace(regex, `$1${newWeight}$2`)
}
