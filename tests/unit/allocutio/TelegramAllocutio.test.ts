import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TelegramAllocutio } from '../../../src/allocutio/telegram/TelegramAllocutio.js'
import { bus } from '../../../src/lib/bus.js'
import { fakeStageToProgressus } from '../../../src/crystal/FakeRunPodClient.js'
import type {
  FlowContext, Step, Resolution, PrimitiveEvent, Intent, Platform, AuctorKey
} from '../../../src/flow/types.js'
import type { TelegramUpdate } from '../../../src/allocutio/telegram/telegramTypes.js'
import type { WideEvent } from '../../../src/lib/wide.js'

// =============================================================================
// Mock types
// =============================================================================

// =============================================================================
// Mock builders
// =============================================================================

function makeSender() {
  const sent: Array<{ chatId: number; text: string; extra?: unknown }> = []
  const edited: Array<{ chatId: number; messageId: number; text: string; extra?: unknown }> = []
  const answered: string[] = []
  const photos: Array<{ chatId: number; url: string; extra?: unknown }> = []
  const videos: Array<{ chatId: number; url: string; extra?: unknown }> = []
  const mediaGroups: Array<{ chatId: number; media: unknown[] }> = []
  const reactions: Array<{ chatId: number; messageId: number; emoji: string }> = []
  const captions: Array<{ chatId: number; messageId: number; caption: string; extra?: unknown }> = []
  const markups: Array<{ chatId: number; messageId: number; reply_markup: unknown }> = []
  const deleted: Array<{ chatId: number; messageId: number }> = []

  return {
    sent,
    edited,
    answered,
    photos,
    videos,
    mediaGroups,
    reactions,
    deleted,
    deleteMessage: async (chatId: number, messageId: number) => {
      deleted.push({ chatId, messageId })
    },
    sendMessage: async (chatId: number, text: string, extra?: unknown) => {
      sent.push({ chatId, text, extra })
      return { message_id: 100 + sent.length }
    },
    editMessageText: async (chatId: number, messageId: number, text: string, extra?: unknown) => {
      edited.push({ chatId, messageId, text, extra })
    },
    answerCallbackQuery: async (id: string) => {
      answered.push(id)
    },
    sendPhoto: async (chatId: number, url: string, extra?: unknown) => {
      photos.push({ chatId, url, extra })
      return { message_id: 200 + photos.length }
    },
    sendVideo: async (chatId: number, url: string, extra?: unknown) => {
      videos.push({ chatId, url, extra })
      return { message_id: 300 + videos.length }
    },
    // Document delivery is not exercised here; it throws rather than recording silently,
    // so a test that starts routing documents has to add a real recorder.
    sendDocument: async (): Promise<{ message_id: number }> => {
      throw new Error('makeSender.sendDocument is not exercised by these tests')
    },
    sendMediaGroup: async (chatId: number, media: unknown[]) => {
      mediaGroups.push({ chatId, media })
    },
    setMessageReaction: async (chatId: number, messageId: number, reaction: Array<{ type: string; emoji: string }>) => {
      reactions.push({ chatId, messageId, emoji: reaction[0]?.emoji ?? '' })
    },
    getFileLink: async (fileId: string) => {
      return `https://api.telegram.org/file/bot-token/${fileId}`
    },
    captions,
    markups,
    editMessageCaption: async (chatId: number, messageId: number, caption: string, extra?: unknown) => {
      captions.push({ chatId, messageId, caption, extra })
    },
    editMessageReplyMarkup: async (chatId: number, messageId: number, reply_markup: unknown) => {
      markups.push({ chatId, messageId, reply_markup })
    },
  }
}

function makeIdentity(animaId = 'test-anima') {
  return {
    resolve: async (_userId: string): Promise<AuctorKey> => ({ animaId }),
  }
}

interface RouterCall {
  method: string
  args: unknown[]
}

/**
 * Make a mock FlowRouter. The stepCallback / resolutionCallback can be
 * fired manually via triggerStep / triggerResolution to simulate the
 * router emitting events when enter/handle are called.
 */
function makeRouter() {
  const calls: RouterCall[] = []
  let stepCb: ((ctx: FlowContext, step: Step) => void) | null = null
  let resCb: ((ctx: FlowContext, res: Resolution) => void) | null = null

  // Active context state: present means a flow is running for this user, in this chat.
  const activeContexts = new Map<string, FlowContext>()
  const key = (platform: Platform, userId: string, chatId: string) => `${platform}:${userId}:${chatId}`

  const router = {
    // --- recorded calls ---
    calls,

    // --- wire in TelegramAllocutio's callbacks ---
    onStep(cb: (ctx: FlowContext, step: Step) => void) { stepCb = cb },
    onResolution(cb: (ctx: FlowContext, res: Resolution) => void) { resCb = cb },

    // --- FlowRouter API ---
    enter: async (
      intent: Intent,
      platform: Platform,
      userId: string,
      chatId: string,
      identity: AuctorKey,
      initialCtx?: unknown
    ) => {
      calls.push({ method: 'enter', args: [intent, platform, userId, chatId, identity, initialCtx] })
      const ctx: FlowContext = {
        intent,
        state: {},
        identity,
        platform,
        platformUserId: userId,
        platformChatId: chatId,
      }
      activeContexts.set(key(platform, userId, chatId), ctx)
      // Simulate router immediately emitting a step (empty primitives)
      stepCb?.(ctx, { primitives: [] })
    },

    handle: async (platform: Platform, userId: string, chatId: string, event: PrimitiveEvent) => {
      calls.push({ method: 'handle', args: [platform, userId, chatId, event] })
      const ctx = activeContexts.get(key(platform, userId, chatId))
      if (ctx) {
        stepCb?.(ctx, { primitives: [] })
      }
    },

    clear: (platform: Platform, userId: string, chatId: string) => {
      calls.push({ method: 'clear', args: [platform, userId, chatId] })
      activeContexts.delete(key(platform, userId, chatId))
    },

    hasContext: (platform: Platform, userId: string, chatId: string) =>
      activeContexts.has(key(platform, userId, chatId)),

    peek: (platform: Platform, userId: string, chatId: string) =>
      activeContexts.get(key(platform, userId, chatId)) ?? null,

    // Test helper: seed a card-state context for the Save-as-from-card path.
    seedContext(platform: Platform, userId: string, state: unknown, chatId = '456') {
      activeContexts.set(key(platform, userId, chatId), {
        intent: 'execute' as Intent, state, identity: { animaId: 'a' }, platform, platformUserId: userId, platformChatId: chatId,
      })
    },

    // Test helpers: fire events from router to the allocutio
    triggerStep(ctx: FlowContext, step: Step) { stepCb?.(ctx, step) },
    triggerResolution(ctx: FlowContext, res: Resolution) { resCb?.(ctx, res) },
  }

  return router
}

// Shorthand update factories
function msgUpdate(userId: number, chatId: number, text: string, messageId = 1): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: messageId,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      text,
      date: Math.floor(Date.now() / 1000),
    },
  }
}

function cbUpdate(userId: number, chatId: number, callbackData: string, cbId = 'cb-1'): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: cbId,
      from: { id: userId, username: 'tester' },
      message: { message_id: 99, chat: { id: chatId } },
      data: callbackData,
    },
  }
}

function photoMsgUpdate(
  userId: number,
  chatId: number,
  fileIds: string[],
  messageId = 1,
  date?: number
): TelegramUpdate {
  return {
    update_id: 3,
    message: {
      message_id: messageId,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      date: date ?? Math.floor(Date.now() / 1000),
      photo: fileIds.map((file_id, i) => ({ file_id, width: (i + 1) * 100, height: (i + 1) * 100 })),
    },
  }
}

/** A group/supergroup text message, optionally @-mentioning the bot or replying to
 *  one of the bot's own messages — used to exercise the group gate (ruling 2). */
function groupMsgUpdate(
  userId: number,
  chatId: number,
  text: string,
  opts: { messageId?: number; replyToBot?: boolean; botUsername?: string } = {}
): TelegramUpdate {
  return {
    update_id: 5,
    message: {
      message_id: opts.messageId ?? 1,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'supergroup' },
      text,
      date: Math.floor(Date.now() / 1000),
      ...(opts.replyToBot
        ? { reply_to_message: { message_id: 900, from: { id: 1, username: opts.botUsername ?? 'stationbot' } } }
        : {}),
    },
  }
}

function staleMsgUpdate(userId: number, chatId: number, text: string, pastSeconds = 300): TelegramUpdate {
  return {
    update_id: 4,
    message: {
      message_id: 1,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      text,
      date: Math.floor((Date.now() - pastSeconds * 1000) / 1000),
    },
  }
}

