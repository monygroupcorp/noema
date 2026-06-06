import { inlineKeyboard, btn } from '../telegramRender.js'
import { COPY, HELP_TEXT } from '../../lexicon/copy.js'
import { SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH } from '../../../crystal/shareToken.js'

export { HELP_TEXT }

const DEFAULT_MAKE_MODUS = 'flux-schnell'
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
   * List the runnable flow slugs (canonical atomic Modorum entries) for /run
   * validation + usage hints. Optional — when absent, /run skips validation and
   * lets the downstream flow handle an unknown modus. Wired by TelegramAllocutio
   * against the modus registry.
   */
  flows?(): Promise<string[]>
}

/**
 * CommandRouter — maps slash commands to flow-router actions. The reaction-prep
 * (🤔 + remembering the command message) stays in the adapter; this owns only the
 * command surface, so the command set is one readable, testable place.
 */
export class CommandRouter {
  constructor(private readonly deps: CommandDeps) {}

  async dispatch(userId: string, chatId: number, text: string, messageId?: number): Promise<void> {
    const cmd = text.split(' ')[0].split('@')[0].toLowerCase()
    const ack = () => { if (messageId !== undefined) this.deps.ack(chatId, messageId) }

    switch (cmd) {
      case '/start': {
        // Telegram deep links arrive as `/start <arg>` (e.g. /start pod_<token>).
        // Validate strictly — attacker-controllable input.
        const arg = text.split(/\s+/)[1] ?? ''
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
        const prompt = text.replace(/^\/make(?:@\S+)?\s*/i, '').trim()
        await this.deps.enterExecute(userId, {
          modusId: DEFAULT_MAKE_MODUS,
          aditus: prompt ? { prompt } : {},
          browsePageIndex: 0,
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
          const available = await this.deps.flows()
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
        })
        // No ack here — same as /make: the Stream reaction owns the accepted signal.
        return
      }

      case '/chat':
        await this.deps.enterExecute(userId, { modusId: 'modus.chatgpt', aditus: {}, browsePageIndex: 0 })
        ack()
        return

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

      case '/help':
        await this.deps.sendMessage(chatId, COPY.command.help)
        return

      default:
        await this.deps.sendMessage(chatId, COPY.command.unknown)
        return
    }
  }
}
