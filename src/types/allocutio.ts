// =============================================================================
// ALLOCUTIO — the platform adapter crystal
// =============================================================================
//
// "Allocutio" = formal address, speech to an assembled group (Latin, 3rd decl.
// feminine, from alloqui: to address, to speak to). In Roman military
// practice, the allocutio was the commander's address to the troops — the
// moment the command structure spoke to the assembly.
//
// The platform adapter crystal is the SECONDARY layer above the core crystal.
// It bridges platform-specific message formats (Telegram, Discord, HTTP, Web)
// into crystal-native types (Nuntius → Inceptio → Responsum).
//
// LAYER BOUNDARIES:
//   Platform message (raw JSON, webhook payload, HTTP body)
//     → Allocutio.parse()    → Nuntius      (normalized inbound)
//     → Allocutio.resolve()  → Inceptio     (execution intent, crystal-native)
//     → ActumInceptor                       ← core crystal boundary
//     → Allocutio.send()     ← Responsum    (normalized outbound)
//     → Platform response (Telegram sendMessage, Discord interaction reply, etc.)
//
// DESIGN CHOICE (Option 1): Platform-specific intent parsing.
// Each Allocutio knows how to read its platform's commands, slash-commands,
// inline buttons, and natural language. The output is always a crystal-native
// Inceptio. No generic NLP layer — each platform adapter owns its own parsing.
//
// This avoids premature abstraction: Telegram slash commands behave differently
// from Discord application commands, which behave differently from HTTP REST.
// The adapter IS the parser. The crystal is the shared output format.
//
// PRIVACY: Nuntius uses platform-specific user IDs, NOT animaId.
// Resolving a Nuntius sender to an Anima is a separate step, performed by
// the application layer (not the adapter). The adapter is identity-blind.
//
// Latin declensions used:
//   Nuntius    (2nd decl. m.)   — nuntii, nuntiorum
//   Responsum  (2nd decl. n.)   — responsa, responsorum
//   Allocutio  (3rd decl. f.)   — allocutiones, allocutionum
// =============================================================================

import type { Inceptio } from './cursus.js'

// ---------------------------------------------------------------------------
// Nuntius — inbound normalized message
// ---------------------------------------------------------------------------

export type NuntiusPlatforma =
  | 'telegram'
  | 'discord'
  | 'http'      // REST API call (authenticated or anonymous)
  | 'web'       // Web client (browser WebSocket or fetch)
  | 'cli'       // Command-line interface

export type NuntiusGenus =
  | 'textus'        // plain text message or command
  | 'imago'         // image
  | 'documentum'    // file/document
  | 'vox'           // voice/audio message
  | 'eventus'       // platform event (button press, slash command, webhook)

/**
 * NuntiusAdnexum — an attachment on an inbound message.
 * "adnexum" = something fastened on, an appendage (from adnectere).
 */
export interface NuntiusAdnexum {
  /** MIME type or kind — 'image/jpeg', 'audio/ogg', 'application/pdf' */
  genus: string
  /** Storage reference, platform CDN URL, or temporary file key */
  ref: string
  /** File size in bytes, if known */
  magnitudo?: number
}

/**
 * Nuntius — an inbound normalized message from any platform.
 * "nuntius" = message, dispatch, news (Latin, 2nd decl. m.).
 *
 * The Allocutio normalizes the raw platform payload into this form.
 * Platform-specific fields are captured in the 'platforma' and 'externus*'
 * fields; the rest is canonical regardless of origin.
 *
 * IDENTITY NOTE: externusUserId is the platform's user identifier, NOT animaId.
 * The link platform_user_id → animaId is resolved by the application layer.
 * The adapter does not know and should not need to know the anima.
 */
export interface Nuntius {
  id: string
  platforma: NuntiusPlatforma

  /**
   * The platform's identifier for the sender.
   * Telegram: user.id (string), Discord: user.id, HTTP: authenticated subject.
   * "externus" = external, foreign — emphasizes this is the outside world's ID.
   */
  externusUserId: string
  /**
   * The platform's identifier for the conversation context.
   * Telegram: chat.id, Discord: channel.id + interaction.id, HTTP: session id.
   */
  externusConversationId: string
  /**
   * The platform's identifier for this specific message.
   * Used for reply threading and deduplication.
   */
  externusMessageId?: string