// =============================================================================
// Helper: build TelegramAllocutio wired with router callbacks
// =============================================================================
function makeAllocutio(opts: { botStartupTime?: number; withPodControls?: boolean; autoSettleMs?: number; intellarum?: unknown; modorum?: unknown; botUsername?: string; resolvePrivateMedia?: (marker: string) => Promise<string | undefined> } = {}) {
  const sender = makeSender()
  const identity = makeIdentity()
  const router = makeRouter()
  const terminated: string[] = []
  const cancelCalls: Array<{ actumId: string; reason: string }> = []
  const materiaUpdates: Array<{ id: string; patch: unknown }> = []
  const materiae = {
    async findActive() { return [{ id: 'mat-1', externusId: 'pod-1' }] },
    async update(id: string, patch: unknown) { materiaUpdates.push({ id, patch }); return { id, ...(patch as object) } },
  }

  const fakeActum = {
    id: 'actum-1', modusId: 'flux-schnell', modusVersiono: '1', impetus: 0n,
    signaConsumed: [], aditus: { input_seed: 4242 }, status: 'completus', inceptum: new Date(),
    expirat: new Date(), duratio: 12000,
    executio: { coldStart: false, executionMs: 9000, gpuType: 'RTX 4090', costPerHr: 0.69, modelsReused: 4, modelsDownloaded: 0 },
  }
  const acta = { async findById(_id: string) { return fakeActum as unknown as import('../../../src/types/actum.js').Actum } }

  const allocutio = new TelegramAllocutio({
    router: router as unknown as import('../../../src/allocutio/telegram/TelegramAllocutio.js').RouterDeps,
    sender,
    identity,
    botStartupTime: opts.botStartupTime,
    ...(opts.botUsername ? { botUsername: opts.botUsername } : {}),
    ...(opts.autoSettleMs !== undefined ? { autoSettleMs: opts.autoSettleMs } : {}),
    ...(opts.resolvePrivateMedia ? { resolvePrivateMedia: opts.resolvePrivateMedia } : {}),
    acta,
    ...(opts.intellarum ? { intellarum: opts.intellarum as unknown as import('../../../src/types/intelligendi.js').Intellarum } : {}),
    ...(opts.modorum ? { modorum: opts.modorum as unknown as import('../../../src/types/modus.js').Modorum } : {}),
    ...(opts.withPodControls ? {
      materiae: materiae as unknown as import('../../../src/types/materia.js').MateriaStore,
      terminatePod: async (podId: string) => { terminated.push(podId) },
      cancelActum: async (actumId: string, reason: string) => { cancelCalls.push({ actumId, reason }); return true },
    } : {}),
  })

  return { allocutio, sender, identity, router, terminated, cancelCalls, materiaUpdates, fakeActum }
}

// =============================================================================
// Tests
// =============================================================================

// 1. /make command → calls FlowRouter.enter('execute', ...) with correct platform/userId
/**
 * Drive the bulletin + reaction the way production does — via the owned `actum.progressus`, the
 * single status channel since #6e retired the `actum.stage` shim. Mirrors the Fake/real clients,
 * which project each stage through `fakeStageToProgressus`. A stage with no owned phase (e.g.
 * `progress:n/m`) yields no Progressus, so nothing fires — exactly as production drops it.
 */
function emitStage(actumId: string, stage: string, info?: Record<string, unknown>): void {
  const prog = fakeStageToProgressus(stage, info)
  if (prog) bus.emit('actum.progressus', { actumId, progressus: { ...prog, at: new Date() } })
}

test('/make command calls router.enter with execute intent', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const enterCall = router.calls.find(c => c.method === 'enter')
  assert.ok(enterCall, 'router.enter should have been called')
  assert.equal(enterCall!.args[0], 'execute')
  assert.equal(enterCall!.args[1], 'telegram')
  assert.equal(enterCall!.args[2], '123')
})

// 2. /cancel command → calls FlowRouter.clear(...) + sends "Cancelled."
test('/cancel command calls router.clear and sends Cancelled.', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  // Set up an active flow first so clear has something to do
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0  // reset call log

  await allocutio.receive(msgUpdate(123, 456, '/cancel'))

  const clearCall = router.calls.find(c => c.method === 'clear')
  assert.ok(clearCall, 'router.clear should have been called')
  assert.equal(clearCall!.args[0], 'telegram')
  assert.equal(clearCall!.args[1], '123')

  const cancelMsg = sender.sent.find(m => m.text === 'Cancelled.')
  assert.ok(cancelMsg, 'Should send "Cancelled." message')
})

// 3. Text message while flow active → fires { kind: 'prompt', text } to router
test('text message while flow active fires prompt event to router', async () => {
  const { allocutio, router } = makeAllocutio()

  // Enter a flow first
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  await allocutio.receive(msgUpdate(123, 456, 'hello world'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[3] as PrimitiveEvent
  assert.equal(event.kind, 'prompt')
  assert.equal((event as { kind: 'prompt'; text: string }).text, 'hello world')
})

// 4. Text message with no active flow → no-op (router has no context, nothing happens)
test('text message with no active flow is a no-op', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, 'just chatting'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.equal(handleCall, undefined, 'router.handle should NOT be called')
})

// 5. Select primitive → sends message with inline keyboard with correct callback_data s:${id}
test('Select primitive sends inline keyboard with s:id callback_data', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  // Enter a flow
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  // Get the flow context that was created
  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: Step = {
    primitives: [{
      kind: 'Select',
      label: 'Pick one',
      options: [
        { id: 'opt-a', label: 'Option A' },
        { id: 'opt-b', label: 'Option B' },
      ],
    }],
  }

  sender.sent.length = 0  // reset
  router.triggerStep(ctx, step)

  // Wait a tick for async
  await new Promise(r => setImmediate(r))

  assert.ok(sender.sent.length > 0, 'Should send a message')
  const msg = sender.sent[0]
  const markup = (msg.extra as { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } | undefined)?.reply_markup
  assert.ok(markup, 'Should have reply_markup')
  const buttons = markup!.inline_keyboard.flat()
  const buttonA = buttons.find(b => b.callback_data === 's:opt-a')
  const buttonB = buttons.find(b => b.callback_data === 's:opt-b')
  assert.ok(buttonA, 'Should have button with callback_data s:opt-a')
  assert.ok(buttonB, 'Should have button with callback_data s:opt-b')
})

