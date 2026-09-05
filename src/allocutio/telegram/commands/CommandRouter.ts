import { inlineKeyboard, btn } from '../telegramRender.js'
import type { EnvelopeMediaType } from '../envelopeMedia.js'
import { COPY, HELP_TEXT } from '../../lexicon/copy.js'
import { SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH } from '../../../crystal/shareToken.js'
import { CANON_VERBS } from '../../../crystal/canonVerbs.js'

export { HELP_TEXT }

const SHARE_TOKEN_RE = new RegExp(`^pod_([${SHARE_TOKEN_ALPHABET}]{${SHARE_TOKEN_LENGTH}})$`)
/** A flow slug is a clean lowercase id (`flux-schnell`, `sd1-5`) — no dots/spaces. */
const FLOW_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** What a command needs to do — the adapter wires these to the flow router + sender. */
export interface CommandDeps {
  /** Enter the execute flow for a user, optionally prefilled with state. */
  enterExecute(userId: string, state?: Record<string, unknown>): Promise<void>
  /** Cancel the user's current flow context. */
  cancel(userId: string): void
  sendMessage(chatId: number, text: string, extra?: { reply_markup?: unknown }): Promise<unknown>
  sendStart(chatId: number): Promise<void>
  /** Acknowledge a command on its message (👌). Skipped for /make — its ack is the Stream reaction. */
  ack(chatId: number, messageId: number): void
  /**
   * Stash a deep-link share token for the user. Their next /make consumes it +
   * routes onto the host's pod via Praefectus.findByShareToken. Token shape is
   * validated against SHARE_TOKEN_ALPHABET+LENGTH before reaching here.
   */
  setPendingShareToken?(userId: string, token: string): void
  /**
   * Render and send the /status user HUD for this user/chat. Optional — when
   * absent, /status falls back to the legacy "coming soon" stub. Wired by
   * TelegramAllocutio against the status aggregator + StatusView.
   */
  showStatus?(userId: string, chatId: number): Promise<void>
  /**
   * Open the standalone Mod • loadout/Add menu — a pod-less, warm-clock-less session for
   * building a loadout before (or independent of) a gen. The pending loadout carries to the
   * next /make. Optional — absent in tests/contexts without the bulletin manager.
   */
  arm?(userId: string, chatId: number): void
  /**
   * List the runnable flow slugs for a user — the canonical atomic Modorum
   * entries plus the caller's own saved (`canonica:false`, owned) flows — for /run
   * + /bind validation and usage hints. Optional — when absent, /run skips
   * validation and lets the downstream flow handle an unknown modus. Wired by
   * TelegramAllocutio against the modus registry, keyed by the resolved owner.
   */
  flows?(userId: string): Promise<string[]>
  /**
   * Resolve a user's override flow for a canon verb (e.g. their /bind make sd1-5).
   * Returns the override flowId, or undefined to fall through to the CANON_VERBS
   * default table. Optional — when absent, every verb uses the platform default.
   * Wired by TelegramAllocutio against the owner-keyed preference store (follow-on).
   */
  resolveVerb?(userId: string, verb: string): Promise<string | undefined>
  /**
   * Persist a user's verb→flow binding (the /bind affordance). Optional — when
   * absent, /bind reports the command as unavailable (same shape as /arm without
   * its dep). Wired by TelegramAllocutio against the same owner-keyed store.
   */
  bindVerb?(userId: string, verb: string, modusId: string): Promise<void>
  /**
   * Redeem a web-issued account-link code (`/start link_<code>`): re-point this Telegram
   * identity at the web account so it becomes a recoverable backup. Returns the outcome.
   * Optional — absent in contexts without the link-token store.
   */
  linkTelegram?(userId: string, code: string): Promise<'linked' | 'invalid'>
  /**
   * Mint a one-time recovery code for this Telegram identity (`/recover`) — the user pastes
   * it on the web sign-in screen to log back in. Optional — same wiring as linkTelegram.
   */
  issueTelegramRecovery?(userId: string): Promise<string>
}

/** Deep-link account-link payload: `/start link_<code>` (code is base64url from makeLinkToken). */
const LINK_PAYLOAD_RE = /^link_([A-Za-z0-9_-]+)$/

/** Every command this router answers. Kept beside the switch it mirrors. */
const KNOWN_COMMANDS = new Set([
  '/start', '/make', '/run', '/bind', '/chat', '/flows', '/arm',
  '/cancel', '/stop', '/status', '/wallet', '/recover', '/help',
])

