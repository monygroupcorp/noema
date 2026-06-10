// =============================================================================
// CANON_VERBS — the platform's taste: each canon verb's default flow
// =============================================================================
//
// Each canon verb maps to its default modusId (verb → flowId). Seeded ONLY with
// verbs whose flows exist today; the remaining elemental verbs
// (`effect`/`animate`/`direct`/`compose`) are deliberately omitted — a one-line
// add here once their default flow ships (ADR-0003). An owner-keyed rebind
// (Consuetudinum.resolve) overrides this; absent an override, this table is the
// answer.
//
// Shared by every surface that resolves a verb to a flow: the Telegram
// CommandRouter and the agent-facing CrystalApi both import it here so the
// platform's defaults live in exactly one place.
// =============================================================================

export const CANON_VERBS: Record<string, string> = { make: 'flux-schnell', chat: 'modus.chatgpt' }
