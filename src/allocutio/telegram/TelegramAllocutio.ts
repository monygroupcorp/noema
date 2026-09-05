// =============================================================================
// TelegramAllocutio — Telegram platform adapter for FlowEngine
// =============================================================================
//
// Bridges raw Telegram webhook Update objects to FlowRouter.
// Handles command parsing, callback_query decoding, and primitive rendering.
// =============================================================================

import type { Primitive, Step, Resolution, FlowContext, AuctorKey } from '../../flow/types.js'
import type { Allocutio, Nuntius, Responsum } from '../../types/allocutio.js'
import type { Inceptio } from '../../types/cursus.js'
import { makeLogger } from '../../lib/logger.js'
import { bus, type StageInfo } from '../../lib/bus.js'
import type { Progressus } from '../../types/progressus.js'
import { withTrace, getTrace, makeTraceContext } from '../../lib/trace.js'
import type { WideEvent } from '../../lib/wide.js'
import type { MateriaStore } from '../../types/materia.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { Actum } from '../../types/actum.js'
import type { Signorum } from '../../types/significandi.js'
import type { Modorum } from '../../types/modus.js'
import type { Actorum } from '../../types/cursus.js'
import type { Intellarum } from '../../types/intelligendi.js'
import type { Fundamentorum } from '../../types/fundamentum.js'
import type { Consuetudinum } from '../../types/consuetudo.js'
import type { ActumIndexStore } from '../../types/actumIndex.js'
import { mintShareToken } from '../../crystal/shareToken.js'
import { aggregateStatus } from '../lexicon/status/aggregate.js'
import { StatusView } from '../lexicon/status/StatusView.js'
import { classifyError } from '../../lib/classifyError.js'
import { BulletinManager, type BulletinSink } from '../lexicon/bulletin/BulletinManager.js'
import type { Loadout, PendingModel } from '../lexicon/bulletin/types.js'
import { BulletinModelCatalog } from './BulletinModelCatalog.js'
import { envelopeMedia, type EnvelopeMediaType } from './envelopeMedia.js'

/** Infer the runtime shape from a studio's container image name (best-effort label for the
 *  loadout view). ComfyUI is the common one today; vLLM / llama.cpp / Diffusers are coming. */
function inferRuntime(image?: string): string | undefined {
  if (!image) return undefined
  const s = image.toLowerCase()
  if (s.includes('comfy')) return 'ComfyUI'
  if (s.includes('llama')) return 'llama.cpp'
  if (s.includes('vllm'))  return 'vLLM'
  if (s.includes('diffus')) return 'Diffusers'
  return undefined
}
import { DeliveryMenu, type DeliverySink } from '../lexicon/delivery/DeliveryMenu.js'
import { SaveAsMenu, type SaveAsSeed } from './SaveAsMenu.js'
import { ReactionController } from './reactions/ReactionController.js'
import type { UiKeyboard } from '../lexicon/ui/Keyboard.js'
import { inlineKeyboard, btn, renderPrimitive, decodeCallbackData, type InlineKeyboard } from './telegramRender.js'
import { CANON_VERBS } from '../../crystal/canonVerbs.js'
import { CommandRouter, isKnownCommand } from './commands/CommandRouter.js'
import { REACTION } from '../lexicon/symbols.js'
import { COPY } from '../lexicon/copy.js'
import { isPrivateMarker } from '../../crystal/MediaFetcher.js'
import type { TelegramUpdate, TelegramSender, IdentityResolver, RouterDeps } from './telegramTypes.js'
// Re-export the adapter contracts so existing importers (index, TelegramSenderAdapter) keep working.
export type { TelegramUpdate, TelegramSender, IdentityResolver, RouterDeps } from './telegramTypes.js'

const log = makeLogger('telegram:allocutio')

/** One media item of a result, ready to send: `url` is always something Telegram can fetch, and
 *  `isPrivate` records that it got there through a one-send grant on a private object — the flag
 *  the failure paths read before deciding whether a link may be printed into the chat. */
type DeliverableMedium =
  NonNullable<Extract<Primitive, { kind: 'Result' }>['media']>[number] & { isPrivate: boolean }

// ---------------------------------------------------------------------------
// TelegramAllocutio
// ---------------------------------------------------------------------------

export class TelegramAllocutio implements Omit<Allocutio, 'parse' | 'resolve' | 'send'> {
  readonly platforma = 'telegram' as const

  private readonly router: RouterDeps
  private readonly sender: TelegramSender
  private readonly identity: IdentityResolver
  private readonly deps: {
    router: RouterDeps
    sender: TelegramSender
    identity: IdentityResolver
    /** Unix ms timestamp of bot startup. Messages older than this are dropped. */
    botStartupTime?: number
    /** Pod registry — used to set a pod's warmUntil from the warm-window buttons. */
    materiae?: MateriaStore
    /** Terminate a pod by its external id — backs the "destroy now" button. */
    terminatePod?: (podId: string) => Promise<void>
    /** Look up an actum (for the delivery menu's Info stats). */
    acta?: { findById(id: string): Promise<Actum | null> }
    /** Cancel an in-flight actum — fails it (releases reserved signa). Returns true if it
     *  actually refunded (false if the actum was already terminal). Backs destroy/retry. */
    cancelActum?: (actumId: string, reason: string) => Promise<boolean>
    /** Host-guest bond store — when present, group provisionings get their admin set
     *  resolved + stamped into Hospitium.adminAnimaIds on pod.parked. */
    hospitia?: HospitiumStore
    /** Ledger — used by /status to read balance + earnings. Optional. */
    signorum?: Signorum
    /** Registry of modi — used by /status to resolve modus labels on gen rows. */
    modorum?: Modorum
    /** Actorum — used by /status to look up the user's in-flight actums. */
    actorum?: Actorum
    /** Intellarum — resolves intellaIds in `Mod • → View loadout` to human labels. */
    intellarum?: Intellarum
    /** Per-anima dispatch index — populates /status YOUR GENS + per-row Cancel. */
    actumIndex?: ActumIndexStore
    /** Owner-keyed verb→flow bindings — backs /bind persistence + per-user /make resolution. */
    consuetudinum?: Consuetudinum
    /** Bot's @username — composes `https://t.me/<bot>?start=pod_<token>` share links. */
    botUsername?: string
    /** No-interaction window before the bulletin auto-confirms the warm choice. Default 20s. */
    autoSettleMs?: number
    /** Resolve a `noema-private://` marker into a short-lived link Telegram can fetch
     *  server-side. Absent → a private run's media cannot be delivered on this bot. */
    resolvePrivateMedia?: (marker: string) => Promise<string | undefined>
  }

  // chatId lookup: platform:userId → chatId (set when first message arrives)
  private readonly chatIds = new Map<string, number>()

  // pending edit: platform:userId → messageId of the message to edit in place
  private readonly pendingEditMessageIds = new Map<string, number>()

  // last command message: platform:userId → messageId of the most recent command message
  private readonly lastCommandMessageIds = new Map<string, number>()

  // Deep-link share tokens: /start pod_<token> stashes here; the user's next
  // /make consumes it onto state.shareTokenHint. TTL'd so abandoned tokens age out.
  private readonly pendingShareTokens = new Map<string, { token: string; expiresAt: number }>()
  private static readonly PENDING_SHARE_TOKEN_TTL_MS = 5 * 60 * 1000