// 6. Confirm primitive → sends message with Yes/No buttons (cy / cn)
test('Confirm primitive sends Yes/No buttons with cy and cn callback_data', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: Step = {
    primitives: [{
      kind: 'Confirm',
      label: 'Are you sure?',
      question: 'Do you want to proceed?',
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  const msg = sender.sent[0]
  assert.ok(msg, 'Should send a message')
  const markup = (msg.extra as { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } | undefined)?.reply_markup
  assert.ok(markup, 'Should have reply_markup')
  const buttons = markup!.inline_keyboard.flat()
  const yesBtn = buttons.find(b => b.callback_data === 'cy')
  const noBtn = buttons.find(b => b.callback_data === 'cn')
  assert.ok(yesBtn, 'Should have Yes button with callback_data cy')
  assert.ok(noBtn, 'Should have No button with callback_data cn')
})

// 7. Paginate primitive → sends message with Prev/Next buttons (pp / pn)
test('Paginate primitive sends Prev/Next buttons with pp and pn callback_data', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: Step = {
    primitives: [{
      kind: 'Paginate',
      label: 'Results',
      items: [
        { id: 'item-1', label: 'Item 1' },
        { id: 'item-2', label: 'Item 2' },
      ],
      page: 1,
      totalPages: 3,
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  const msg = sender.sent[0]
  assert.ok(msg, 'Should send a message')
  const markup = (msg.extra as { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } | undefined)?.reply_markup
  assert.ok(markup, 'Should have reply_markup')
  const buttons = markup!.inline_keyboard.flat()
  const prevBtn = buttons.find(b => b.callback_data === 'pp')
  const nextBtn = buttons.find(b => b.callback_data === 'pn')
  assert.ok(prevBtn, 'Should have Prev button with callback_data pp')
  assert.ok(nextBtn, 'Should have Next button with callback_data pn')
})

// 8. callback_query with s:someId → fires { kind: 'select', selectedId: 'someId' } to router
test('callback_query s:someId fires select event to router', async () => {
  const { allocutio, router } = makeAllocutio()

  // Set up active flow
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  await allocutio.receive(cbUpdate(123, 456, 's:opt-42'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[3] as PrimitiveEvent
  assert.equal(event.kind, 'select')
  assert.equal((event as { kind: 'select'; selectedId: string }).selectedId, 'opt-42')
})

// 9. callback_query with cy → fires { kind: 'confirm', confirmed: true } to router
test('callback_query cy fires confirm true event to router', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  await allocutio.receive(cbUpdate(123, 456, 'cy'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[3] as PrimitiveEvent
  assert.equal(event.kind, 'confirm')
  assert.equal((event as { kind: 'confirm'; confirmed: boolean }).confirmed, true)
})

// 10. callback_query with pn → fires { kind: 'paginate', action: 'next' } to router
test('callback_query pn fires paginate next event to router', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  await allocutio.receive(cbUpdate(123, 456, 'pn'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[3] as PrimitiveEvent
  assert.equal(event.kind, 'paginate')
  assert.equal((event as { kind: 'paginate'; action: string }).action, 'next')
})

// 11. Stream primitive with status 'running' and a stored command message → reacts 👌, sends nothing
test('Stream primitive with running status reacts 👌 on command message when command message ID is stored', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  // Send a /run command with a specific message ID — this stores the command message ID
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: Step = {
    primitives: [{
      kind: 'Stream',
      label: 'Generating',
      actumId: 'actum-1',
      status: 'running',
    }],
  }

  sender.sent.length = 0
  sender.reactions.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  // The cold-start 👌 is deferred (~800ms) so a warm signal can preempt it with 🔥.
  // No warm signal here → 👌 lands after the timer. (The bulletin posts its own
  // setup message at registration — that's a separate concern from the reaction.)
  await new Promise(r => setTimeout(r, 900))
  const thumbsUp = sender.reactions.find(r => r.emoji === '👌' && r.messageId === 50)
  assert.ok(thumbsUp, 'Should react 👌 on the original command message (deferred)')
})

// 12. Stream primitive with status 'complete' → sends message with content
test('Stream primitive with complete status sends completion text', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: Step = {
    primitives: [{
      kind: 'Stream',
      label: 'Done',
      actumId: 'actum-2',
      status: 'complete',
      content: 'https://example.com/result.png',
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  const msg = sender.sent[0]
  assert.ok(msg, 'Should send a message')
  // Must include the content URL or a "complete" indicator
  const hasContent = msg.text.includes('complete') || msg.text.includes('https://example.com/result.png')
  assert.ok(hasContent, 'Message should indicate completion with content')
})

// 13. Detail primitive → sends message with action buttons
test('Detail primitive sends message with action buttons', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: Step = {
    primitives: [{
      kind: 'Detail',
      label: 'Result',
      content: 'Here is your result.',
      actions: [
        { id: 'save', label: 'Save' },
        { id: 'discard', label: 'Discard' },
      ],
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  const msg = sender.sent[0]
  assert.ok(msg, 'Should send a message')
  const markup = (msg.extra as { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } } | undefined)?.reply_markup
  assert.ok(markup, 'Should have reply_markup with action buttons')
  const buttons = markup!.inline_keyboard.flat()
  const saveBtn = buttons.find(b => b.callback_data === 'a:save')
  const discardBtn = buttons.find(b => b.callback_data === 'a:discard')
  assert.ok(saveBtn, 'Should have Save button with a:save callback_data')
  assert.ok(discardBtn, 'Should have Discard button with a:discard callback_data')
})

// 14. Resolution 'complete' → sends completion message
test('Resolution complete sends completion message', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  sender.sent.length = 0
  router.triggerResolution(ctx, { kind: 'complete', output: { result: 'done' } })
  await new Promise(r => setImmediate(r))

  assert.ok(sender.sent.length > 0, 'Should send a completion message')
  const msg = sender.sent[0]
  const isCompletion = msg.text.toLowerCase().includes('complete') || msg.text.includes('Done') || msg.text.includes('✅')
  assert.ok(isCompletion, 'Completion message should indicate success')
})

// 15. Resolution 'abandon' → sends "Cancelled." message
test('Resolution abandon is silent (implicit context replacement)', async () => {
  // Abandon fires on implicit context replacement — e.g. /make while already in
  // another flow. The user already saw their new command; emitting "Cancelled."
  // for the displaced one would be noise. Explicit /cancel has its own message,
  // sent directly from the CommandRouter, not from the abandon resolution path.
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  sender.sent.length = 0
  router.triggerResolution(ctx, { kind: 'abandon' })
  await new Promise(r => setImmediate(r))

  assert.equal(sender.sent.length, 0, 'abandon resolution should not emit a message')
})

// =============================================================================
// Phase 7a new tests
// =============================================================================

// 16. botStartupTime: stale message (date * 1000 < startupTime) is silently dropped
test('botStartupTime filters stale messages — no router call', async () => {
  const botStartupTime = Date.now()
  const { allocutio, router } = makeAllocutio({ botStartupTime })

  // message date is 5 minutes in the past (before startup)
  await allocutio.receive(staleMsgUpdate(123, 456, '/make', 300))

  const enterCall = router.calls.find(c => c.method === 'enter')
  assert.equal(enterCall, undefined, 'stale message should be dropped, router.enter should not be called')
})

// 17. botStartupTime: fresh message (date * 1000 >= startupTime) is processed
test('botStartupTime passes fresh messages through', async () => {
  const botStartupTime = Date.now() - 60_000  // startup was 1 min ago
  const { allocutio, router } = makeAllocutio({ botStartupTime })

  // message date is now (after startup)
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const enterCall = router.calls.find(c => c.method === 'enter')
  assert.ok(enterCall, 'fresh message should be processed')
})

// 18. Photo message while flow active → router.handle called with { kind: 'prompt', text: '<url>' }
test('photo message while flow active fires prompt with file url', async () => {
  const { allocutio, router } = makeAllocutio()

  // Enter a flow first
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  // Send a photo
  await allocutio.receive(photoMsgUpdate(123, 456, ['file-id-small', 'file-id-large']))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should be called for photo with active flow')
  const event = handleCall!.args[3] as { kind: string; text: string }
  assert.equal(event.kind, 'prompt')
  // The URL should contain the largest file_id (last in array)
  assert.ok(event.text.includes('file-id-large'), 'should resolve URL from largest (last) photo')
})

// 19. Photo message with no active flow → no-op
test('photo message with no active flow is a no-op', async () => {
  const { allocutio, router } = makeAllocutio()

  // No flow entered — send a photo
  await allocutio.receive(photoMsgUpdate(123, 456, ['file-id-only']))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.equal(handleCall, undefined, 'router.handle should NOT be called with no active flow')
})

// 20. Result primitive with textContent → sendMessage called
test('Result primitive with textContent sends text via sendMessage', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: import('../../../src/flow/types.js').Step = {
    primitives: [{
      kind: 'Result',
      actumId: 'actum-42',
      label: 'ChatGPT',
      textContent: 'Once upon a time...',
      actions: [
        { id: 'rate_beautiful', label: '😻' },
        { id: 'rate_funny', label: '😹' },
        { id: 'rate_negative', label: '😿' },
        { id: 'info', label: 'ℹ' },
        { id: 'tweak', label: '✎ Tweak' },
        { id: 'rerun', label: '↻ Rerun' },
      ],
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  assert.ok(sender.sent.length > 0, 'sendMessage should be called for text-only Result')
  const msg = sender.sent[0]
  assert.ok(msg.text.includes('Once upon a time') || msg.text.includes('Result') || msg.text.includes('ChatGPT'),
    'message text should contain the result content')
})

// 21. Result primitive with single image → sendPhoto called; falls back to sendMessage on error
test('Result primitive with single image calls sendPhoto', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: import('../../../src/flow/types.js').Step = {
    primitives: [{
      kind: 'Result',
      actumId: 'actum-42',
      label: 'DALL·E',
      media: [{ url: 'https://example.com/image.png', type: 'image', caption: 'a cat' }],
      actions: [
        { id: 'rate_beautiful', label: '😻' },
        { id: 'rate_funny', label: '😹' },
        { id: 'rate_negative', label: '😿' },
        { id: 'info', label: 'ℹ' },
        { id: 'tweak', label: '✎ Tweak' },
        { id: 'rerun', label: '↻ Rerun' },
      ],
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  assert.ok(sender.photos.length > 0, 'sendPhoto should be called for single image Result')
  assert.equal(sender.photos[0].url, 'https://example.com/image.png')
})

test('Result primitive with single image falls back to sendMessage when sendPhoto throws', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  // Override sendPhoto to throw
  const originalSendPhoto = (sender as unknown as { sendPhoto: (...args: unknown[]) => unknown }).sendPhoto
  ;(sender as unknown as { sendPhoto: (...args: unknown[]) => unknown }).sendPhoto = async () => {
    throw new Error('Permission denied')
  }

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: import('../../../src/flow/types.js').Step = {
    primitives: [{
      kind: 'Result',
      actumId: 'actum-42',
      label: 'DALL·E',
      media: [{ url: 'https://example.com/image.png', type: 'image' }],
      actions: [{ id: 'rate_beautiful', label: '😻' }, { id: 'rerun', label: '↻ Rerun' }],
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  // Fallback: sendMessage should be called with the URL
  assert.ok(sender.sent.length > 0, 'fallback sendMessage should be called')
  const hasUrl = sender.sent.some(m => m.text.includes('https://example.com/image.png'))
  assert.ok(hasUrl, 'fallback message should contain the image URL')

  // Restore
  ;(sender as unknown as { sendPhoto: (...args: unknown[]) => unknown }).sendPhoto = originalSendPhoto
})

// 22. Result primitive with multiple images → sendMediaGroup called + follow-up sendMessage for keyboard
test('Result primitive with multiple images calls sendMediaGroup and follow-up sendMessage', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
    platformChatId: '456',
  }

  const step: import('../../../src/flow/types.js').Step = {
    primitives: [{
      kind: 'Result',
      actumId: 'actum-42',
      label: 'Multi Image',
      media: [
        { url: 'https://example.com/img1.png', type: 'image' },
        { url: 'https://example.com/img2.png', type: 'image' },
      ],
      actions: [
        { id: 'rate_beautiful', label: '😻' },
        { id: 'rerun', label: '↻ Rerun' },
      ],
    }],
  }

  sender.sent.length = 0
  router.triggerStep(ctx, step)
  await new Promise(r => setImmediate(r))

  assert.ok(sender.mediaGroups.length > 0, 'sendMediaGroup should be called for multiple images')
  assert.ok(sender.sent.length > 0, 'follow-up sendMessage should be called for the keyboard')
})

// =============================================================================
// Conversational reply tests
// =============================================================================

function replyMsgUpdate(
  userId: number,
  chatId: number,
  text: string,
  replyToMessageId: number,
  messageId = 99
): TelegramUpdate {
  return {
    update_id: 10,
    message: {
      message_id: messageId,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      text,
      date: Math.floor(Date.now() / 1000),
      reply_to_message: { message_id: replyToMessageId },
    },
  }
}

// 24. Plain text while flow in RESULT state routes to router.handle as prompt
// This works because ExecuteFlow stays in RESULT state and router.hasContext() is still true.
// The allocutio just routes text → router.handle({kind:'prompt',...}) as it always does.
test('plain text while flow in RESULT state routes to router.handle as prompt', async () => {
  const { allocutio, router } = makeAllocutio()

  // Enter a flow — router will have an active context for this user
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  // Send plain text while flow is active (simulates RESULT state)
  await allocutio.receive(msgUpdate(123, 456, 'follow up question'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should be called with prompt event')
  const event = handleCall!.args[3] as { kind: string; text: string }
  assert.equal(event.kind, 'prompt', 'event kind should be prompt')
  assert.equal(event.text, 'follow up question', 'event text should match message text')
})

// 23. _react called with 🤔 on command receipt
test('_react called with 🤔 emoji on command receipt', async () => {
  const { allocutio, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/make', 77))

  // Reaction should have been set (may be async)
  await new Promise(r => setImmediate(r))

  assert.ok(sender.reactions.length > 0, 'setMessageReaction should be called')
  const thinking = sender.reactions.find(r => r.emoji === '🤔')
  assert.ok(thinking, 'should react with 🤔')
})

// =============================================================================
// Phase 1+2 — kill the waste, warm reaction
// =============================================================================
test('actum.complete applies the warm window but sends NO concierge message', async () => {
  const { allocutio, router, sender, materiaUpdates } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-c', status: 'running' }] })
  await new Promise(r => setImmediate(r))
  emitStage('actum-c', 'pod-locked', { podId: 'pod-1' })
  await new Promise(r => setImmediate(r))

  sender.sent.length = 0
  bus.emit('actum.complete', { actumId: 'actum-c', durationMs: 13000, coldStart: false, costUsd: 0.01, podId: 'pod-1' } as unknown as WideEvent)
  await new Promise(r => setTimeout(r, 150))

  assert.equal(sender.sent.length, 0, 'should not send a "Done in" concierge message')
  assert.ok(materiaUpdates.some(u => (u.patch as { warmUntil?: Date }).warmUntil), 'warm window should still be applied')
})

test('warm-pod-found stage reacts 🔥 on the command message', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-w', status: 'running' }] })
  await new Promise(r => setImmediate(r))
  emitStage('actum-w', 'warm-pod-found')
  // warm-pod-found cancels the deferred 👌 and reacts 🔥 (~500ms). Wait past both the
  // 🔥 delay and the 👌 deadline (800ms) to prove 👌 never fired.
  await new Promise(r => setTimeout(r, 900))
  assert.ok(sender.reactions.some(r => r.emoji === '🔥' && r.messageId === 50), 'should react 🔥 for a warm pod')
  assert.ok(!sender.reactions.some(r => r.emoji === '👌'), 'a warm run must never flash 👌')
})

test('progress:N/M stage does not create a standalone generating message', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-p', status: 'running' }] })
  await new Promise(r => setImmediate(r))
  sender.sent.length = 0
  emitStage('actum-p', 'progress:1/4')
  await new Promise(r => setImmediate(r))
  assert.equal(sender.sent.length, 0, 'the KSampler progress bar should not spawn a message')
})

// =============================================================================
// Phase 3 — morphing delivery menu (Info / Rate / Wrench)
// =============================================================================
function resultStep(actumId: string): Step {
  return { primitives: [{
    kind: 'Result', actumId, label: 'Here you go',
    media: [{ type: 'image', url: 'https://x/img.png', caption: 'a cat' }],
    actions: [
      { id: 'rate_beautiful', label: '😻' }, { id: 'rate_funny', label: '😹' }, { id: 'rate_negative', label: '😿' },
      { id: 'tweak', label: '✎ Tweak' }, { id: 'rerun', label: '↻ Rerun' },
    ],
  }] } as unknown as Step
}
const flowCtx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' }
function cbTo(msgId: number, data: string): Parameters<TelegramAllocutio['receive']>[0] {
  return { update_id: 9, callback_query: { id: 'cb', from: { id: 123 }, message: { message_id: msgId, chat: { id: 456 } }, data } } as unknown as Parameters<TelegramAllocutio['receive']>[0]
}

test('Result renders the default delivery row (ℹ ♥ ⚙ with dm: callbacks)', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(flowCtx, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))
  const kb = (sender.photos[0]?.extra as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).reply_markup.inline_keyboard
  const data = kb.flat().map(b => b.callback_data)
  assert.deepEqual(data, ['dm:info:actum-1', 'dm:rate:actum-1', 'dm:wrench:actum-1'])
})

test('dm:rate morphs the row to the rating emojis', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(flowCtx, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))
  await allocutio.receive(cbTo(201, 'dm:rate:actum-1'))
  const m = sender.markups.at(-1)!.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }
  assert.deepEqual(m.inline_keyboard.flat().map(b => b.callback_data),
    ['dm:rated:actum-1:beautiful', 'dm:rated:actum-1:funny', 'dm:rated:actum-1:negative'])
})

test('dm:wrench morphs the row to Back / Tweak / Rerun', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(flowCtx, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))
  await allocutio.receive(cbTo(201, 'dm:wrench:actum-1'))
  const m = sender.markups.at(-1)!.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }
  assert.deepEqual(m.inline_keyboard.flat().map(b => b.callback_data),
    ['dm:back:actum-1', 'dm:tweak:actum-1', 'dm:rerun:actum-1', 'dm:save:actum-1'])
})

test('dm:info edits the caption to DB-sourced stats', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(flowCtx, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))
  await allocutio.receive(cbTo(201, 'dm:info:actum-1'))
  await new Promise(r => setImmediate(r))
  const cap = sender.captions.at(-1)!.caption
  assert.match(cap, /RTX 4090/)
  assert.match(cap, /Seed: 4242/)
  assert.match(cap, /warm/)
})

test('dm:tweak runs under the presser (presser pays) prefilled with the modus', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(flowCtx, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))
  router.calls.length = 0
  await allocutio.receive(cbTo(201, 'dm:tweak:actum-1'))
  await new Promise(r => setImmediate(r))
  const enter = router.calls.find(c => c.method === 'enter')
  assert.ok(enter, 'should enter execute for the presser')
  assert.equal((enter!.args[2]), '123', 'under the presser userId')
  assert.equal(((enter!.args[5] as { state: { modusId: string } }).state.modusId), 'flux-schnell')
})

// =============================================================================
// Warm 🔥 survives the race (warm-pod-found arrives before actum registration)
// =============================================================================
test('warm signal arriving before registration still reacts 🔥 (not 👌)', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))

  // Warm signal fires FIRST (WarmPodClient emits it inside submit, pre-Stream)
  emitStage('actum-warm', 'warm-pod-found', { podId: 'pod-9' })
  await new Promise(r => setImmediate(r))

  // Then the flow yields the Stream primitive → registration. Because the warm
  // signal already arrived (pendingWarm), registration goes straight to 🔥 and
  // never schedules the deferred 👌.
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-warm', status: 'running' }] })
  await new Promise(r => setTimeout(r, 900))

  // setMessageReaction replaces, so the LAST reaction on the command message wins.
  const last = sender.reactions.filter(r => r.messageId === 50).at(-1)
  assert.equal(last?.emoji, '🔥', 'warm reuse should end on 🔥')
  assert.ok(!sender.reactions.some(r => r.emoji === '👌'), 'a warm run must never flash 👌')
})

