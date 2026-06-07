import { inlineKeyboard, btn } from '../telegramRender.js'
import { COPY, HELP_TEXT } from '../../lexicon/copy.js'
import { SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH } from '../../../crystal/shareToken.js'

export { HELP_TEXT }

/**
 * CANON_VERBS — the platform's taste: each canon verb's default flow (verb → flowId).
 * Seeded ONLY with verbs whose flows exist today. The remaining elemental verbs
 * (`effect`/`animate`/`direct`/`compose`) are deliberately omitted — they're a one-line
 * add here once their default flow ships (ADR-0003). A per-user rebind (resolveVerb)
 * overrides this; absent an override, this table is the answer.
 */
const CANON_VERBS: Record<string, string> = { make: 'flux-schnell', chat: 'modus.chatgpt' }
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
}

/**
 * CommandRouter — maps slash commands to flow-router actions. The reaction-prep
 * (🤔 + remembering the command message) stays in the adapter; this owns only the
 * command surface, so the command set is one readable, testable place.
 */
export class CommandRouter {
  constructor(private readonly deps: CommandDeps) {}

  async dispatch(userId: string, chatId: number, text: string, messageId?: number, entryImageUrl?: string): Promise<void> {
    const cmd = text.split(' ')[0].split('@')[0].toLowerCase()
    const ack = () => { if (messageId !== undefined) this.deps.ack(chatId, messageId) }
    // An entry image (attached photo / replied-to photo) rides into the flow state on
    // the verbs that accept one; ExecuteFlow maps it onto the first image Porta.
    const entry = entryImageUrl !== undefined ? { entryImageUrl } : {}

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
          const available = await this.deps.flows()
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

      case '/help':
        await this.deps.sendMessage(chatId, COPY.command.help)
        return

      default:
        await this.deps.sendMessage(chatId, COPY.command.unknown)
        return
    }
  }
}