  // Mod • → Add catalog + search (list/search deps + force-reply reply-capture).
  private readonly modelCatalog: BulletinModelCatalog

  // /status message ids per (chat, user) — enables Refresh-in-place edits.
  private readonly statusMessages = new Map<string, { chatId: number; messageId: number }>()

  // The session bulletin (HUD), the delivery menu, and the command-message reaction
  // choreography each live in their own subsystem now; this adapter just feeds them.
  private readonly bulletins: BulletinManager
  private readonly delivery: DeliveryMenu
  private readonly saveAs?: SaveAsMenu
  private readonly reactions: ReactionController
  private readonly commands: CommandRouter

  constructor(deps: {
    router: RouterDeps
    sender: TelegramSender
    identity: IdentityResolver
    /** Unix ms timestamp of bot startup. Messages older than this are dropped. */
    botStartupTime?: number
    materiae?: MateriaStore
    terminatePod?: (podId: string) => Promise<void>
    /** `/arm` Start — lease a warm studio (no gen) for `auctor` via the `Conductor`
     *  (ADR-0006): provision the Materia + bind a Hospitium keyed by the host + open a
     *  budgeted Modo. Container-wired (fake or real Procurator). Absent → no Start. */
    provisionStudio?: (auctor: AuctorKey, opts: { models: PendingModel[]; runtime?: string; warmMs?: number }, onStage?: (stage: string, info?: StageInfo) => void) => Promise<{ podId: string; gpuType?: string; costPerHr?: number; provisionMs?: number } | null>
    /** Live model-apply — download model(s) onto a warm pod (no gen) + merge into installedModels.
     *  Container-wired (fake: simulated; real: comfyrunner /install). Absent → adds always queue. */
    installStudioModels?: (podId: string, intellaIds: string[]) => Promise<{ installedModels: string[] } | null>
    acta?: { findById(id: string): Promise<Actum | null> }
    cancelActum?: (actumId: string, reason: string) => Promise<boolean>
    /** Host-guest bond store — when present, group provisionings get their admin set
     *  resolved + stamped into Hospitium.adminAnimaIds on pod.parked. */
    hospitia?: HospitiumStore
    /** Ledger — used by /status to read balance + earnings. Optional; absent → /status
     *  falls back to the legacy "coming soon" stub. */
    signorum?: Signorum
    /** Registry of modi — used by /status to resolve modus labels on gen rows. */
    modorum?: Modorum
    /** Actorum — used by /status to look up the user's in-flight actums. */
    actorum?: Actorum
    /** Intellarum — resolves intellaIds in `Mod • → View loadout` into human labels. */
    intellarum?: Intellarum
    /** Fundamentorum — the compute-substrate registry the `/arm` chooser projects (ADR-0005). */
    fundamentorum?: Fundamentorum
    /** Per-anima dispatch index — when present, /status YOUR GENS populates
     *  from here and per-row Cancel works. */
    actumIndex?: ActumIndexStore
    /** Owner-keyed verb→flow bindings — backs /bind persistence + per-user /make
     *  resolution. Absent → /bind reports unavailable, every verb uses the default. */
    consuetudinum?: Consuetudinum
    /** Bot's @username — used to compose `https://t.me/<bot>?start=pod_<token>` share links. */
    botUsername?: string
    /** Redeem a web-issued account-link code (`/start link_<code>`) — binds this Telegram as
     *  an account backup. Optional — absent when the link-token store isn't wired. */
    linkTelegramAccount?: (telegramUserId: string, code: string) => Promise<'linked' | 'invalid'>
    /** Mint a one-time recovery code (`/recover`) for this Telegram identity. Optional. */
    issueTelegramRecovery?: (telegramUserId: string) => Promise<string>
    /** No-interaction window before the bulletin auto-confirms the warm choice. Default 20s. */
    autoSettleMs?: number
    /** Resolve a `noema-private://` marker into a short-lived link Telegram can fetch
     *  server-side (private generation, noema-347). The bytes live in a bucket with no public
     *  binding, so a marker is the only thing a private run hands us; the link is minted for
     *  this one send and never appears in the chat — Telegram fetches it and keeps the file.
     *  Absent (no private-outputs store on this deployment) → a private result is not delivered
     *  here, and the user is told so rather than shown a key. */
    resolvePrivateMedia?: (marker: string) => Promise<string | undefined>
  }) {
    this.deps = deps
    this.router = deps.router
    this.sender = deps.sender
    this.identity = deps.identity

    // Mod • → Add catalog/search backend (own module — keeps this adapter lean).
    this.modelCatalog = new BulletinModelCatalog({
      intellarum: deps.intellarum,
      fundamentorum: deps.fundamentorum,
      sender: this.sender,
    })

    // The bulletin subsystem: it owns the journal/ledger/timers/render; we give it a
    // sink (how to put messages on Telegram) and the pod-control deps it needs.
    this.bulletins = new BulletinManager({
      sink: this._bulletinSink(),
      terminatePod: deps.terminatePod,
      cancelActum: deps.cancelActum,
      setPodWarmUntil: (podId, ttlMs) => this._setPodWarmUntil(podId, ttlMs),
      drainStudio:   (podId) => this._drainStudio(podId),
      fetchShareUrl: (podId) => this._fetchShareUrl(podId),
      fetchLoadout:  (podId) => this._fetchLoadout(podId),
      listCategories: () => this.modelCatalog.listCategories(),
      listMount: (mount, opts) => this.modelCatalog.listMount(mount, opts),
      searchModels: (query) => this.modelCatalog.search(query),
      resolveTriggers: (text, opts) => this.modelCatalog.resolveTriggers(text, opts),
      fetchDetail: (intellaId) => this.modelCatalog.detail(intellaId),
      // /arm wizard — flows derived from the base models actually in the catalog (one per family,
      // each with a detail card), then Custom for the manual image→config path. `id` is the base
      // family each flow scopes the model menu to. The list grows as new base weights are added.
      listPresets: () => this.modelCatalog.listFlows(),
      listImages: async () => this.modelCatalog.listImages(),
      listConfigs: async (image) => this.modelCatalog.configsForImage(image),
      startStudio: async (hostUserId, opts, onStage) => {
        if (!deps.provisionStudio) return null
        // Resolve the host's AuctorKey here so the studio is bound to its owner
        // (the host-less-studio fix) — the lifecycle itself lives in the Conductor.
        const auctor = await this.identity.resolve(hostUserId).catch(() => null)
        if (!auctor) return null
        return deps.provisionStudio(auctor, opts, onStage)
      },
      ...(deps.installStudioModels ? { installModels: (podId, ids) => deps.installStudioModels!(podId, ids) } : {}),
      promptSearch: (chatId, hostUserId) => this.modelCatalog.promptSearch(chatId, hostUserId),
      promptTrigger: (chatId, hostUserId) => this.modelCatalog.promptTrigger(chatId, hostUserId),
      autoSettleMs: deps.autoSettleMs,
    })

    // Save-as: flow card / delivery-info → a derived, user-owned Modus. Owns its own
    // force-reply name capture + draft registry (NOT the flow router). Needs the
    // registry to fork from + register into; absent when modorum isn't wired.
    if (deps.modorum) {
      this.saveAs = new SaveAsMenu({
        sink: {
          sendMessage: (chatId, text, extra) => this.sender.sendMessage(chatId, text, extra),
          editMessageText: (chatId, messageId, text, extra) => this.sender.editMessageText(chatId, messageId, text, extra),
          deleteMessage: (chatId, messageId) => this.sender.deleteMessage?.(chatId, messageId) ?? Promise.resolve(),
        },
        modorum: deps.modorum,
        resolveOwner: (userId) => this.identity.resolve(userId),
      })
    }

    // The delivery menu: owns the morphing result row + Info/rating state; we give
    // it a sink, a rerun hook into the flow router, and a save hook into SaveAsMenu.
    this.delivery = new DeliveryMenu({
      sink: this._deliverySink(),
      acta: deps.acta,
      rerun: (actumId, presserUserId, chatId) => this._rerun(actumId, presserUserId, chatId),
      ...(this.saveAs ? { save: (actumId, presserUserId, chatId) => this._saveAs(actumId, presserUserId, chatId) } : {}),
    })

    // The 👌/🔥 reaction choreography on the command message.
    this.reactions = new ReactionController({ react: (c, m, e) => this._react(c, m, e) })

    // The slash-command surface → flow router.
    this.commands = new CommandRouter({
      enterExecute: (userId, state) => this._enterExecute(userId, state),
      setPendingShareToken: (userId, token) => {
        this.pendingShareTokens.set(`telegram:${userId}`, {
          token,
          expiresAt: Date.now() + TelegramAllocutio.PENDING_SHARE_TOKEN_TTL_MS,
        })
      },
      cancel: (userId) => this.router.clear('telegram', userId, String(this.chatIds.get(`telegram:${userId}`) ?? userId)),
      sendMessage: (chatId, text, extra) => this.sender.sendMessage(chatId, text, extra),
      sendStart: (chatId) => this._sendStart(chatId),
      ack: (chatId, messageId) => { void this._react(chatId, messageId, REACTION.ok) },
      showStatus: (userId, chatId) => this._showStatus(userId, chatId),
      arm: (userId, chatId) => { this.chatIds.set(`telegram:${userId}`, chatId); void this.bulletins.arm(chatId, userId) },
      // /run validation + usage hints: the runnable flow slugs are the canonical
      // atomic Modorum entries. Omitted when the registry isn't wired.
      ...(deps.modorum ? {
        flows: async (userId) => {
          const owner = await this.identity.resolve(userId)
          const [canon, owned] = await Promise.all([
            deps.modorum!.list({ genus: 'atomicus', canonica: true }),
            deps.modorum!.list({ genus: 'atomicus', auctor: owner }),
          ])
          return [...new Set([...canon, ...owned].map(m => m.id))]
        },
      } : {}),
      // Owner-keyed verb bindings: /make resolution + /bind persistence. Omitted
      // when the store isn't wired (so tests/contexts without it use the defaults).
      ...(deps.consuetudinum ? {
        resolveVerb: async (userId, verb) => deps.consuetudinum!.resolve(await this.identity.resolve(userId), verb),
        bindVerb: async (userId, verb, modusId) => deps.consuetudinum!.bind(await this.identity.resolve(userId), verb, modusId),
      } : {}),
      // Account backup/recovery (username-auth soul ⇆ Telegram) — wired in index.ts against
      // the link-token store. Absent → /recover + link deep links report unavailable.
      ...(deps.linkTelegramAccount ? { linkTelegram: deps.linkTelegramAccount } : {}),
      ...(deps.issueTelegramRecovery ? { issueTelegramRecovery: deps.issueTelegramRecovery } : {}),
    })

    // Wire router callbacks
    this.router.onStep((ctx, step) => { void this._handleStep(ctx, step) })
    this.router.onResolution((ctx, resolution) => { void this._handleResolution(ctx, resolution) })

    // Pod lifecycle → bulletin manager (+ the local reaction bookkeeping). The owned
    // `actum.progressus` is the single status channel (#6e retired the `actum.stage` shim):
    // it drives the bulletin journal/live AND the 🔥 warm reaction.
    bus.on('actum.progressus', (data) => { void this._handleActumProgressus(data) })
    bus.on('actum.complete', (wide) => { void this._handleActumComplete(wide) })
    bus.on('actum.fail', (wide) => { void this._handleActumFail(wide) })
    bus.on('pod.reaped', ({ externusId }) => { this.bulletins.onReaped(externusId) })
    // Late-binding hosting metadata: resolve group admins and stamp Hospitium.
    bus.on('pod.parked', (data) => { void this._handlePodParked(data) })
  }