/** Parse a message's leading token into a bare command (`/MAKE@bot a cat` → `/make`). */
export function parseCommand(text: string): string {
  return text.split(' ')[0].split('@')[0].toLowerCase()
}

/** Does this router have a case for the message's command? */
export function isKnownCommand(text: string): boolean {
  return KNOWN_COMMANDS.has(parseCommand(text))
}

/**
 * CommandRouter — maps slash commands to flow-router actions. The reaction-prep
 * (🤔 + remembering the command message) stays in the adapter; this owns only the
 * command surface, so the command set is one readable, testable place.
 */
export class CommandRouter {
  constructor(private readonly deps: CommandDeps) {}

  /**
   * @param opts.silentOnUnknown  Swallow the "Unknown command" reply instead of sending it.
   *   Set for a group message that did not name this bot: `/foo` in a shared chat is far
   *   more likely to be another bot's command than a typo aimed at us, and answering it
   *   makes us the bot that talks over every other bot in the room.
   */
  async dispatch(
    userId: string,
    chatId: number,
    text: string,
    messageId?: number,
    entryMedia?: { url: string; type: EnvelopeMediaType },
    opts?: { silentOnUnknown?: boolean },
  ): Promise<void> {
    const cmd = parseCommand(text)
    const ack = () => { if (messageId !== undefined) this.deps.ack(chatId, messageId) }
    // Entry media (attached / replied-to photo, video, clip or file) rides into the flow
    // state on the verbs that accept it; ExecuteFlow maps it onto the first Porta whose
    // type matches.
    const entry = entryMedia !== undefined
      ? { entryMediaUrl: entryMedia.url, entryMediaType: entryMedia.type }
      : {}

    switch (cmd) {
      case '/start': {
        // Telegram deep links arrive as `/start <arg>` (e.g. /start pod_<token>).
        // Validate strictly — attacker-controllable input.
        const arg = text.split(/\s+/)[1] ?? ''
        // Account-link deep link: `/start link_<code>` binds this Telegram as an account backup.
        const linkM = arg.match(LINK_PAYLOAD_RE)
        if (linkM && this.deps.linkTelegram) {
          const outcome = await this.deps.linkTelegram(userId, linkM[1])
          await this.deps.sendMessage(chatId, outcome === 'linked'
            ? '✅ Your Telegram is now linked as a backup — if you forget your password, send /recover here to get back in.'
            : '⚠️ That link expired or was already used. Open your NOEMA profile and start the Telegram link again.')
          ack()
          return
        }
        // Recovery deep link: `/start recover` = the /recover command (for a tapped link).
        if (arg === 'recover' && this.deps.issueTelegramRecovery) {
          await this._sendRecoveryCode(userId, chatId)
          ack()
          return
        }
        const m = arg.match(SHARE_TOKEN_RE)
        if (m && this.deps.setPendingShareToken) {
          this.deps.setPendingShareToken(userId, m[1])
        }
        await this.deps.sendStart(chatId)
        ack()
        return
      }

      case '/make': {
        // Parse an optional prompt: /make <prompt text>
        // NOTE: we deliberately do NOT support `/make use <flow>` rebind syntax —
        // it's parser-ambiguous (`/make use the force` would bind to flow "the").
        // Rebind is the dedicated, unambiguous /bind verb instead (ADR-0003).
        const prompt = text.replace(/^\/make(?:@\S+)?\s*/i, '').trim()
        // verb → flow resolution: per-user override (if any) ?? platform default table.
        const modusId = (await this.deps.resolveVerb?.(userId, 'make')) ?? CANON_VERBS.make
        await this.deps.enterExecute(userId, {
          modusId,
          aditus: prompt ? { prompt } : {},
          browsePageIndex: 0,
          ...entry,
        })
        // No ack here: the "accepted" reaction (👌 cold / 🔥 warm) is owned by the
        // Stream registration, so a warm run never flashes 👌.
        return
      }

      case '/run': {
        // Universal runner: /run <flow-slug> [prompt]. First token is the flow slug;
        // the remainder (if any) is the prompt. /make keeps running its bound default.
        const rest = text.replace(/^\/run(?:@\S+)?\s*/i, '').trim()
        const [slug, ...promptParts] = rest ? rest.split(/\s+/) : []
        const prompt = promptParts.join(' ')

        // Bare /run or a non-slug-shaped token → usage (with an ack; no run dispatched).
        if (!slug || !FLOW_SLUG_RE.test(slug)) {
          await this.deps.sendMessage(chatId, COPY.command.runUsage)
          ack()
          return
        }

        // When the flow registry is wired, reject unknown slugs with the available list.
        if (this.deps.flows) {
          const available = await this.deps.flows(userId)
          if (!available.includes(slug)) {
            await this.deps.sendMessage(chatId, COPY.command.runUnknown(slug, available))
            ack()
            return
          }
        }

        await this.deps.enterExecute(userId, {
          modusId: slug,
          aditus: prompt ? { prompt } : {},
          browsePageIndex: 0,
          ...entry,
        })
        // No ack here — same as /make: the Stream reaction owns the accepted signal.
        return
      }

      case '/bind': {
        // Rebind a canon verb to a flow: /bind <verb> <flow>. The dedicated,
        // unambiguous alternative to a `/make use <flow>` syntax (see /make note).
        const rest = text.replace(/^\/bind(?:@\S+)?\s*/i, '').trim()
        const [verb, slug] = rest ? rest.split(/\s+/) : []

        // Validate the verb is a known canon verb.
        if (!verb || !(verb in CANON_VERBS)) {
          await this.deps.sendMessage(
            chatId,
            verb ? COPY.command.bindUnknownVerb(verb, Object.keys(CANON_VERBS)) : COPY.command.bindUsage,
          )
          ack()
          return
        }

        // Validate the flow slug shape, and (when the registry is wired) that it exists.
        if (!slug || !FLOW_SLUG_RE.test(slug)) {
          await this.deps.sendMessage(chatId, COPY.command.bindUsage)
          ack()
          return
        }
        if (this.deps.flows) {
          const available = await this.deps.flows(userId)
          if (!available.includes(slug)) {
            await this.deps.sendMessage(chatId, COPY.command.bindUnknownFlow(slug, available))
            ack()
            return
          }
        }

        // No persistence dep wired → report unavailable (same shape as /arm without arm).
        if (!this.deps.bindVerb) {
          await this.deps.sendMessage(chatId, COPY.command.unknown)
          return
        }

        await this.deps.bindVerb(userId, verb, slug)
        await this.deps.sendMessage(chatId, COPY.command.bindOk(verb, slug))
        ack()
        return
      }

      case '/chat': {
        const modusId = (await this.deps.resolveVerb?.(userId, 'chat')) ?? CANON_VERBS.chat
        await this.deps.enterExecute(userId, { modusId, aditus: {}, browsePageIndex: 0, ...entry })
        ack()
        return
      }

      case '/flows':
        await this.deps.enterExecute(userId)
        ack()
        return

      case '/arm':
        if (this.deps.arm) {
          this.deps.arm(userId, chatId)
          ack()
        } else {
          await this.deps.sendMessage(chatId, COPY.command.unknown)
        }
        return

      case '/cancel':
      case '/stop':
        this.deps.cancel(userId)
        await this.deps.sendMessage(chatId, COPY.command.cancelled)
        return

      case '/status':
        if (this.deps.showStatus) {
          await this.deps.showStatus(userId, chatId)
        } else {
          // Fallback for tests/contexts that don't wire the status aggregator.
          await this.deps.sendMessage(chatId, COPY.command.statusComingSoon, {
            reply_markup: inlineKeyboard([[btn('connect wallet', 'a:connect_wallet'), btn('top up', 'a:topup')]]),
          })
        }
        return

      case '/wallet':
        await this.deps.sendMessage(chatId, COPY.command.walletComingSoon, {
          reply_markup: inlineKeyboard([[btn('connect wallet', 'a:connect_wallet'), btn('balance', 'a:balance')]]),
        })
        return

      case '/recover':
        if (this.deps.issueTelegramRecovery) {
          await this._sendRecoveryCode(userId, chatId)
          ack()
        } else {
          await this.deps.sendMessage(chatId, COPY.command.unknown)
        }
        return

      case '/help':
        await this.deps.sendMessage(chatId, COPY.command.help)
        return

      default:
        // Not ours to answer unless we were addressed — see `silentOnUnknown`.
        if (opts?.silentOnUnknown) return
        await this.deps.sendMessage(chatId, COPY.command.unknown)
        return
    }
  }

  /** Mint + deliver a one-time recovery code the user pastes on the web sign-in screen. */
  private async _sendRecoveryCode(userId: string, chatId: number): Promise<void> {
    const code = await this.deps.issueTelegramRecovery!(userId)
    await this.deps.sendMessage(chatId,
      `Your NOEMA recovery code (valid 10 minutes):\n\n${code}\n\n` +
      'On the sign-in screen, tap "Recover with Telegram" and paste this code to get back in.')
  }
}