// =============================================================================
// Phase 4a — session bulletin
// =============================================================================
function bulCb(fromId: number, data: string): Parameters<TelegramAllocutio['receive']>[0] {
  return { update_id: 9, callback_query: { id: 'cb', from: { id: fromId }, message: { message_id: 777, chat: { id: 456 } }, data } } as unknown as Parameters<TelegramAllocutio['receive']>[0]
}
function lockPod(allocutio: TelegramAllocutio, router: ReturnType<typeof makeRouter>, actumId: string) {
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId, status: 'running' }] })
}

test('pod-locked creates the session bulletin with the warm stepper + confirm', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'provisioning')
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await new Promise(r => setImmediate(r))
  // Bulletin posts at registration then edits in pod info — check both surfaces.
  const bul = [...sender.sent, ...sender.edited].find(s => /RTX 4090/.test(s.text))
  assert.ok(bul, 'bulletin shows the Found line with pod info')
  const data = ((bul!.extra as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).reply_markup.inline_keyboard).flat().map(b => b.callback_data)
  assert.ok(data.includes('bul:confirm'), 'setup state shows confirm')
  assert.ok(data.includes('bul:inc'), 'setup state shows stepper')
})

test('bul:kill is host-only, terminates the pod, and cancels in-flight gens (freezes receipt)', async () => {
  const { allocutio, router, terminated, cancelCalls } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  await new Promise(r => setImmediate(r))

  await allocutio.receive(bulCb(999, 'bul:kill'))   // not the host
  await new Promise(r => setImmediate(r))
  assert.deepEqual(terminated, [], 'non-host kill is ignored')
  assert.equal(cancelCalls.length, 0, 'non-host kill does not cancel')

  await allocutio.receive(bulCb(123, 'bul:kill'))   // the host
  await new Promise(r => setImmediate(r))
  assert.deepEqual(terminated, ['pod-1'], 'host kill terminates the session pod')
  // Cancel-on-destroy: the in-flight gen on this chat is cancelled (refunded).
  assert.equal(cancelCalls.length, 1, 'host kill cancels the in-flight actum')
  assert.equal(cancelCalls[0].actumId, 'a1')
})