  /** Map a neutral UI keyboard to Telegram's inline-keyboard shape. */
  private _toInline(kb: UiKeyboard): InlineKeyboard {
    return inlineKeyboard(kb.map(row => row.map(b => btn(b.label, b.data))))
  }

  /** How the bulletin manager puts messages on Telegram (BulletinSink). */
  private _bulletinSink(): BulletinSink {
    return {
      post: async (chatId, text, kb) => {
        try {
          const msg = await this.sender.sendMessage(chatId, text, { reply_markup: this._toInline(kb) })
          return msg.message_id
        } catch { return null }
      },
      edit: async (chatId, messageId, text, kb) => {
        await this.sender.editMessageText(chatId, messageId, text, { reply_markup: this._toInline(kb) }).catch(() => {})
      },
      remove: async (chatId, messageId) => { void this.sender.deleteMessage?.(chatId, messageId).catch(() => {}) },
    }
  }

  /** How the delivery menu edits a delivered result (DeliverySink). */
  private _deliverySink(): DeliverySink {
    return {
      editMarkup: async (chatId, messageId, kb) => {
        await this.sender.editMessageReplyMarkup?.(chatId, messageId, this._toInline(kb)).catch(() => {})
      },
      editCaption: async (chatId, messageId, text, kb) => {
        await this.sender.editMessageCaption?.(chatId, messageId, text, { reply_markup: this._toInline(kb) }).catch(() => {})
      },
      editText: async (chatId, messageId, text, kb) => {
        await this.sender.editMessageText(chatId, messageId, text, { reply_markup: this._toInline(kb) }).catch(() => {})
      },
    }
  }

