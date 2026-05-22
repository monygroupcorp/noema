import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TelegramAllocutio } from '../../../src/allocutio/TelegramAllocutio.js'
import { bus } from '../../../src/lib/bus.js'
import type {
  FlowContext, Step, Resolution, PrimitiveEvent, Intent, Platform, AuctorKey
} from '../../../src/flow/types.js'

// =============================================================================
// Mock types
// =============================================================================

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; username?: string; first_name?: string }
    chat: { id: number; type: string }
    text?: string
    date: number
    photo?: Array<{ file_id: string; width: number; height: number }>
    reply_to_message?: { message_id: number }
  }
  callback_query?: {
    id: string
    from: { id: number; username?: string; first_name?: string }
    message?: { message_id: number; chat: { id: number } }
    data?: string
  }
}

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

  return {
    sent,
    edited,
    answered,
    photos,
    videos,
    mediaGroups,
    reactions,
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

  // Active context state: present means a flow is running for this user
  const activeContexts = new Map<string, FlowContext>()

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
      identity: AuctorKey,
      initialCtx?: unknown
    ) => {
      calls.push({ method: 'enter', args: [intent, platform, userId, identity, initialCtx] })
      const ctx: FlowContext = {
        intent,
        state: {},
        identity,
        platform,
        platformUserId: userId,
      }
      activeContexts.set(`${platform}:${userId}`, ctx)
      // Simulate router immediately emitting a step (empty primitives)
      stepCb?.(ctx, { primitives: [] })
    },

    handle: async (platform: Platform, userId: string, event: PrimitiveEvent) => {
      calls.push({ method: 'handle', args: [platform, userId, event] })
      const ctx = activeContexts.get(`${platform}:${userId}`)
      if (ctx) {
        stepCb?.(ctx, { primitives: [] })
      }
    },

    clear: (platform: Platform, userId: string) => {
      calls.push({ method: 'clear', args: [platform, userId] })
      activeContexts.delete(`${platform}:${userId}`)
    },

    hasContext: (platform: Platform, userId: string) =>
      activeContexts.has(`${platform}:${userId}`),

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
function makeAllocutio(opts: { botStartupTime?: number; withPodControls?: boolean; autoSettleMs?: number } = {}) {
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
    id: 'actum-1', modusId: 'runmake.flux-schnell', modusVersiono: '1', impetus: 0n,
    signaConsumed: [], aditus: { input_seed: 4242 }, status: 'completus', inceptum: new Date(),
    expirat: new Date(), duratio: 12000,
    executio: { coldStart: false, executionMs: 9000, gpuType: 'RTX 4090', costPerHr: 0.69, modelsReused: 4, modelsDownloaded: 0 },
  }
  const acta = { async findById(_id: string) { return fakeActum as unknown as import('../../../src/types/actum.js').Actum } }

  const allocutio = new TelegramAllocutio({
    router: router as unknown as import('../../../src/allocutio/TelegramAllocutio.js').RouterDeps,
    sender,
    identity,
    botStartupTime: opts.botStartupTime,
    ...(opts.autoSettleMs !== undefined ? { autoSettleMs: opts.autoSettleMs } : {}),
    acta,
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

// 1. /run command → calls FlowRouter.enter('execute', ...) with correct platform/userId
test('/run command calls router.enter with execute intent', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/run'))

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
  await allocutio.receive(msgUpdate(123, 456, '/run'))
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
  await allocutio.receive(msgUpdate(123, 456, '/run'))

  await allocutio.receive(msgUpdate(123, 456, 'hello world'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[2] as PrimitiveEvent
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
  await allocutio.receive(msgUpdate(123, 456, '/run'))

  // Get the flow context that was created
  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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
  await allocutio.receive(msgUpdate(123, 456, '/run'))
  router.calls.length = 0

  await allocutio.receive(cbUpdate(123, 456, 's:opt-42'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[2] as PrimitiveEvent
  assert.equal(event.kind, 'select')
  assert.equal((event as { kind: 'select'; selectedId: string }).selectedId, 'opt-42')
})

// 9. callback_query with cy → fires { kind: 'confirm', confirmed: true } to router
test('callback_query cy fires confirm true event to router', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/run'))
  router.calls.length = 0

  await allocutio.receive(cbUpdate(123, 456, 'cy'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[2] as PrimitiveEvent
  assert.equal(event.kind, 'confirm')
  assert.equal((event as { kind: 'confirm'; confirmed: boolean }).confirmed, true)
})

// 10. callback_query with pn → fires { kind: 'paginate', action: 'next' } to router
test('callback_query pn fires paginate next event to router', async () => {
  const { allocutio, router } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/run'))
  router.calls.length = 0

  await allocutio.receive(cbUpdate(123, 456, 'pn'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should have been called')
  const event = handleCall!.args[2] as PrimitiveEvent
  assert.equal(event.kind, 'paginate')
  assert.equal((event as { kind: 'paginate'; action: string }).action, 'next')
})

// 11. Stream primitive with status 'running' and a stored command message → reacts 👌, sends nothing
test('Stream primitive with running status reacts 👌 on command message when command message ID is stored', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  // Send a /run command with a specific message ID — this stores the command message ID
  await allocutio.receive(msgUpdate(123, 456, '/run', 50))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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
test('Resolution abandon sends Cancelled. message', async () => {
  const { allocutio, router, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
  }

  sender.sent.length = 0
  router.triggerResolution(ctx, { kind: 'abandon' })
  await new Promise(r => setImmediate(r))

  assert.ok(sender.sent.length > 0, 'Should send a message on abandon')
  const msg = sender.sent[0]
  assert.equal(msg.text, 'Cancelled.', 'Should send exactly "Cancelled."')
})

// =============================================================================
// Phase 7a new tests
// =============================================================================

// 16. botStartupTime: stale message (date * 1000 < startupTime) is silently dropped
test('botStartupTime filters stale messages — no router call', async () => {
  const botStartupTime = Date.now()
  const { allocutio, router } = makeAllocutio({ botStartupTime })

  // message date is 5 minutes in the past (before startup)
  await allocutio.receive(staleMsgUpdate(123, 456, '/run', 300))

  const enterCall = router.calls.find(c => c.method === 'enter')
  assert.equal(enterCall, undefined, 'stale message should be dropped, router.enter should not be called')
})

// 17. botStartupTime: fresh message (date * 1000 >= startupTime) is processed
test('botStartupTime passes fresh messages through', async () => {
  const botStartupTime = Date.now() - 60_000  // startup was 1 min ago
  const { allocutio, router } = makeAllocutio({ botStartupTime })

  // message date is now (after startup)
  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const enterCall = router.calls.find(c => c.method === 'enter')
  assert.ok(enterCall, 'fresh message should be processed')
})

// 18. Photo message while flow active → router.handle called with { kind: 'prompt', text: '<url>' }
test('photo message while flow active fires prompt with file url', async () => {
  const { allocutio, router } = makeAllocutio()

  // Enter a flow first
  await allocutio.receive(msgUpdate(123, 456, '/run'))
  router.calls.length = 0

  // Send a photo
  await allocutio.receive(photoMsgUpdate(123, 456, ['file-id-small', 'file-id-large']))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should be called for photo with active flow')
  const event = handleCall!.args[2] as { kind: string; text: string }
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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

  await allocutio.receive(msgUpdate(123, 456, '/run'))

  const ctx: FlowContext = {
    intent: 'execute',
    state: {},
    identity: { animaId: 'test-anima' },
    platform: 'telegram',
    platformUserId: '123',
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
  await allocutio.receive(msgUpdate(123, 456, '/run'))
  router.calls.length = 0

  // Send plain text while flow is active (simulates RESULT state)
  await allocutio.receive(msgUpdate(123, 456, 'follow up question'))

  const handleCall = router.calls.find(c => c.method === 'handle')
  assert.ok(handleCall, 'router.handle should be called with prompt event')
  const event = handleCall!.args[2] as { kind: string; text: string }
  assert.equal(event.kind, 'prompt', 'event kind should be prompt')
  assert.equal(event.text, 'follow up question', 'event text should match message text')
})

// 23. _react called with 🤔 on command receipt
test('_react called with 🤔 emoji on command receipt', async () => {
  const { allocutio, sender } = makeAllocutio()

  await allocutio.receive(msgUpdate(123, 456, '/run', 77))

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
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-c', status: 'running' }] })
  await new Promise(r => setImmediate(r))
  bus.emit('actum.stage', { actumId: 'actum-c', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1' } })
  await new Promise(r => setImmediate(r))

  sender.sent.length = 0
  bus.emit('actum.complete', { actumId: 'actum-c', durationMs: 13000, coldStart: false, costUsd: 0.01, podId: 'pod-1' } as unknown as Parameters<typeof bus.emit>[1])
  await new Promise(r => setTimeout(r, 150))

  assert.equal(sender.sent.length, 0, 'should not send a "Done in" concierge message')
  assert.ok(materiaUpdates.some(u => (u.patch as { warmUntil?: Date }).warmUntil), 'warm window should still be applied')
})

test('warm-pod-found stage reacts 🔥 on the command message', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-w', status: 'running' }] })
  await new Promise(r => setImmediate(r))
  bus.emit('actum.stage', { actumId: 'actum-w', stage: 'warm-pod-found', elapsedMs: 0 })
  // warm-pod-found cancels the deferred 👌 and reacts 🔥 (~500ms). Wait past both the
  // 🔥 delay and the 👌 deadline (800ms) to prove 👌 never fired.
  await new Promise(r => setTimeout(r, 900))
  assert.ok(sender.reactions.some(r => r.emoji === '🔥' && r.messageId === 50), 'should react 🔥 for a warm pod')
  assert.ok(!sender.reactions.some(r => r.emoji === '👌'), 'a warm run must never flash 👌')
})

test('progress:N/M stage does not create a standalone generating message', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId: 'actum-p', status: 'running' }] })
  await new Promise(r => setImmediate(r))
  sender.sent.length = 0
  bus.emit('actum.stage', { actumId: 'actum-p', stage: 'progress:1/4', elapsedMs: 4000 })
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
const flowCtx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' }
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
    ['dm:back:actum-1', 'dm:tweak:actum-1', 'dm:rerun:actum-1'])
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
  assert.equal(((enter!.args[4] as { state: { modusId: string } }).state.modusId), 'runmake.flux-schnell')
})

// =============================================================================
// Warm 🔥 survives the race (warm-pod-found arrives before actum registration)
// =============================================================================
test('warm signal arriving before registration still reacts 🔥 (not 👌)', async () => {
  const { allocutio, router, sender } = makeAllocutio()
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))

  // Warm signal fires FIRST (WarmPodClient emits it inside submit, pre-Stream)
  bus.emit('actum.stage', { actumId: 'actum-warm', stage: 'warm-pod-found', elapsedMs: 0, info: { podId: 'pod-9' } })
  await new Promise(r => setImmediate(r))

  // Then the flow yields the Stream primitive → registration. Because the warm
  // signal already arrived (pendingWarm), registration goes straight to 🔥 and
  // never schedules the deferred 👌.
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' }
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
  const ctx: FlowContext = { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' }
  router.triggerStep(ctx, { primitives: [{ kind: 'Stream', label: 'g', actumId, status: 'running' }] })
}

test('pod-locked creates the session bulletin with the warm stepper + confirm', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  bus.emit('actum.stage', { actumId: 'a1', stage: 'provisioning', elapsedMs: 0 })
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 } })
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
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } })
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
  bus.emit('actum.stage', { actumId: 'a1', stage: 'provisioning', elapsedMs: 0 })
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 } })
  await new Promise(r => setImmediate(r))

  // Close the session → receipt frozen.
  bus.emit('pod.reaped', { externusId: 'pod-1' })
  await new Promise(r => setImmediate(r))
  const receiptMsgId = sender.edited.at(-1)!.messageId
  const editsBefore = sender.edited.length
  const sentBefore = sender.sent.length   // don't reset (the mock derives ids from length)

  // A new generation on a new pod must post a NEW bulletin, not edit the receipt.
  router.triggerStep(
    { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' } as FlowContext,
    { primitives: [{ kind: 'Stream', label: 'g', actumId: 'a2', status: 'running' }] },
  )
  await new Promise(r => setImmediate(r))
  bus.emit('actum.stage', { actumId: 'a2', stage: 'provisioning', elapsedMs: 0 })
  bus.emit('actum.stage', { actumId: 'a2', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-2', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 } })
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
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } })
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
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } })
  await new Promise(r => setImmediate(r))
  sender.edited.length = 0
  bus.emit('actum.complete', { actumId: 'a1', durationMs: 12000, coldStart: true, costUsd: 0.09, podId: 'pod-1' } as unknown as Parameters<typeof bus.emit>[1])
  await new Promise(r => setImmediate(r))
  const txt = sender.edited.map(m => m.text).join('\n')
  assert.match(txt, /1 gen/, 'bulletin shows the session gen count')
})