test('a new pod after a receipt starts a FRESH bulletin (does not reanimate the old one)', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'provisioning')
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await new Promise(r => setImmediate(r))

  // Close the session → receipt frozen.
  bus.emit('pod.reaped', { externusId: 'pod-1' })
  await new Promise(r => setImmediate(r))
  const receiptMsgId = sender.edited.at(-1)!.messageId
  const editsBefore = sender.edited.length
  const sentBefore = sender.sent.length   // don't reset (the mock derives ids from length)

  // A new generation on a new pod must post a NEW bulletin, not edit the receipt.
  router.triggerStep(
    { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' } as FlowContext,
    { primitives: [{ kind: 'Stream', label: 'g', actumId: 'a2', status: 'running' }] },
  )
  await new Promise(r => setImmediate(r))
  emitStage('a2', 'provisioning')
  emitStage('a2', 'pod-locked', { podId: 'pod-2', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await new Promise(r => setImmediate(r))

  assert.ok(sender.sent.length > sentBefore, 'a fresh bulletin is posted as a new message')
  assert.ok(!sender.edited.slice(editsBefore).some(e => e.messageId === receiptMsgId),
    'the old receipt is never edited back to life')
})

test('pod.reaped freezes the matching session bulletin to a receipt', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  await new Promise(r => setImmediate(r))
  sender.edited.length = 0

  bus.emit('pod.reaped', { externusId: 'pod-1' })
  await new Promise(r => setImmediate(r))

  // The bulletin re-renders into its receipt state ("Pod shut down.").
  assert.ok(sender.edited.some(e => /shut down/i.test(e.text)),
    'reaped pod freezes its bulletin to the receipt')
})

test('actum.complete tallies the gen into the bulletin totals', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  await new Promise(r => setImmediate(r))
  sender.edited.length = 0
  bus.emit('actum.complete', { actumId: 'a1', durationMs: 12000, coldStart: true, costUsd: 0.09, podId: 'pod-1' } as unknown as WideEvent)
  await new Promise(r => setImmediate(r))
  const txt = sender.edited.map(m => m.text).join('\n')
  assert.match(txt, /1 gen/, 'bulletin shows the session gen count')
})

test('cold-start journal: silent hunt, committed Found/Prepared lines, live line', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(
    { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123', platformChatId: '456' } as FlowContext,
    { primitives: [{ kind: 'Stream', label: 'g', actumId: 'a1', status: 'running' }] },
  )
  await new Promise(r => setImmediate(r))

  const textAfter = async (stage: string, info?: Record<string, unknown>) => {
    sender.sent.length = 0; sender.edited.length = 0
    emitStage('a1', stage, info)
    await new Promise(r => setImmediate(r))
    return [...sender.sent, ...sender.edited].map(m => m.text).at(-1) ?? ''
  }

  // Hunt is silent unless it drags — provisioning shows no "Hunting" line yet.
  const prov = await textAfter('provisioning')
  assert.ok(!/Hunting/.test(prov), 'fast hunt stays quiet')
  // pod-locked commits the Found line + live Initializing. (The owned timeline derives the hunt
  // duration from real elapsed `at`, not a synthetic `phaseMs`, so we don't pin "in 30s" here —
  // the duration math is unit-tested in PodSession.test.ts.)
  const locked = await textAfter('pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  assert.match(locked, /Found RTX 4090 for \$0\.69\/hr/)
  assert.match(locked, /Initializing/)
  // download → connected live line; the Found line persists above it.
  const dl = await textAfter('downloading:3/4')
  assert.match(dl, /Found RTX 4090 for \$0\.69\/hr/)
  assert.match(dl, /Connected, downloading models \(3\/4\)/)
  // comfy-ready commits the Prepared line + live Generating.
  const ready = await textAfter('comfy-ready', { phaseMs: 4.5 * 60_000 })
  assert.match(ready, /Prepared Make Setup/)
  assert.match(ready, /Generating/)
})

test('a throttle re-hunt surfaces as a fresh Found line (the Quit line retired with the shim, #6b)', async () => {
  // The legacy `pod-bailed` → "Quit pod N" meta line was Fake/dev-only; the real throttle path
  // never emitted it — it re-provisions, which the owned timeline shows as a new hunt → Found.
  // So `pod-bailed` yields no Progressus (no bulletin change); the re-provision drives the rest.
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'provisioning')
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  await new Promise(r => setImmediate(r))

  emitStage('a1', 'pod-bailed')   // no owned phase → no bulletin change
  emitStage('a1', 'provisioning') // throttle → re-hunt
  emitStage('a1', 'pod-locked', { podId: 'pod-2', gpuType: 'RTX 4090', costPerHr: 0.69 })
  await new Promise(r => setImmediate(r))

  const txt = sender.edited.at(-1)!.text
  assert.match(txt, /Found RTX 4090 for \$0\.69\/hr/, 'the replacement pod commits a Found line')
  assert.ok(!/Quit pod/.test(txt), 'no Quit meta line — retired with the actum.stage shim')
})

test('per-gen average falls across gens and the idle nudge shows marginal cost', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await new Promise(r => setImmediate(r))
  await allocutio.receive(bulCb(123, 'bul:confirm'))  // confirm → idle nudge, not setup prompt
  await new Promise(r => setImmediate(r))

  bus.emit('actum.complete', { actumId: 'a1', durationMs: 12000, executionMs: 12000, costUsd: 0.08, podId: 'pod-1' } as unknown as WideEvent)
  await new Promise(r => setImmediate(r))
  const txt = sender.edited.at(-1)!.text
  assert.match(txt, /1 gen · exec ~12s avg · \$0\.080 ea · \$0\.08 total/, 'stat line with falling per-gen average')
  assert.match(txt, /next gen ~\$0\.005 — keep cooking/, 'idle nudge shows marginal cost')
})

test('GPU + rate live in the Found journal line; no vendor noise or location', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'provisioning')
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'NVIDIA GeForce RTX 4090', region: 'EU-RO-1', costPerHr: 0.69, phaseMs: 30_000 })
  await new Promise(r => setImmediate(r))
  bus.emit('actum.complete', { actumId: 'a1', durationMs: 12000, executionMs: 12000, coldStart: true, costUsd: 0.08, podId: 'pod-1' } as unknown as WideEvent)
  await new Promise(r => setImmediate(r))

  const txt = [...sender.sent.map(s => s.text), ...sender.edited.map(e => e.text)].join('\n---\n')
  assert.match(txt, /Found RTX 4090 for \$0\.69\/hr/, 'GPU + rate in the Found line')
  assert.match(txt, /1 gen .* \$0\.08 total/, 'stat line carries the cost')
  assert.ok(!/EU-RO-1/.test(txt), 'location is dropped (confusing to the user)')
  assert.ok(!/NVIDIA|GeForce/.test(txt), 'vendor noise is stripped from the GPU name')
})

test('warm window auto-settles (confirms) if the host does not interact', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true, autoSettleMs: 40 })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  await new Promise(r => setImmediate(r))

  // Before the window lapses, the stepper (bul:confirm) is still offered.
  const setup = [...sender.sent, ...sender.edited].at(-1)
  const setupBtns = ((setup!.extra as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).reply_markup.inline_keyboard).flat().map(b => b.callback_data)
  assert.ok(setupBtns.includes('bul:confirm'), 'setup shows the confirm button')

  sender.edited.length = 0
  await new Promise(r => setTimeout(r, 80))   // past the 40ms settle window

  const settled = sender.edited.at(-1)
  assert.ok(settled, 'auto-settle re-rendered the bulletin')
  const btns = ((settled!.extra as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).reply_markup.inline_keyboard).flat().map(b => b.callback_data)
  assert.ok(btns.includes('bul:destroy') && btns.includes('bul:mod') && btns.includes('bul:share'),
    'auto-settle lands on the spec\'d top-3 [Mod] [Share] [Destroy]')
  assert.ok(!btns.includes('bul:confirm'), 'no longer in setup state')
})