  /** Enter the execute flow for a user, optionally prefilled — the single path used by
   *  slash commands and start-screen shortcuts alike. */
  private async _enterExecute(userId: string, state?: Record<string, unknown>): Promise<void> {
    const identity = await this.identity.resolve(userId)
    // Drain any pending deep-link share token onto the next flow's state. Expired
    // tokens are silently dropped (the user just gets a normal cold start).
    const userKey = `telegram:${userId}`
    const pending = this.pendingShareTokens.get(userKey)
    if (pending) {
      this.pendingShareTokens.delete(userKey)
      if (Date.now() < pending.expiresAt) {
        state = { ...(state ?? {}), shareTokenHint: pending.token }
      }
    }

    // Mod • → Add: fold the chat's queued loadout onto the flow as `pinnedModels`. The
    // Compiler unions them into spec.models so the missing weights download on this gen.
    // Cleared at dispatch (queued once, not re-applied). Skipped for the chat modus — the
    // pending loadout belongs to the image studio in this chat, not a /chat turn.
    const chatId = this.chatIds.get(userKey)
    if (chatId !== undefined && (state?.modusId as string | undefined) !== CANON_VERBS.chat) {
      const queued = this.bulletins.pendingModelsFor(chatId)
      if (queued.length > 0) {
        const pinnedModels = queued.map(m => m.genus === 'lora'
          ? { role: 'lora',       id: m.intellaId, dest: `models/loras/${m.intellaId}.safetensors` }
          : { role: 'checkpoint', id: m.intellaId, dest: `models/checkpoints/${m.intellaId}.safetensors` })
        state = { ...(state ?? {}), pinnedModels }
        this.bulletins.clearPendingFor(chatId)
      }
    }

    // Scoped to the chat this entry came from — the caller (a command or start-screen
    // button) always runs downstream of a message/callback that already stamped chatIds.
    await this.router.enter('execute', 'telegram', userId, String(chatId ?? userId), identity, state ? { state } : undefined)
  }

  /** Re-run an actum under the presser (presser pays), prefilled with its modus + params. */
  private async _rerun(actumId: string, presserUserId: string, chatId: number): Promise<void> {
    this.chatIds.set(`telegram:${presserUserId}`, chatId)
    const actum = await this.deps.acta?.findById(actumId).catch(() => null)
    if (!actum) return
    const identity = await this.identity.resolve(presserUserId)
    // Lands in CONFIGURE prefilled with the original params; the presser submits → they pay.
    // Scoped to the callback's own chat (the presser's interaction), not the flow-owner's.
    await this.router.enter('execute', 'telegram', presserUserId, String(chatId), identity, {
      state: { modusId: actum.modusId, aditus: actum.aditus, browsePageIndex: 0 },
    })
  }

  /** Delivery-info entry: open Save-as seeded from the Actum's modus + aditus + pinnedModels. */
  private async _saveAs(actumId: string, presserUserId: string, chatId: number): Promise<void> {
    if (!this.saveAs) return
    const actum = await this.deps.acta?.findById(actumId).catch(() => null)
    if (!actum) return
    const seed: SaveAsSeed = {
      baseModusId: actum.modusId,
      aditus: actum.aditus,
      // First-class field (actum.ts:135) — NOT smuggled through aditus._pinnedModels.
      ...(actum.pinnedModels?.length ? { pinned: actum.pinnedModels.map(m => ({ id: m.id })) } : {}),
    }
    await this.saveAs.open(chatId, presserUserId, seed)
  }

  /** Flow-card entry: open Save-as seeded from the active flow's card state. */
  private async _saveAsFromCard(userId: string, chatId: number): Promise<void> {
    if (!this.saveAs) return
    const ctx = this.router.peek('telegram', userId, String(chatId))
    const state = ctx?.state as { modusId?: string; aditus?: Record<string, unknown>; pinnedModels?: Array<{ id: string }> } | undefined
    if (!state?.modusId) return
    const seed: SaveAsSeed = {
      baseModusId: state.modusId,
      aditus: state.aditus ?? {},
      ...(state.pinnedModels?.length ? { pinned: state.pinnedModels.map(m => ({ id: m.id })) } : {}),
    }
    await this.saveAs.open(chatId, userId, seed)
  }

  /** Resolve a pod's Materia and stamp its warm deadline (backs the warm-window buttons). */
  private async _setPodWarmUntil(podId: string, ttlMs: number): Promise<void> {
    if (!this.deps.materiae) return
    const pods = await this.deps.materiae.findActive().catch(() => [])
    const m = pods.find(p => p.externusId === podId)
    if (m) await this.deps.materiae.update(m.id, { warmUntil: new Date(Date.now() + ttlMs) }).catch(() => {})
  }

  // ── Bulletin backend hooks (Phase D wrap-up) ───────────────────────────────
  // The bulletin lexicon defines the action surface; these methods do the real
  // work. Each is keyed by RunPod's `podId` (the Materia.externusId) since
  // that's the identifier the bulletin tracks on its session.

  /** Destroy → Drain: set Materia.drainOnly so the idle reaper terminates once
   *  the queue empties. New guest gens are refused at admission. */
  private async _drainStudio(podId: string): Promise<void> {
    if (!this.deps.materiae) return
    const pods = await this.deps.materiae.findActive().catch(() => [])
    const m = pods.find(p => p.externusId === podId)
    if (!m) return
    await this.deps.materiae.update(m.id, { drainOnly: true }).catch(() => {})
    const { bus } = await import('../../lib/bus.js')
    bus.emit('studio.draining', { materiaId: m.id })
  }

  /** Share → Copy link: mint a shareToken on the Materia if one isn't there
   *  yet, then compose the `https://t.me/<bot>?start=pod_<token>` deep link
   *  CommandRouter already knows how to consume. Returns null when we can't
   *  compose (no botUsername or no Materia found). */
  private async _fetchShareUrl(podId: string): Promise<string | null> {
    if (!this.deps.materiae || !this.deps.botUsername) return null
    const pods = await this.deps.materiae.findActive().catch(() => [])
    const m = pods.find(p => p.externusId === podId)
    if (!m) return null
    let token = m.shareToken
    if (!token) {
      token = mintShareToken()
      await this.deps.materiae.update(m.id, { shareToken: token }).catch(() => {})
    }
    return `https://t.me/${this.deps.botUsername}?start=pod_${token}`
  }