test('cold-start journal: silent hunt, committed Found/Prepared lines, live line', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  router.triggerStep(
    { intent: 'execute', state: {}, identity: { animaId: 'a' }, platform: 'telegram', platformUserId: '123' } as FlowContext,
    { primitives: [{ kind: 'Stream', label: 'g', actumId: 'a1', status: 'running' }] },
  )
  await new Promise(r => setImmediate(r))

  const textAfter = async (stage: string, info?: object) => {
    sender.sent.length = 0; sender.edited.length = 0
    bus.emit('actum.stage', { actumId: 'a1', stage, elapsedMs: 0, ...(info ? { info } : {}) } as unknown as Parameters<typeof bus.emit>[1])
    await new Promise(r => setImmediate(r))
    return [...sender.sent, ...sender.edited].map(m => m.text).at(-1) ?? ''
  }

  // Hunt is silent unless it drags — provisioning shows no "Hunting" line yet.
  const prov = await textAfter('provisioning')
  assert.ok(!/Hunting/.test(prov), 'fast hunt stays quiet')
  // pod-locked commits the Found line (with the synthetic 30s hunt) + live Initializing.
  const locked = await textAfter('pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  assert.match(locked, /Found RTX 4090 for \$0\.69\/hr in 30s/)
  assert.match(locked, /Initializing/)
  // download → connected live line; the Found line persists above it.
  const dl = await textAfter('downloading:3/4')
  assert.match(dl, /Found RTX 4090 for \$0\.69\/hr in 30s/)
  assert.match(dl, /Connected, downloading models \(3\/4\)/)
  // comfy-ready commits the Prepared line (4.5m) + live Generating.
  const ready = await textAfter('comfy-ready', { phaseMs: 4.5 * 60_000 })
  assert.match(ready, /Prepared Make Setup in 4\.5m/)
  assert.match(ready, /Generating/)
})