  genus: NuntiusGenus
  /** The raw message text or command */
  corpus: string

  /** File attachments, images, documents, or voice messages */
  adnexa?: NuntiusAdnexum[]

  /** "natum" = born — when this message was received */
  natum: Date
}

/** "Nuntiorum" — genitive plural. The inbound message queue/store. */
export interface Nuntiorum {
  find(id: string): Promise<Nuntius | null>
  enqueue(nuntius: Omit<Nuntius, 'id' | 'natum'>): Promise<Nuntius>
}

// ---------------------------------------------------------------------------
// Responsum — outbound normalized response
// ---------------------------------------------------------------------------

/**
 * ResponsumAdnexum — a media attachment on an outbound response.
 */
export interface ResponsumAdnexum {
  /** 'image', 'video', 'audio', 'document' */
  genus: string
  /** Storage reference (R2 key, signed URL, etc.) */
  ref: string
  /** Optional caption for the media */
  titulus?: string
}

/**
 * Responsum — an outbound normalized response payload.
 * "responsum" = answer, response (Latin, 2nd decl. n., from respondere).
 *
 * The Allocutio takes a Responsum and renders it in the platform's native
 * format: Telegram sendMessage, Discord interaction reply, HTTP JSON body.
 *
 * Content is platform-agnostic here. The adapter translates 'markup' to
 * Telegram MarkdownV2, Discord embeds, or HTML as needed.
 */
export interface Responsum {
  /** FK → Nuntius being replied to. Absent for unsolicited responses. */
  nuntiusId?: string
  /** FK → Actum. Set when this response carries an execution result. */
  actumId?: string

  /** Plain text — fallback for platforms that don't support markup */
  textus?: string
  /**
   * Markdown content — the primary rich representation.
   * Each Allocutio translates this to its platform's markdown dialect.
   */
  markup?: string

  /** Media attachments */
  adnexa?: ResponsumAdnexum[]

  /**
   * Whether this response should delete itself after viewing.
   * Telegram: volatile message. Discord: ephemeral flag. HTTP: ignored.
   */
  ephemeron?: boolean
}

// ---------------------------------------------------------------------------
// Allocutio — platform adapter interface
// ---------------------------------------------------------------------------

/**
 * Allocutio — the platform adapter.
 * "allocutio" = formal address to an assembly (from alloqui: to address).
 *
 * One Allocutio per platform. Each knows how to:
 *   1. Parse the platform's raw webhook/event payload into a Nuntius.
 *   2. Resolve a Nuntius into a crystal-native Inceptio (execution intent).
 *   3. Send a Responsum back to the platform.
 *
 * The resolve() method is where platform-specific command parsing lives:
 * slash commands, inline buttons, natural language patterns, REST routes.
 * The output is always an Inceptio — the execution rail is platform-blind.
 */
export interface Allocutio {
  platforma: NuntiusPlatforma

  /**
   * Parse a raw platform payload into a normalized Nuntius.
   * "raw" is the platform-native format: Telegram Update, Discord Interaction,
   * HTTP request body, etc.
   */
  parse(raw: unknown): Promise<Nuntius>

  /**
   * Resolve a Nuntius into an execution intent.
   * Returns null when the message carries no executable intent
   * (e.g. plain chat messages not directed at the bot, empty messages).
   *
   * This is the platform's parser: it knows "/imagine" means DALL·E,
   * "!run <modus>" means a specific tool, a button press maps to an aditus, etc.
   * The output Inceptio is crystal-native and platform-blind.
   */
  resolve(nuntius: Nuntius): Promise<Inceptio | null>

  /**
   * Send a Responsum to the platform.
   * "target" is the platform-native destination identifier.
   */
  send(responsum: Responsum, target: { conversationId: string }): Promise<void>
}

// ---------------------------------------------------------------------------
// Allocutionum — adapter registry
// ---------------------------------------------------------------------------

/**
 * Allocutionum — genitive plural "of the addresses."
 * The registry of platform adapters.
 *
 * Analogous to Cursorum (maps ministerium → Cursor):
 * Allocutionum maps NuntiusPlatforma → Allocutio.
 *
 * Adding a new platform = one Allocutio implementation + one register() call.
 * The rest of the ingest pipeline is unchanged.
 */
export interface Allocutionum {
  register(allocutio: Allocutio): void
  resolve(platforma: NuntiusPlatforma): Allocutio
}