  /** Mod • body: the studio's loadout (model base) — container image, inferred runtime,
   *  and installed models grouped by mount location. The view formats it. */
  private async _fetchLoadout(podId: string): Promise<Loadout | undefined> {
    if (!this.deps.materiae) return undefined
    const pods = await this.deps.materiae.findActive().catch(() => [])
    const m = pods.find(p => p.externusId === podId)
    if (!m) return undefined

    const ids = m.installedModels ?? []
    // Show a friendly image LABEL (not the raw OCI ref — a 'ghcr.io/…' would auto-link in Telegram).
    // Prefer the runtime stamped on the Materia; fall back to inferring it from the image.
    const runtime = m.runtime ?? inferRuntime(m.imageRef)
    const header = { ...(m.imageRef ? { image: this.modelCatalog.imageLabel(m.imageRef) } : {}), ...(runtime ? { runtime } : {}) }
    if (ids.length === 0 || !this.deps.intellarum) return { ...header, categories: [] }

    const intellae = (await Promise.all(ids.map(id => this.deps.intellarum!.find(id).catch(() => null))))
      .filter((i): i is NonNullable<typeof i> => !!i)
    const nameOf = (i: typeof intellae[number]) => i.nomen || i.slug || i.id
    // Mount location = the meaningful ComfyUI folder (unet / vae / loras / clip / checkpoints …),
    // normalizing the migrated 'models/<folder>/…' prefix so loras don't land under a moot 'models'.
    const mountOf = (i: typeof intellae[number]) => (i.dest ?? '').replace(/^models\//, '').split('/')[0] || i.architectura || i.genus || 'other'

    // LoRAs are subordinate to their base (Intella.baseIntellaId). Bucket them by base id.
    const lorasByBase = new Map<string, string[]>()
    for (const i of intellae) {
      if (i.genus !== 'lora') continue
      const key = i.baseIntellaId ?? '∅'
      const arr = lorasByBase.get(key); if (arr) arr.push(nameOf(i)); else lorasByBase.set(key, [nameOf(i)])
    }
    // Group base models by mount location; nest each base's LoRAs beneath it.
    const byMount = new Map<string, Array<{ nomen: string; loras: string[] }>>()
    const installedBaseIds = new Set<string>()
    for (const i of intellae) {
      if (i.genus === 'lora') continue
      installedBaseIds.add(i.id)
      const mount = mountOf(i)
      const base = { nomen: nameOf(i), loras: lorasByBase.get(i.id) ?? [] }
      const arr = byMount.get(mount); if (arr) arr.push(base); else byMount.set(mount, [base])
    }
    const categories = [...byMount].map(([architectura, bases]) => ({ architectura, bases }))
    // LoRAs whose base isn't installed (or has no baseIntellaId) → flat fallback.
    const looseLoras = [...lorasByBase].flatMap(([baseId, names]) => installedBaseIds.has(baseId) ? [] : names)
    return { ...header, categories, ...(looseLoras.length ? { looseLoras } : {}) }
  }

  // -------------------------------------------------------------------------
  // Main entry point
  // -------------------------------------------------------------------------

  async receive(update: TelegramUpdate): Promise<void> {
    const chatId =
      update.message?.chat.id ??
      update.callback_query?.message?.chat.id

    const messageId =
      update.message?.message_id ??
      update.callback_query?.message?.message_id

    // When the dispatch comes from a group/supergroup, enrich the trace context
    // with groupChatId so warm-park stamps Materia.groupChatId without putting
    // chat info on the Actum schema. DMs leave it absent.
    const chatType = update.message?.chat.type
    const groupChatId = (chatType === 'group' || chatType === 'supergroup') && chatId
      ? String(chatId)
      : undefined

    const dispatch = async () => {
      try {
        if (update.message) {
          await this._handleMessage(update.message)
        } else if (update.callback_query) {
          await this._handleCallbackQuery(update.callback_query)
        }
      } catch (err) {
        log.error('TelegramAllocutio error', { error: String(err) })
        if (chatId) {
          if (messageId) void this._react(chatId, messageId, REACTION.error)
          await this.sender
            .sendMessage(chatId, classifyError(err))
            .catch(() => {})
        }
      }
    }

    if (groupChatId) {
      await withTrace(makeTraceContext({ ...getTrace(), groupChatId }), dispatch)
    } else {
      await dispatch()
    }
  }

  // -------------------------------------------------------------------------
  // Message handler
  // -------------------------------------------------------------------------

  private async _handleMessage(message: NonNullable<TelegramUpdate['message']>): Promise<void> {
    // Drop stale messages (from before bot startup)
    if (this.deps.botStartupTime !== undefined) {
      if ((message.date * 1000) < this.deps.botStartupTime) return
    }

    const userId = String(message.from?.id ?? message.chat.id)
    const chatId = message.chat.id
    // A command can ride a photo's caption (a different field from `text`), so read both —
    // `/effect …` typed under an attached image would otherwise be silently dropped.
    const text = message.text ?? message.caption ?? ''

    // Store chatId — used by non-render lookups (bulletins.pendingModelsFor, the /cancel
    // and force-reply reply paths). Render target no longer reads from this map; it
    // resolves from the chat-scoped FlowContext (ruling 3).
    this.chatIds.set(`telegram:${userId}`, chatId)

    // Mod • → Add: a reply to a force-reply prompt carries either a search term or trigger word(s).
    const repliedTo = message.reply_to_message?.message_id
    if (repliedTo !== undefined && this.saveAs) {
      // Save-as name reply (force-reply) → derive slug + render the review. Clears the
      // exchange (prompt + reply) so the chat stays clean; the review message remains.
      const took = await this.saveAs.takeReply(repliedTo, chatId, userId, text)
      if (took) {
        void this.sender.deleteMessage?.(chatId, repliedTo).catch(() => {})
        void this.sender.deleteMessage?.(chatId, message.message_id).catch(() => {})
        return
      }
      // Save-as affix reply (prefix/suffix force-reply) → update the draft + re-render.
      const tookAffix = await this.saveAs.takeAffixReply(repliedTo, chatId, userId, text)
      if (tookAffix) {
        void this.sender.deleteMessage?.(chatId, repliedTo).catch(() => {})
        void this.sender.deleteMessage?.(chatId, message.message_id).catch(() => {})
        return
      }
    }
    if (repliedTo !== undefined) {
      const reply = this.modelCatalog.takeReply(repliedTo, chatId, userId, text)
      if (reply !== null) {
        // Clear the exchange so the chat stays clean: the prompt (force-reply object) and
        // the host's reply both vanish; the picker re-renders with the results.
        void this.sender.deleteMessage?.(chatId, repliedTo).catch(() => {})
        void this.sender.deleteMessage?.(chatId, message.message_id).catch(() => {})
        if (reply.kind === 'trigger') await this.bulletins.applyPickerTriggers(chatId, reply.text)
        else await this.bulletins.applyPickerSearch(chatId, reply.text)
        return
      }
    }

    if (text.startsWith('/')) {
      // Capture entry media from the command's envelope (the deprecated-bot UX):
      // attached media takes precedence over replied-to media. Resolved to a download
      // URL and threaded into the flow, where it pre-fills the Porta of its own type.
      const envelope = envelopeMedia(message) ?? envelopeMedia(message.reply_to_message)
      let entryMedia: { url: string; type: EnvelopeMediaType } | undefined
      if (envelope !== null) {
        const url = await this._resolveFileUrl(envelope.fileId)
        if (url !== null) entryMedia = { url, type: envelope.type }
      }
      // In a group, an unrecognised `/command` is almost always another bot's — answering
      // it makes us the bot that interrupts every other bot's conversation. Stay silent
      // unless the message named us (`/foo@thisbot`, an @-mention, or a reply to us).
      const silentOnUnknown = message.chat.type !== 'private' && !this._isAddressedToBot(message)
      await this._handleCommand(userId, chatId, text, message.message_id, entryMedia, silentOnUnknown)
    } else {
      // Media message while flow active → resolve file URL → prompt event. The URL
      // fills the next required field, whatever its type: a bare message answers the
      // question the flow just asked, and the flow is the one that knows what it asked.
      const bare = envelopeMedia(message)
      if (bare !== null) {
        if (this.router.hasContext('telegram', userId, String(chatId))) {
          const fileUrl = await this._resolveFileUrl(bare.fileId)
          if (fileUrl) {
            await this.router.handle('telegram', userId, String(chatId), { kind: 'prompt', text: fileUrl })
          }
        }
        return
      }

      // Plain text message — only route if there's an active flow in this chat. In a
      // group/supergroup, unaddressed plain text advances nothing at all: the bot must
      // be @-mentioned or the message must reply to one of the bot's own messages.
      if (message.chat.type !== 'private' && !this._isAddressedToBot(message)) {
        return
      }
      // A message with neither text nor media — a sticker, a location, a PDF — carries
      // nothing a Porta can hold. Routing it anyway would fill the field the flow is
      // waiting on with the empty string and walk on to the next one.
      if (text === '') return
      if (this.router.hasContext('telegram', userId, String(chatId))) {
        await this.router.handle('telegram', userId, String(chatId), { kind: 'prompt', text })
      }
      // No active flow → no-op
    }
  }

  /** Group gate (ruling 2): was this message @-mentioning the bot, or replying to one
   *  of the bot's own messages? Absent a configured botUsername, both signals are
   *  unavailable and this conservatively returns false (fail closed, not open). */
  private _isAddressedToBot(message: NonNullable<TelegramUpdate['message']>): boolean {
    const botUsername = this.deps.botUsername
    if (!botUsername) return false
    const text = message.text ?? message.caption ?? ''
    if (text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true
    const repliedFrom = message.reply_to_message?.from
    return repliedFrom?.username?.toLowerCase() === botUsername.toLowerCase()
  }

  // -------------------------------------------------------------------------
  // Command handler
  // -------------------------------------------------------------------------

  private async _handleCommand(userId: string, chatId: number, text: string, messageId?: number, entryMedia?: { url: string; type: EnvelopeMediaType }, silentOnUnknown = false): Promise<void> {
    // Reaction-prep: 🤔 on receipt + remember the command message so the Stream
    // registration can later land the 👌/🔥 on it. The command surface itself lives
    // in CommandRouter.
    // Don't react to a command we won't answer — a 🤔 on another bot's command in a
    // shared group is the same interruption as the reply, just quieter.
    if (messageId !== undefined && (!silentOnUnknown || isKnownCommand(text))) {
      void this._react(chatId, messageId, REACTION.thinking)
      this.lastCommandMessageIds.set(`telegram:${userId}`, messageId)
    }
    await this.commands.dispatch(userId, chatId, text, messageId, entryMedia, { silentOnUnknown })
  }

  // -------------------------------------------------------------------------
  // Callback query handler
  // -------------------------------------------------------------------------

  private async _handleCallbackQuery(
    query: NonNullable<TelegramUpdate['callback_query']>
  ): Promise<void> {
    const userId = String(query.from.id)
    const chatId = query.message?.chat.id

    if (chatId) {
      this.chatIds.set(`telegram:${userId}`, chatId)
    }

    // Always ack the callback query
    await this.sender.answerCallbackQuery(query.id)

    if (!query.data) return

    // Session bulletin — warm stepper / confirm / refresh / kill / Mod • picker.
    // Slice off the `bul:` prefix rather than split on ':' — picker ids carry their own
    // colon suffix (`mod.pick:3`, `mod.filter:lora`, `mod.page:next`) that a split would drop.
    if (query.data.startsWith('bul:') && chatId) {
      const action = query.data.slice(4)
      await this.bulletins.handleControl(chatId, String(query.from.id), action)
      return
    }

    // /status HUD — refresh / cancel:<actumId> / bulletin:<studioId> / join:<studioId> / history / settings
    if (query.data.startsWith('stat:') && chatId) {
      await this._handleStatusCallback(query.data.slice(5), userId, chatId)
      return
    }

    // Delivery menu — morphing row + Info stats. Data: dm:<action>:<actumId>[:<type>]
    if (query.data.startsWith('dm:') && chatId) {
      const [, action, actumId, ratedType] = query.data.split(':')
      // Pass the callback's own chat so the menu can refuse cross-chat actumIds.
      await this.delivery.handle(actumId, action, { ratedType, presserUserId: String(query.from.id), chatId })
      return
    }

    // Save-as review — prompt-mode toggle / Save (collision check + register) / Cancel.
    // Keyed on the review message the button rode on (the SaveAsMenu owns the draft).
    if (query.data.startsWith('sa:') && chatId && query.message?.message_id !== undefined) {
      await this.saveAs?.handle(query.message.message_id, query.data.slice(3), chatId, userId)
      return
    }

    // Pod invite button — send a forwardable invite message
    if (query.data.startsWith('pod_invite:') && chatId) {
      void this.sender.sendMessage(chatId, COPY.status.podInvite).catch(() => {})
      return
    }

    const event = decodeCallbackData(query.data)
    if (!event) return

    // Flow-card "Save as…" — open the Save-as menu seeded from the active flow's card
    // state (modusId + aditus + pinnedModels). Intercepted here, NOT routed to the flow
    // (the menu is force-reply driven, with no active flow step of its own).
    if (event.kind === 'action' && event.actionId === 'saveas' && chatId) {
      await this._saveAsFromCard(userId, chatId)
      return
    }

    // Store the message ID for in-place editing on the next step
    if (query.message?.message_id !== undefined) {
      this.pendingEditMessageIds.set(`telegram:${userId}`, query.message.message_id)
    }

    // Start-screen shortcut buttons — launch flows directly (same path as commands).
    if (event.kind === 'select') {
      if (event.selectedId === 'make' || event.selectedId === 'flows') {
        await this._enterExecute(userId)
        return
      }
      if (event.selectedId === 'chat') {
        await this._enterExecute(userId, { modusId: CANON_VERBS.chat, aditus: {}, browsePageIndex: 0 })
        return
      }
    }

    if (chatId && this.router.hasContext('telegram', userId, String(chatId))) {
      await this.router.handle('telegram', userId, String(chatId), event)
    }
  }

  // -------------------------------------------------------------------------
  // Step renderer — fires when router emits a step
  // -------------------------------------------------------------------------

  private async _handleStep(ctx: FlowContext, step: Step): Promise<void> {
    const chatId = this._getChatId(ctx)
    if (chatId === null) return

    const userKey = `${ctx.platform}:${ctx.platformUserId}`
    // Consume the pending edit message ID (if any) — used for the first keyboard primitive
    let editMessageId = this.pendingEditMessageIds.get(userKey)
    if (editMessageId !== undefined) this.pendingEditMessageIds.delete(userKey)

    for (const primitive of step.primitives) {
      // Result primitives are never edited — always sent as new messages
      if (primitive.kind === 'Result') {
        editMessageId = undefined  // stop editing for subsequent primitives
        await this._sendResult(chatId, primitive)
        continue
      }

      // Stream(running) → register the actum with the reaction + bulletin subsystems.
      if (primitive.kind === 'Stream' && primitive.status === 'running') {
        const commandMessageId = this.lastCommandMessageIds.get(userKey)
        if (commandMessageId === undefined) await this.sender.sendMessage(chatId, COPY.status.working)
        if (primitive.actumId) {
          this.reactions.register(primitive.actumId, chatId, commandMessageId)
          this.bulletins.register(chatId, primitive.actumId, ctx.platformUserId)
        }
        editMessageId = undefined
        continue
      }

      const { text, extra } = renderPrimitive(primitive)

      // Feature 2: edit in place if we have a pending edit message ID and this primitive has a keyboard
      if (editMessageId !== undefined && extra?.reply_markup) {
        try {
          await this.sender.editMessageText(chatId, editMessageId, text, extra)
        } catch {
          // Fallback: send as new message (message too old, content unchanged, etc.)
          await this.sender.sendMessage(chatId, text, extra)
        }
        editMessageId = undefined  // only edit the first keyboard primitive
      } else {
        await this.sender.sendMessage(chatId, text, extra)
      }
    }
  }

  // -------------------------------------------------------------------------
  // _sendResult — special handling for Result primitive (media sending)
  // -------------------------------------------------------------------------

  /**
   * Every media item of a result, as something Telegram can actually fetch.
   *
   * A private run hands us a `noema-private://` marker, not a URL: the object lives in a bucket
   * with no public binding. Each marker becomes a link minted for this one send, which Telegram
   * fetches server-side — the chat only ever holds the resulting photo/video. A marker that
   * cannot be resolved (no private-outputs store here, or the store refused) is DROPPED rather
   * than sent: passing it on would put the key itself in the chat, which is the one outcome the
   * marker scheme exists to prevent.
   */
  private async _deliverableMedia(
    media: NonNullable<Extract<Primitive, { kind: 'Result' }>['media']>,
  ): Promise<{ items: DeliverableMedium[]; withheld: number }> {
    const items: DeliverableMedium[] = []
    let withheld = 0
    for (const m of media) {
      if (!isPrivateMarker(m.url)) { items.push({ ...m, isPrivate: false }); continue }
      const link = await this.deps.resolvePrivateMedia?.(m.url).catch(() => undefined)
      if (link) items.push({ ...m, url: link, isPrivate: true })
      else withheld++
    }
    return { items, withheld }
  }

  private async _sendResult(
    chatId: number,
    primitive: Extract<Primitive, { kind: 'Result' }>
  ): Promise<void> {
    const { text: bodyText } = renderPrimitive(primitive)
    // The delivery menu owns the morphing row; we just attach its initial keyboard.
    const extra = { reply_markup: this._toInline(this.delivery.initialKeyboard(primitive.actumId)) }
    const track = (messageId: number, caption: string, isMedia: boolean) =>
      this.delivery.track(primitive.actumId, { chatId, messageId, caption, isMedia })

    if (!primitive.media || primitive.media.length === 0) {
      // Text-only result (chatgpt, caption, etc.)
      const sent = await this.sender.sendMessage(chatId, bodyText, extra)
      track(sent.message_id, bodyText, false)
      return
    }

    const { items, withheld } = await this._deliverableMedia(primitive.media)
    if (items.length === 0) {
      // Everything this result had was private and unresolvable. Say so; print no reference.
      const sent = await this.sender.sendMessage(chatId, COPY.status.privateUndeliverable, extra)
      track(sent.message_id, COPY.status.privateUndeliverable, false)
      return
    }
    if (withheld > 0) await this.sender.sendMessage(chatId, COPY.status.privateUndeliverable).catch(() => {})

    if (items.length === 1) {
      const m = items[0]
      try {
        let sent: { message_id: number }
        if (m.type === 'image') {
          sent = await this.sender.sendPhoto(chatId, m.url, { caption: m.caption, ...extra })
        } else if (m.type === 'video') {
          sent = await this.sender.sendVideo(chatId, m.url, { caption: m.caption, ...extra })
        } else {
          sent = await this.sender.sendDocument(chatId, m.url, { caption: m.caption, ...extra })
        }
        track(sent.message_id, m.caption ?? '', true)
      } catch {
        // The send failed — fall back to the link as text, but ONLY for a public output. A
        // resolved private link is a working grant on a private object; posting it into the chat
        // hands it to everyone in the room and outlives the failure that prompted it.
        if (m.isPrivate) await this.sender.sendMessage(chatId, COPY.status.privateUndeliverable, extra)
        else await this.sender.sendMessage(chatId, m.url, extra)
      }
      return
    }

    // Multiple media: sendMediaGroup (no inline keyboard support), then keyboard as text
    try {
      const media = items.map((m, i) => ({
        type: m.type === 'video' ? 'video' : 'photo',
        media: m.url,
        caption: i === 0 ? m.caption : undefined,
      }))
      await this.sender.sendMediaGroup(chatId, media)
    } catch {
      // Same rule per item: a public URL may fall back to text, a private grant may not.
      for (const m of items) {
        if (m.isPrivate) continue
        await this.sender.sendMessage(chatId, m.url).catch(() => {})
      }
    }
    // Send keyboard as follow-up text message (Telegram limitation)
    await this.sender.sendMessage(chatId, '—', extra)
  }

  // -------------------------------------------------------------------------
  // ── /status HUD ─────────────────────────────────────────────────────────
  // Aggregates the user's app state, renders via StatusView, sends as a chat
  // message. Subsequent Refresh button edits the same message in place.
  private async _showStatus(userId: string, chatId: number): Promise<void> {
    if (!this.deps.signorum || !this.deps.hospitia || !this.deps.actorum || !this.deps.modorum || !this.deps.materiae) {
      // Missing crystal deps for full status — fall back to a friendly stub.
      await this.sender.sendMessage(chatId, '`/status` is unavailable in this build (missing crystal services).')
      return
    }
    const auctorKey = await this.identity.resolve(userId).catch(() => null)
    const snapshot = await aggregateStatus(
      {
        signorum: this.deps.signorum,
        hospitia: this.deps.hospitia,
        materiae: this.deps.materiae,
        actorum:  this.deps.actorum,
        modorum:  this.deps.modorum,
        ...(this.deps.actumIndex ? { actumIndex: this.deps.actumIndex } : {}),
      },
      // inFlightActumIds is the fallback when actumIndex isn't wired — aggregator
      // prefers the index when present (identified runs only).
      { auctorKey, inFlightActumIds: [] },
    )
    const { text, keyboard } = StatusView.render(snapshot)
    const reply_markup = keyboard.length ? this._toInline(keyboard) : undefined
    const key = `telegram:${userId}`
    const sent = await this.sender.sendMessage(chatId, text, reply_markup ? { reply_markup } : undefined)
    const sentId = (sent as { message_id?: number } | undefined)?.message_id
    if (typeof sentId === 'number') {
      this.statusMessages.set(key, { chatId, messageId: sentId })
    }
  }

  private async _handleStatusCallback(action: string, userId: string, chatId: number): Promise<void> {
    if (action === 'refresh') {
      // Re-aggregate and edit the existing message in place.
      const key = `telegram:${userId}`
      const tracked = this.statusMessages.get(key)
      if (!tracked || !this.deps.signorum || !this.deps.hospitia || !this.deps.actorum || !this.deps.modorum || !this.deps.materiae) {
        // No tracked message or missing deps — fall back to a fresh /status.
        await this._showStatus(userId, chatId)
        return
      }
      const auctorKey = await this.identity.resolve(userId).catch(() => null)
      const snapshot = await aggregateStatus(
        {
          signorum: this.deps.signorum, hospitia: this.deps.hospitia, materiae: this.deps.materiae,
          actorum: this.deps.actorum, modorum: this.deps.modorum,
          ...(this.deps.actumIndex ? { actumIndex: this.deps.actumIndex } : {}),
        },
        { auctorKey, inFlightActumIds: [] },
      )
      const { text, keyboard } = StatusView.render(snapshot)
      const reply_markup = keyboard.length ? this._toInline(keyboard) : undefined
      await this.sender.editMessageText(tracked.chatId, tracked.messageId, text, reply_markup ? { reply_markup } : undefined).catch(() => {})
      return
    }

    if (action.startsWith('cancel:')) {
      const actumId = action.slice(7)
      if (this.deps.cancelActum) {
        await this.deps.cancelActum(actumId, 'cancelled by user via /status').catch(() => {})
      }
      // Re-render so the cancelled gen drops out of the list.
      await this._handleStatusCallback('refresh', userId, chatId)
      return
    }

    if (action.startsWith('bulletin:') || action.startsWith('join:') || action === 'history' || action === 'settings') {
      // V1 stubs — surface progress on these in later sprints. Acknowledge so
      // the user sees something happen.
      await this.sender.sendMessage(chatId, `\`${action}\` — coming soon.`)
      return
    }
  }

  // _sendStart — welcome message with quick-start buttons
  // -------------------------------------------------------------------------

  private async _sendStart(chatId: number): Promise<void> {
    const text = `\
noema

Generate AI art, chat with models, explore creative tools.`

    await this.sender.sendMessage(chatId, text, {
      reply_markup: inlineKeyboard([
        [btn('make', 's:make'), btn('chat', 's:chat'), btn('flows', 's:flows')],
        [btn('connect wallet', 'a:connect_wallet'), btn('balance', 'a:balance')],
      ]),
    })
  }

  // -------------------------------------------------------------------------
  // _react — set a message reaction (decorative, errors swallowed)
  // -------------------------------------------------------------------------

  private async _react(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      await this.sender.setMessageReaction?.(chatId, messageId, [{ type: 'emoji', emoji }])
    } catch {
      // Reactions are decorative — swallow all errors silently
    }
  }

  // -------------------------------------------------------------------------
  // Pod lifecycle → reaction choreography + bulletin journal
  // -------------------------------------------------------------------------

  /** Owned-status path: the typed `Progressus` drives the bulletin AND the reaction (#6b/#6e). */
  private async _handleActumProgressus(data: { actumId: string; progressus: Progressus }): Promise<void> {
    // Warm reuse (`provisioning` + 'warm pod reused', may arrive before OR after the Stream
    // registers) → 🔥, never 👌. (Was the `actum.stage` 'warm-pod-found' signal, #6e.)
    const p = data.progressus
    if (p.phase === 'provisioning' && p.message === 'warm pod reused') { this.reactions.noteWarm(data.actumId) }
    this.bulletins.onProgressus(data.actumId, p)
  }

  private async _handleActumComplete(wide: WideEvent): Promise<void> {
    this.reactions.clear(wide.actumId)
    this.bulletins.onComplete(wide.actumId, { costUsd: wide.costUsd, execMs: wide.executionMs, podId: wide.podId })
  }

  private async _handleActumFail(wide: WideEvent): Promise<void> {
    this.reactions.clear(wide.actumId)
    this.bulletins.onFail(wide.actumId)
  }

  /**
   * pod.parked: a cold pod just warm-parked. When the provisioning happened in a
   * group, resolve the chat's admin set into the Hospitium's adminAnimaIds — that
   * grants admins at-cost access on subsequent /makes (Phase B will read it).
   * Group-only and hospitia-required; quietly no-ops otherwise.
   */
  private async _handlePodParked(data: { materiaId: string; groupChatId?: string; platform?: 'telegram' | 'discord' | 'api' }): Promise<void> {
    const { materiaId, groupChatId, platform } = data
    // Multi-platform safety: only handle pods this adapter's platform provisioned.
    // Absent platform on the event is permitted (legacy / unattributed emit), so
    // we accept it; an explicit non-telegram platform is filtered out.
    if (platform && platform !== 'telegram') return
    if (!groupChatId || !this.deps.hospitia || !this.sender.getChatAdministrators) return
    const chatId = Number(groupChatId)
    if (!Number.isFinite(chatId)) return

    try {
      const admins = await this.sender.getChatAdministrators(chatId)
      const animaIds: string[] = []
      for (const a of admins) {
        const key = await this.identity.resolve(String(a.user.id)).catch(() => null)
        if (key && 'animaId' in key) animaIds.push(key.animaId)
      }
      const unique = Array.from(new Set(animaIds))
      if (unique.length > 0) {
        // A studio's host record (ADR-0006) is keyed by its session and binds its
        // materiaId just after pod.parked — so this update can lose a race with the
        // bind. Retry once so a group studio doesn't silently miss its admin set.
        const setAdmins = () => this.deps.hospitia!.update(materiaId, { adminAnimaIds: unique })
        await setAdmins().catch(async () => {
          await new Promise(r => setTimeout(r, 500))
          await setAdmins().catch(() => {})
        })
      }
    } catch (err) {
      log.warn('pod.parked admin resolution failed', { materiaId, error: String(err) })
    }
  }

  // -------------------------------------------------------------------------
  // _resolveFileUrl — resolve a Telegram file_id to a download URL
  // -------------------------------------------------------------------------

  private async _resolveFileUrl(fileId: string): Promise<string | null> {
    try {
      return await this.sender.getFileLink(fileId)
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Resolution renderer — fires when router emits a terminal resolution
  // -------------------------------------------------------------------------

  private async _handleResolution(ctx: FlowContext, resolution: Resolution): Promise<void> {
    const chatId = this._getChatId(ctx)
    if (chatId === null) return

    switch (resolution.kind) {
      case 'complete':
        await this.sender.sendMessage(chatId, COPY.status.done)
        break
      case 'abandon':
        // Silent — abandon fires on implicit context replacement (e.g. /make while already in a flow).
        // Explicit /cancel sends its own message directly from the command handler.
        break
      case 'handoff':
        // No message needed — router will fire onStep for the new flow
        break
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _getChatId(ctx: FlowContext): number | null {
    // Render target resolves from the (now chat-scoped) FlowContext itself — not from
    // the last-write-wins chatIds map, which can point at whichever chat the user most
    // recently typed in (ruling 3).
    const chatId = Number(ctx.platformChatId)
    return Number.isFinite(chatId) ? chatId : null
  }

  // -------------------------------------------------------------------------
  // Allocutio interface stubs (FlowEngine handles everything via receive())
  // These are here for registry compatibility only.
  // -------------------------------------------------------------------------

  async parse(raw: unknown): Promise<Nuntius> {
    const update = raw as TelegramUpdate
    const msg = update.message
    const cq = update.callback_query
    const from = msg?.from ?? cq?.from
    const chatId = msg?.chat.id ?? cq?.message?.chat.id ?? 0
    return {
      id: String(update.update_id),
      platforma: 'telegram',
      externusUserId: String(from?.id ?? 0),
      externusConversationId: String(chatId),
      externusMessageId: msg ? String(msg.message_id) : undefined,
      genus: 'eventus',
      corpus: msg?.text ?? cq?.data ?? '',
      natum: new Date(),
    }
  }

  async resolve(_nuntius: Nuntius): Promise<Inceptio | null> {
    // FlowEngine handles everything — return null
    return null
  }

  async send(_responsum: Responsum, _target: { conversationId: string }): Promise<void> {
    // Not used in FlowEngine mode
  }
}