test('bail erases the Found line, records a permanent Quit-pod meta line', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  bus.emit('actum.stage', { actumId: 'a1', stage: 'provisioning', elapsedMs: 0 })
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 } })
  await new Promise(r => setImmediate(r))
  sender.edited.length = 0
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-bailed', elapsedMs: 0 })
  await new Promise(r => setImmediate(r))

  const txt = sender.edited.at(-1)!.text
  assert.ok(!/Found RTX 4090/.test(txt), 'the bailed pod\'s Found line is erased')
  assert.match(txt, /Quit pod 1 for download throttle/, 'a permanent meta line records the bail')
})

test('per-gen average falls across gens and the idle nudge shows marginal cost', async () => {
  const { allocutio, router, sender } = makeAllocutio({ withPodControls: true })
  await allocutio.receive(msgUpdate(123, 456, '/make', 50))
  lockPod(allocutio, router, 'a1')
  await new Promise(r => setImmediate(r))
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 } })
  await new Promise(r => setImmediate(r))
  await allocutio.receive(bulCb(123, 'bul:confirm'))  // confirm → idle nudge, not setup prompt
  await new Promise(r => setImmediate(r))

  bus.emit('actum.complete', { actumId: 'a1', durationMs: 12000, executionMs: 12000, costUsd: 0.08, podId: 'pod-1' } as unknown as Parameters<typeof bus.emit>[1])
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
  bus.emit('actum.stage', { actumId: 'a1', stage: 'provisioning', elapsedMs: 0 })
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'NVIDIA GeForce RTX 4090', region: 'EU-RO-1', costPerHr: 0.69, phaseMs: 30_000 } })
  await new Promise(r => setImmediate(r))
  bus.emit('actum.complete', { actumId: 'a1', durationMs: 12000, executionMs: 12000, coldStart: true, costUsd: 0.08, podId: 'pod-1' } as unknown as Parameters<typeof bus.emit>[1])
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
  bus.emit('actum.stage', { actumId: 'a1', stage: 'pod-locked', elapsedMs: 0, info: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } })
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
  assert.ok(btns.includes('bul:kill') && !btns.includes('bul:confirm'), 'auto-settle flips to the confirmed control row')
})