// =============================================================================
// Mod • → Add picker (item 4: adapter wiring + colon-suffix parsing + force-reply search)
// =============================================================================

function fakeIntellarum() {
  const ALL = [
    { id: 'intella.flux', nomen: 'FLUX Schnell', genus: 'model', architectura: 'dit', dest: 'checkpoints/flux.safetensors' },
    { id: 'intella.sdxl', nomen: 'SDXL', genus: 'model', architectura: 'dit', dest: 'checkpoints/sdxl.safetensors' },
    { id: 'intella.milady', nomen: 'Milady', genus: 'lora', dest: 'loras/milady.safetensors', baseIntellaId: 'intella.flux', slug: 'milady', trigger: 'milady' },
    { id: 'intella.retro', nomen: 'Retro Style', genus: 'lora', dest: 'loras/retro.safetensors', baseIntellaId: 'intella.flux', slug: 'retro', trigger: 'retro artstyle' },
  ]
  return {
    async list(_genus?: string) { return ALL },   // the catalog filters by mount itself
    async find(id: string) { return ALL.find(x => x.id === id) ?? null },
    async canonical() { return [] },
    async findByTrigger() { return [] },
    async triggerMap() { return new Map() },
  }
}
function kbDataOf(extra: unknown): string[] {
  const kb = (extra as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data: string }>> } })?.reply_markup?.inline_keyboard ?? []
  return kb.flat().map(b => b.callback_data)
}
function lastKb(sender: ReturnType<typeof makeSender>): string[] {
  const m = [...sender.sent, ...sender.edited].at(-1)
  return kbDataOf(m?.extra)
}
function lastText(sender: ReturnType<typeof makeSender>): string {
  return [...sender.sent, ...sender.edited].at(-1)?.text ?? ''
}
/** True if the keyboard has a pick button for the i-th item (token-agnostic). */
function hasPick(data: string[], i: number): boolean {
  return data.some(d => new RegExp(`^bul:mod\\.pick:\\d+:${i}$`).test(d))
}
/** The full `bul:mod.pick:<token>:<i>` callback data for the i-th item in the live keyboard. */
function pickCb(sender: ReturnType<typeof makeSender>, i: number): string {
  return lastKb(sender).find(d => new RegExp(`^bul:mod\\.pick:\\d+:${i}$`).test(d))!
}
/** /make → lock pod → confirm → open Mod • submenu, all host-side on chat 456. */
async function bootMod() {
  const h = makeAllocutio({ withPodControls: true, autoSettleMs: 999_999, intellarum: fakeIntellarum() })
  await h.allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(h.allocutio, h.router, 'a1')
  await new Promise(r => setImmediate(r))
  emitStage('a1', 'provisioning')
  emitStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:confirm'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod'))
  await new Promise(r => setImmediate(r))
  return h
}

test('Mod • → Add opens the category stage through the adapter', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  const data = lastKb(h.sender)
  assert.ok(data.includes('bul:mod.cat:checkpoints') && data.includes('bul:mod.cat:loras'), 'mount categories shown')
  assert.match(lastText(h.sender), /Add a model — pick a type/)
})

test('bul:mod.cat:<mount> + bul:mod.pick:<i> queue the model — colon suffixes survive the parser', async () => {
  // The old `split(":")[1]` parser would truncate `mod.cat:checkpoints` / `mod.pick:T:1`.
  // This pins the slice(4) fix end-to-end through the two-stage nav.
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod.cat:checkpoints'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, pickCb(h.sender, 1)))   // SDXL
  await new Promise(r => setImmediate(r))
  assert.match(lastText(h.sender), /Standby: SDXL/)
  assert.ok(lastKb(h.sender).some(d => d.startsWith('bul:mod.pick:')), 'stays in the list for rapid-add')
})

test('bul:mod.cat:loras lists LoRAs through the adapter', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod.cat:loras'))
  await new Promise(r => setImmediate(r))
  assert.match(lastText(h.sender), /loras/)
  assert.ok(hasPick(lastKb(h.sender), 0), 'LoRA rows shown')
})

test('Mod • → Add → Search: force-reply prompt, then the reply routes to the picker', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))

  await h.allocutio.receive(bulCb(123, 'bul:mod.search'))
  await new Promise(r => setImmediate(r))
  const prompt = h.sender.sent.at(-1)!
  assert.ok((prompt.extra as { reply_markup?: { force_reply?: boolean } })?.reply_markup?.force_reply, 'sent a force-reply prompt')
  const promptId = 100 + h.sender.sent.length   // mock derives message_id = 100 + sent.length

  // Host replies to that prompt with a search term.
  await h.allocutio.receive({
    update_id: 10,
    message: {
      message_id: 5, from: { id: 123 }, chat: { id: 456, type: 'private' },
      text: 'milady', date: Math.floor(Date.now() / 1000), reply_to_message: { message_id: promptId },
    },
  } as unknown as Parameters<TelegramAllocutio['receive']>[0])
  await new Promise(r => setImmediate(r))

  assert.match(lastText(h.sender), /Search “milady”/)
  assert.ok(hasPick(lastKb(h.sender), 0), 'the matching LoRA is offered')
  // The exchange is cleaned up: both the force-reply prompt and the host's reply are deleted.
  assert.ok(h.sender.deleted.some(d => d.messageId === promptId), 'force-reply prompt deleted')
  assert.ok(h.sender.deleted.some(d => d.messageId === 5), "host's reply deleted")
})

test('a reply to an unrelated message is NOT captured as a picker search', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive({
    update_id: 11,
    message: {
      message_id: 6, from: { id: 123 }, chat: { id: 456, type: 'private' },
      text: 'just chatting', date: Math.floor(Date.now() / 1000), reply_to_message: { message_id: 99999 },
    },
  } as unknown as Parameters<TelegramAllocutio['receive']>[0])
  await new Promise(r => setImmediate(r))
  assert.ok(!/Search “/.test(lastText(h.sender)), 'unmatched reply did not run a search')
})

test('search spans base models too — _searchModels unions model + lora genera', async () => {
  // "flux" matches a base model (genus 'model'); a regression dropping the models half
  // of the union would make this return nothing.
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod.search'))
  await new Promise(r => setImmediate(r))
  const promptId = 100 + h.sender.sent.length
  await h.allocutio.receive({
    update_id: 12,
    message: {
      message_id: 7, from: { id: 123 }, chat: { id: 456, type: 'private' },
      text: 'flux', date: Math.floor(Date.now() / 1000), reply_to_message: { message_id: promptId },
    },
  } as unknown as Parameters<TelegramAllocutio['receive']>[0])
  await new Promise(r => setImmediate(r))
  assert.match(lastText(h.sender), /Search “flux”/)
  assert.ok(hasPick(lastKb(h.sender), 0), 'the matching base model is offered from a search')
})

test('a non-host reply to the search prompt is ignored (group safety)', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod.search'))
  await new Promise(r => setImmediate(r))
  const promptId = 100 + h.sender.sent.length
  // A different group member (id 999) replies to the host's prompt.
  await h.allocutio.receive({
    update_id: 13,
    message: {
      message_id: 8, from: { id: 999 }, chat: { id: 456, type: 'private' },
      text: 'milady', date: Math.floor(Date.now() / 1000), reply_to_message: { message_id: promptId },
    },
  } as unknown as Parameters<TelegramAllocutio['receive']>[0])
  await new Promise(r => setImmediate(r))
  assert.ok(!/Search “/.test(lastText(h.sender)), 'a guest cannot drive the host picker search')
})

test('a queued model is stamped onto the flow as pinnedModels at /make, then cleared (item 5)', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod.cat:checkpoints'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, pickCb(h.sender, 1)))   // queue SDXL (a base model)
  await new Promise(r => setImmediate(r))

  // /make in the same chat → _enterExecute folds the pending loadout onto the flow state.
  await h.allocutio.receive(msgUpdate(123, 456, '/make a cat', 60))
  await new Promise(r => setImmediate(r))
  const enter1 = h.router.calls.filter(c => c.method === 'enter').at(-1)!
  const state1 = (enter1.args[5] as { state?: { pinnedModels?: Array<{ id: string; role: string }> } })?.state
  const pin = state1?.pinnedModels?.find(p => p.id === 'intella.sdxl')
  assert.ok(pin, 'queued base model stamped as pinnedModels')
  assert.equal(pin!.role, 'checkpoint', 'a base model maps to role checkpoint')

  // Cleared at dispatch — the next /make does NOT re-apply it.
  await h.allocutio.receive(msgUpdate(123, 456, '/make another', 61))
  await new Promise(r => setImmediate(r))
  const enter2 = h.router.calls.filter(c => c.method === 'enter').at(-1)!
  const state2 = (enter2.args[5] as { state?: { pinnedModels?: unknown } })?.state
  assert.ok(!state2?.pinnedModels, 'pending cleared — not re-applied on the next gen')
})

