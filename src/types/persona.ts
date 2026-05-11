// =============================================================================
// PERSONA — the platform-specific mask of an anima
// =============================================================================
//
// "Persona" in Latin means the theatrical mask worn by actors in Roman drama.
// The word became "character," then "person" — but we reclaim the original:
// the frontend IS persona. Telegram, Discord, web, API — these are masks,
// not identities. The identity is the anima beneath.
//
// One anima wears many personae. The same soul appears differently on each
// platform — different externusId, different nomen, same underlying anima.
//
// This is why "frontend" and "backend" are not just layers — they are
// philosophically distinct: persona is appearance, anima is substance.
// =============================================================================

/**
 * Which platform this persona represents.
 * Each platform-specific integration (Telegram bot, Discord bot, web app, etc.)
 * creates and manages Persona records for its users.
 */
export type PersonaGenus =
  | 'telegram'  // Telegram bot user — externusId is Telegram user ID (integer as string)
  | 'discord'   // Discord bot user — externusId is Discord user ID (snowflake)
  | 'web'       // Web app user — externusId is Privy DID or session token
  | 'api'       // Direct API user — externusId is API key hash
  | 'mcp'       // MCP (Model Context Protocol) client — externusId is client ID

/**
 * Persona — the platform-specific face of an anima.
 *
 * Created automatically when a user first interacts through a platform.
 * Multiple personae can map to the same animaId (same user, different platforms).
 */
export interface Persona {
  id: string
  /** FK → Anima. The soul behind this mask. */
  animaId: string
  genus: PersonaGenus

  /**
   * The platform's native identifier for this user.
   * "externus" = external/outside in Latin — the ID that lives outside our system.
   * Examples:
   *   telegram → "123456789" (Telegram user ID)
   *   discord  → "987654321012345678" (Discord snowflake)
   *   web      → "did:privy:abc123" (Privy DID)
   */
  externusId: string

  /** Display name on this platform — may differ from anima.nomen */
  nomen?: string

  status: 'active' | 'inactive' | 'banned'

  /** "natum" = born — when this persona was first created */
  natum: Date
  /** "visum" = seen (past participle of videre) — when this persona last interacted */
  visum: Date
}

/** "Personae" — nominative plural. All masks of one anima across platforms. */
export type Personae = Persona[]
