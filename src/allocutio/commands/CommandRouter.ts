import { inlineKeyboard, btn } from '../telegramRender.js'

export const HELP_TEXT = `\
noema

  Creative
  /make    — generate images and art
  /chat    — chat with an AI model
  /flows   — browse all available tools

  Account
  /status  — view balance and account
  /wallet  — manage connected wallets

  /cancel  — cancel current action
  /help    — show this message\
`

const DEFAULT_MAKE_MODUS = 'runmake.flux-schnell'

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
      case '/start':
        await this.deps.sendStart(chatId)
        ack()
        return

      case '/run':
      case '/make': {
        // Parse an optional prompt: /make <prompt text>
        const prompt = text.replace(/^\/(?:make|run)(?:@\S+)?\s*/i, '').trim()
        await this.deps.enterExecute(userId, {
          modusId: DEFAULT_MAKE_MODUS,
          aditus: prompt ? { prompt } : {},
          browsePageIndex: 0,
        })
        // No ack here: the "accepted" reaction (👌 cold / 🔥 warm) is owned by the
        // Stream registration, so a warm run never flashes 👌.
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

      case '/cancel':
      case '/stop':
        this.deps.cancel(userId)
        await this.deps.sendMessage(chatId, 'Cancelled.')
        return

      case '/status':
        await this.deps.sendMessage(chatId, 'Balance and account info coming soon.', {
          reply_markup: inlineKeyboard([[btn('connect wallet', 'a:connect_wallet'), btn('top up', 'a:topup')]]),
        })
        return

      case '/wallet':
        await this.deps.sendMessage(chatId, 'Wallet management coming soon.', {
          reply_markup: inlineKeyboard([[btn('connect wallet', 'a:connect_wallet'), btn('balance', 'a:balance')]]),
        })
        return

      case '/help':
        await this.deps.sendMessage(chatId, HELP_TEXT)
        return

      default:
        await this.deps.sendMessage(chatId, `Unknown command. Type /help to see what's available.`)
        return
    }
  }
}