test('/chat does not consume the studio pending loadout', async () => {
  const h = await bootMod()
  await h.allocutio.receive(bulCb(123, 'bul:mod.add'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, 'bul:mod.cat:checkpoints'))
  await new Promise(r => setImmediate(r))
  await h.allocutio.receive(bulCb(123, pickCb(h.sender, 1)))   // queue a model
  await new Promise(r => setImmediate(r))

  await h.allocutio.receive(msgUpdate(123, 456, '/chat', 62))
  await new Promise(r => setImmediate(r))
  const enterChat = h.router.calls.filter(c => c.method === 'enter').at(-1)!
  const stateChat = (enterChat.args[5] as { state?: { pinnedModels?: unknown; modusId?: string } })?.state
  assert.equal(stateChat?.modusId, 'modus.openrouter-chat')
  assert.ok(!stateChat?.pinnedModels, '/chat is not a studio gen — pending left intact')

  // The loadout is still queued: a subsequent /make picks it up.
  await h.allocutio.receive(msgUpdate(123, 456, '/make a cat', 63))
  await new Promise(r => setImmediate(r))
  const enterMake = h.router.calls.filter(c => c.method === 'enter').at(-1)!
  const stateMake = (enterMake.args[5] as { state?: { pinnedModels?: Array<{ id: string }> } })?.state
  assert.ok(stateMake?.pinnedModels?.some(p => p.id === 'intella.sdxl'), '/make still gets the queued model')
})

// =============================================================================
// Envelope-borne commands + entry images (TASK-004)
// =============================================================================

// A photo message whose caption carries the command.
function captionCmdUpdate(userId: number, chatId: number, caption: string, fileIds: string[], messageId = 1): TelegramUpdate {
  return {
    update_id: 5,
    message: {
      message_id: messageId,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      caption,
      date: Math.floor(Date.now() / 1000),
      photo: fileIds.map((file_id, i) => ({ file_id, width: (i + 1) * 100, height: (i + 1) * 100 })),
    },
  }
}

// A text command fired as a reply to a photo message.
function replyToPhotoCmdUpdate(userId: number, chatId: number, text: string, fileIds: string[], messageId = 1): TelegramUpdate {
  return {
    update_id: 6,
    message: {
      message_id: messageId,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      text,
      date: Math.floor(Date.now() / 1000),
      reply_to_message: { message_id: messageId - 1, photo: fileIds.map((file_id, i) => ({ file_id, width: (i + 1) * 100, height: (i + 1) * 100 })) },
    },
  }
}

test('caption command: a photo whose caption is /run … dispatches the command', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive(captionCmdUpdate(123, 456, '/run sd1-5 a cat', ['photo-1']))

  const enterCall = router.calls.find(c => c.method === 'enter')
  assert.ok(enterCall, 'caption-borne /run should dispatch + enter execute')
  const state = (enterCall!.args[5] as { state?: { modusId?: string; aditus?: Record<string, unknown> } })?.state
  assert.equal(state?.modusId, 'sd1-5')
  assert.equal(state?.aditus?.prompt, 'a cat')
})

test('attached image fills the entry media on the flow state', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive(captionCmdUpdate(123, 456, '/run sd1-5', ['photo-lo', 'photo-hi']))

  const enterCall = router.calls.find(c => c.method === 'enter')
  const state = (enterCall!.args[5] as { state?: { entryMediaUrl?: string; entryMediaType?: string } })?.state
  assert.ok(state?.entryMediaUrl?.endsWith('photo-hi'), 'highest-res attached photo becomes the entry media')
})

test('reply-to image: a text command replying to a photo sources the image', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive(replyToPhotoCmdUpdate(123, 456, '/run sd1-5', ['rep-1']))

  const enterCall = router.calls.find(c => c.method === 'enter')
  const state = (enterCall!.args[5] as { state?: { entryMediaUrl?: string; entryMediaType?: string } })?.state
  assert.ok(state?.entryMediaUrl?.endsWith('rep-1'), 'replied-to photo becomes the entry media')
})

test('attached photo takes precedence over a replied-to photo', async () => {
  const { allocutio, router } = makeAllocutio()
  // both an attached photo and a replied-to photo present
  await allocutio.receive({
    update_id: 7,
    message: {
      message_id: 10,
      from: { id: 123, username: 'tester' },
      chat: { id: 456, type: 'private' },
      caption: '/run sd1-5',
      date: Math.floor(Date.now() / 1000),
      photo: [{ file_id: 'attached-hi', width: 200, height: 200 }],
      reply_to_message: { message_id: 9, photo: [{ file_id: 'replied-hi', width: 200, height: 200 }] },
    },
  })
  const enterCall = router.calls.find(c => c.method === 'enter')
  const state = (enterCall!.args[5] as { state?: { entryMediaUrl?: string; entryMediaType?: string } })?.state
  assert.ok(state?.entryMediaUrl?.endsWith('attached-hi'), 'attached photo wins over replied-to')
})

// =============================================================================
// Media ingest — every wrapper Telegram puts a file in, not only `photo`
// =============================================================================

/** A bare (no caption, no text) message carrying one media field. */
function mediaMsgUpdate(userId: number, chatId: number, media: Record<string, unknown>, messageId = 1): TelegramUpdate {
  return {
    update_id: 8,
    message: {
      message_id: messageId,
      from: { id: userId, username: 'tester' },
      chat: { id: chatId, type: 'private' },
      date: Math.floor(Date.now() / 1000),
      ...media,
    },
  }
}

const BARE_INGEST: Array<{ label: string; media: Record<string, unknown>; fileId: string }> = [
  { label: 'video', media: { video: { file_id: 'vid-1', mime_type: 'video/mp4' } }, fileId: 'vid-1' },
  { label: 'animation (GIF)', media: { animation: { file_id: 'gif-1', mime_type: 'video/mp4' } }, fileId: 'gif-1' },
  { label: 'audio', media: { audio: { file_id: 'aud-1', mime_type: 'audio/mpeg' } }, fileId: 'aud-1' },
  { label: 'voice note', media: { voice: { file_id: 'voi-1', mime_type: 'audio/ogg' } }, fileId: 'voi-1' },
  { label: 'uncompressed image sent as a document', media: { document: { file_id: 'doc-1', mime_type: 'image/png', file_name: 'x.png' } }, fileId: 'doc-1' },
]

for (const { label, media, fileId } of BARE_INGEST) {
  test(`${label} while flow active fires prompt with file url`, async () => {
    const { allocutio, router } = makeAllocutio()
    await allocutio.receive(msgUpdate(123, 456, '/make'))
    router.calls.length = 0

    await allocutio.receive(mediaMsgUpdate(123, 456, media))

    const handleCall = router.calls.find(c => c.method === 'handle')
    assert.ok(handleCall, `router.handle should be called for ${label} with an active flow`)
    const event = handleCall!.args[3] as { kind: string; text: string }
    assert.equal(event.kind, 'prompt')
    assert.ok(event.text.includes(fileId), `should resolve the URL from the ${label} file_id`)
  })
}

test('a document that is not media advances nothing', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  await allocutio.receive(mediaMsgUpdate(123, 456, { document: { file_id: 'pdf-1', mime_type: 'application/pdf', file_name: 'contract.pdf' } }))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.equal(handleCall, undefined, 'a PDF is not something any Porta can take')
})

test('a sticker advances nothing — no text, no media, no empty prompt', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  await allocutio.receive(mediaMsgUpdate(123, 456, { sticker: { file_id: 'stk-1' } }))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.equal(handleCall, undefined, 'an empty prompt would fill the waiting field with nothing')
})

test('caption command: a video whose caption is /run … carries the video as entry media', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive({
    update_id: 9,
    message: {
      message_id: 11,
      from: { id: 123, username: 'tester' },
      chat: { id: 456, type: 'private' },
      caption: '/run some-video-modus',
      date: Math.floor(Date.now() / 1000),
      video: { file_id: 'cap-vid', mime_type: 'video/mp4' },
    },
  })
  const enterCall = router.calls.find(c => c.method === 'enter')
  const state = (enterCall!.args[5] as { state?: { entryMediaUrl?: string; entryMediaType?: string } })?.state
  assert.ok(state?.entryMediaUrl?.endsWith('cap-vid'), 'the attached video becomes the entry media')
  assert.equal(state?.entryMediaType, 'video', 'and it is typed as a video, not an image')
})

test('reply-to video: a text command replying to a video sources the video', async () => {
  const { allocutio, router } = makeAllocutio()
  await allocutio.receive({
    update_id: 10,
    message: {
      message_id: 12,
      from: { id: 123, username: 'tester' },
      chat: { id: 456, type: 'private' },
      text: '/run some-video-modus',
      date: Math.floor(Date.now() / 1000),
      reply_to_message: { message_id: 11, video: { file_id: 'rep-vid', mime_type: 'video/mp4' } },
    },
  })
  const enterCall = router.calls.find(c => c.method === 'enter')
  const state = (enterCall!.args[5] as { state?: { entryMediaUrl?: string; entryMediaType?: string } })?.state
  assert.ok(state?.entryMediaUrl?.endsWith('rep-vid'), 'replied-to video becomes the entry media')
  assert.equal(state?.entryMediaType, 'video')
})

