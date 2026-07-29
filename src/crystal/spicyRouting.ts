// =============================================================================
// spicyRouting — spicy-mode alt-model routing table (noema-091, lever b)
// =============================================================================
//
// Maps a resolved `modusId` (the concierge chat / LLM-reasoning verb) → a willing/
// uncensored OpenRouter model id. Consulted ONLY when the caller's `spicyMode` is
// ON (see CrystalApi.invokeFlow); the override repoints `aditus.model` before it
// reaches ApiCursor's `aditus.model ?? spec.defaultModel` seam.
//
// SHIPPED EMPTY, BY DESIGN (operator ruling Q3, 2026-07-28): no modus resolves to
// an override until the operator populates this with vetted OpenRouter model ids at
// deploy. An empty map FAILS SAFE — a verb with no entry uses normal routing, so
// spicyMode ON with the empty map is a strict no-op on model selection.
//
// This module lives in the platform-neutral `crystal` ring and imports nothing from
// `allocutio` (the ring↔allocutio boundary the architecture test guards). It is NOT
// a moderation gate and is deliberately excluded from the spicyMode boundary scan.
// =============================================================================

/**
 * modusId → willing OpenRouter model id. EMPTY as shipped; populate at deploy.
 *
 * TODO(operator): populate with vetted OpenRouter model ids at deploy, e.g.
 *   'modus.openrouter-chat': 'venice/uncensored-model-id',
 * Do NOT invent/guess model ids — only real, vetted OpenRouter `provider/model` slugs.
 */
export const SPICY_MODEL_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({})

/**
 * The willing OpenRouter model override for a modus when spicyMode is on, or
 * `undefined` when the modus has no mapping (the shipped state for every modus,
 * since the map is empty). `undefined` ⇒ caller leaves `aditus.model` untouched.
 */
export function spicyModelFor(modusId: string): string | undefined {
  return SPICY_MODEL_OVERRIDES[modusId]
}
