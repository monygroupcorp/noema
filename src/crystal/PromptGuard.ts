// =============================================================================
// PromptGuard — the input-side CSAM signal filter (generation boundary)
// =============================================================================
//
// Runs at the GENERATION request boundary (CrystalApi.invokeFlow), BEFORE a flow
// dispatches — the upstream counterpart to the publish-time ModerationGate. Its job
// is narrow and deliberate: refuse prompts that solicit CSAM, while leaving ADULT
// sexual expression untouched. Every rule keys on a MINOR signal co-occurring with a
// sexual signal (or a known CSAM code word) — never on sex alone — so adult content
// passes and only child-sexual solicitation is refused.
//
// FAIL-OPEN (unlike the publish gate): this is the input reducer, not the hard stop.
// If the guard is unconfigured or errors, generation proceeds — the fail-CLOSED
// backstop is the output classifier at the publish boundary. Input filtering lowers
// the volume of abuse attempts and is the cheapest place to refuse; the publish gate
// is what legally must hold the line.
//
// PORT + stub only in this PUBLIC file. The real matcher (signal lexicons, code-word
// lists) is the abuse surface and is PRIVATE (ADR-0012 §49): it lives in
// `src/private/compliance` and is injected at deploy. Publishing the exact patterns
// would only teach evasion.
// =============================================================================

/** A prompt-guard verdict: allow, or refuse with a reason. */
export type PromptVerdict = { ok: true } | { ok: false; reason: string }

/** Screens a generation's resolved input (aditus) before dispatch. */
export interface PromptGuard {
  /** @param aditus the effective, post-defaults flow input (text ports carry the prompt). */
  check(aditus: Record<string, unknown>): Promise<PromptVerdict>
}

/**
 * PERMISSIVE stub — allows everything. The fail-open default when the private matcher
 * is absent (a public build) or no lexicon is configured. Safe as the INPUT default
 * because the publish-boundary ModerationGate is the fail-closed backstop; do NOT
 * mistake its `ok:true` for real input screening.
 */
export const permissivePromptGuard: PromptGuard = {
  async check(): Promise<PromptVerdict> {
    return { ok: true }
  },
}