// =============================================================================
// Save-as — both entry points open the menu seeded from actum / card state
// =============================================================================

function makeModorumMock() {
  const base = {
    id: 'flux-schnell', nomen: 'FLUX', genus: 'atomicus', versio: '1.0.0', contentHash: 'h',
    ministerium: 'runpod', canonica: true, intellae: [{ id: 'intella.flux', role: 'unet' }],
    aditus: { prompt: { type: 'text', required: true } }, exitus: { image: { type: 'image' } },
    natum: new Date(), mutatum: new Date(),
  }
  const registered: unknown[] = []
  return {
    registered,
    modorum: {
      async find(id: string) { return id === 'flux-schnell' ? base : null },
      async register(m: unknown) { registered.push(m) },
      async list() { return [] },
      async update() { throw new Error('unused') },
    },
  }
}

test('dm:save opens the Save-as menu seeded from the actum (force-reply name prompt)', async () => {
  const mm = makeModorumMock()
  const { allocutio, router, sender } = makeAllocutio({ modorum: mm.modorum })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(flowCtx, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))

  await allocutio.receive(cbTo(201, 'dm:save:actum-1'))
  const prompt = sender.sent.at(-1)!
  assert.deepEqual((prompt.extra as { reply_markup?: unknown }).reply_markup, { force_reply: true })
})

test('a:saveas opens the Save-as menu seeded from the active flow card state', async () => {
  const mm = makeModorumMock()
  const { allocutio, router, sender } = makeAllocutio({ modorum: mm.modorum })
  // Seed an active flow card context the adapter peeks for modusId + aditus.
  router.seedContext('telegram', '123', { modusId: 'flux-schnell', aditus: { steps: 8 } })

  await allocutio.receive(cbTo(99, 'a:saveas'))
  const prompt = sender.sent.at(-1)!
  assert.deepEqual((prompt.extra as { reply_markup?: unknown }).reply_markup, { force_reply: true })
  // No flow-router handle for saveas — the menu is force-reply driven, not a flow step.
  assert.ok(!router.calls.some(c => c.method === 'handle'), 'a:saveas must not route to the flow')
})

// =============================================================================
// Regression coverage for the 2026-08-12 rulings (item noema-195)
// =============================================================================

// Ruling 2: unaddressed plain text in a group advances nothing at all.
test('unaddressed plain text in a group with an active flow does not advance it', async () => {
  const { allocutio, router } = makeAllocutio({ botUsername: 'stationbot' })

  // Flow entered from a DM first (private chats are unaffected by the gate).
  await allocutio.receive(msgUpdate(123, 456, '/make'))
  router.calls.length = 0

  // Same user, now in a group, plain text with no @-mention and no reply-to-bot.
  await allocutio.receive(groupMsgUpdate(123, 789, 'what should I do next'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.equal(handleCall, undefined, 'unaddressed group text must not reach the flow router')
})

// Ruling 2: an @-mention or a reply to the bot's own message is a valid address in a group.
test('a group message @-mentioning the bot is routed if a flow is active for that chat', async () => {
  const { allocutio, router } = makeAllocutio({ botUsername: 'stationbot' })

  // Enter the flow IN the group chat itself (789), so a correctly-addressed message there has
  // something to route to.
  await allocutio.receive(groupMsgUpdate(123, 789, '/make @stationbot'))
  router.calls.length = 0

  await allocutio.receive(groupMsgUpdate(123, 789, 'hey @stationbot keep going'))
  assert.ok(router.calls.some(c => c.method === 'handle'), 'an @-mentioned group message should reach the flow router')

  router.calls.length = 0
  await allocutio.receive(groupMsgUpdate(123, 789, 'thanks', { replyToBot: true, botUsername: 'stationbot' }))
  assert.ok(router.calls.some(c => c.method === 'handle'), 'a reply to the bot should reach the flow router')
})

// Ruling 1 + 3: a context opened in chat A is invisible to hasContext/handle from chat B for
// the same user, and the render target follows the FlowContext, not the most recently active chat.
test('render target follows the flow\'s own chat, even after the user types elsewhere', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  // Flow entered in chat A.
  await allocutio.receive(msgUpdate(123, 111, '/make', 50))

  // Same user types, unrelated, in chat B — no active flow there, so it's a no-op for
  // routing, but (per the still-live chatIds map) it IS the most recently typed-in chat.
  await allocutio.receive(msgUpdate(123, 222, 'unrelated chatter in another chat'))
  const handleCallFromChatB = router.calls.find(c => c.method === 'handle')
  assert.equal(handleCallFromChatB, undefined, 'chat B has no active flow for this user')

  const ctxChatA: FlowContext = {
    intent: 'execute', state: {}, identity: { animaId: 'a' },
    platform: 'telegram', platformUserId: '123', platformChatId: '111',
  }
  router.triggerStep(ctxChatA, resultStep('actum-1'))
  await new Promise(r => setImmediate(r))

  assert.equal(sender.photos.length, 1)
  assert.equal(sender.photos[0].chatId, 111, 'renders into the chat the flow was opened in, not chat B')
})

// =============================================================================
// Private generation (noema-347): a private result arrives as MEDIA
// =============================================================================
//
// A private run's output is a `noema-private://<key>` marker, not a URL — the bucket it names
// has no public binding. Telegram cannot fetch a scheme it has no client for, so the marker is
// resolved to a link minted for this one send, which Telegram fetches server-side. What must
// never happen is the marker (or the grant) reaching the chat as text.

const PRIVATE_MEDIA_MARKER = 'noema-private://private-outputs/abcdef0123456789/cccc.png'

/** The Result step a completed private run produces — media, because the marker IS media. */
function privateResultStep(url = PRIVATE_MEDIA_MARKER): import('../../../src/flow/types.js').Step {
  return {
    primitives: [{
      kind: 'Result',
      actumId: 'actum-42',
      label: 'Result',
      media: [{ url, type: 'image', caption: 'a cat' }],
      actions: [{ id: 'info', label: 'ℹ' }],
    }],
  }
}

const privateCtx: FlowContext = {
  intent: 'execute',
  state: {},
  identity: { animaId: 'test-anima' },
  platform: 'telegram',
  platformUserId: '123',
  platformChatId: '456',
}

test('a private result is sent as a photo, through a link minted for the send', async () => {
  const asked: string[] = []
  const { allocutio, router, sender } = makeAllocutio({
    resolvePrivateMedia: async (marker) => { asked.push(marker); return 'https://private.example/cccc.png?sig=minted' },
  })
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  sender.sent.length = 0
  router.triggerStep(privateCtx, privateResultStep())
  await new Promise(r => setImmediate(r))

  assert.deepEqual(asked, [PRIVATE_MEDIA_MARKER], 'the marker was resolved once, at the send')
  assert.equal(sender.photos.length, 1, 'it arrives as a photo, not as text')
  assert.equal(sender.photos[0].url, 'https://private.example/cccc.png?sig=minted')
  for (const m of sender.sent) {
    assert.ok(!m.text.includes('noema-private://'), `the marker reached the chat as text: ${m.text}`)
  }
})

test('with no way to resolve it, a private result says so and prints no key', async () => {
  const { allocutio, router, sender } = makeAllocutio()   // no resolvePrivateMedia wired
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  sender.sent.length = 0
  router.triggerStep(privateCtx, privateResultStep())
  await new Promise(r => setImmediate(r))

  assert.equal(sender.photos.length, 0)
  assert.equal(sender.sent.length, 1, 'the user is told, once')
  assert.ok(!sender.sent[0].text.includes('noema-private://'), 'and never shown the key itself')
})

test('a failed send of a private result never falls back to posting the link', async () => {
  const { allocutio, router, sender } = makeAllocutio({
    resolvePrivateMedia: async () => 'https://private.example/cccc.png?sig=minted',
  })
  ;(sender as unknown as { sendPhoto: (...args: unknown[]) => unknown }).sendPhoto = async () => {
    throw new Error('Permission denied')
  }
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  sender.sent.length = 0
  router.triggerStep(privateCtx, privateResultStep())
  await new Promise(r => setImmediate(r))

  assert.equal(sender.sent.length, 1)
  // The public path may fall back to the URL as text; a private grant may not — posting it
  // hands everyone in the room a working read on a private object, outliving the failure.
  assert.ok(!sender.sent[0].text.includes('sig=minted'), 'the grant was posted into the chat')
  assert.ok(!sender.sent[0].text.includes('noema-private://'))
})

test('a public result still falls back to the URL as text when the send fails', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  ;(sender as unknown as { sendPhoto: (...args: unknown[]) => unknown }).sendPhoto = async () => {
    throw new Error('Permission denied')
  }
  await allocutio.receive(msgUpdate(123, 456, '/make'))

  sender.sent.length = 0
  router.triggerStep(privateCtx, privateResultStep('https://example.com/image.png'))
  await new Promise(r => setImmediate(r))

  assert.equal(sender.sent[0].text, 'https://example.com/image.png', 'the public fallback is unchanged')
})
