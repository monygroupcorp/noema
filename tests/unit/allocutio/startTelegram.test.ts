import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  startTelegram,
  type BotCommandSpec,
  type TelegramStartable,
  type StartLogger,
} from '../../../src/allocutio/telegram/startTelegram.js'

// =============================================================================
// Fakes
// =============================================================================

const COMMANDS: BotCommandSpec[] = [
  { command: 'make', description: 'Generate images and art' },
  { command: 'help', description: 'Show available commands' },
]

interface LoggedLine { level: 'info' | 'warn' | 'error'; msg: string; fields?: Record<string, unknown> }

function makeLog() {
  const lines: LoggedLine[] = []
  const log: StartLogger = {
    info: (msg, fields) => { lines.push({ level: 'info', msg, fields }) },
    warn: (msg, fields) => { lines.push({ level: 'warn', msg, fields }) },
    error: (msg, fields) => { lines.push({ level: 'error', msg, fields }) },
  }
  return {
    log,
    lines,
    has: (needle: string) => lines.some(l => l.msg.includes(needle)),
    find: (needle: string) => lines.find(l => l.msg.includes(needle)),
  }
}

const never = <T>(): Promise<T> => new Promise<T>(() => {})

interface FakeBotOptions {
  setMyCommands?: () => Promise<unknown>
  setWebhook?: () => Promise<unknown>
  launch?: () => Promise<unknown>
}

function makeBot(opts: FakeBotOptions = {}) {
  const calls: string[] = []
  let errorHandler: ((err: unknown) => void) | undefined
  const bot: TelegramStartable = {
    telegram: {
      setMyCommands: () => {
        calls.push('setMyCommands')
        return (opts.setMyCommands ?? (() => Promise.resolve(true)))()
      },
      setWebhook: () => {
        calls.push('setWebhook')
        return (opts.setWebhook ?? (() => Promise.resolve(true)))()
      },
    },
    launch: () => {
      calls.push('launch')
      return (opts.launch ?? (() => never<void>()))()
    },
    webhookCallback: (p: string) => { calls.push(`webhookCallback:${p}`); return () => {} },
    catch: (handler: (err: unknown) => void) => { errorHandler = handler; calls.push('catch'); return bot },
  }
  return { bot, calls, get errorHandler() { return errorHandler } }
}

/** A rejection shaped like Telegram's response to a revoked credential. */
function authError(): Error {
  const e = new Error('401: Unauthorized') as Error & { response: { error_code: number } }
  e.response = { error_code: 401 }
  return e
}

/** A rejection shaped like a transport failure — no Telegram response at all. */
function networkError(): Error {
  const e = new Error('request to https://api.telegram.org/ failed, reason: ECONNRESET')
  e.name = 'FetchError'
  return e
}

const FAST = { callTimeoutMs: 120, pollingProbeMs: 60 }

// =============================================================================
// 1. A failing Telegram start must not fail the process
// =============================================================================

test('a rejecting Telegram start does not reject startTelegram', async () => {
  const { bot } = makeBot({ launch: () => Promise.reject(authError()) })
  const { log } = makeLog()

  // The assertion is the absence of a throw: on the earlier ordering this rejection propagated to
  // the top-level catch and exited the process.
  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  assert.equal(result.mode, 'degraded')
  assert.match(String(result.error), /401/)
})

test('a rejecting webhook start does not reject startTelegram either', async () => {
  const { bot } = makeBot({ setWebhook: () => Promise.reject(authError()) })
  const { log } = makeLog()

  const result = await startTelegram({
    bot,
    commands: COMMANDS,
    log,
    webhookUrl: 'https://example.invalid',
    app: { use: () => undefined },
    ...FAST,
  })

  assert.equal(result.mode, 'degraded')
  assert.match(String(result.error), /401/)
})

test('a successful webhook start reports webhook mode and mounts the callback', async () => {
  const { bot, calls } = makeBot()
  const mounted: unknown[] = []
  const { log } = makeLog()

  const result = await startTelegram({
    bot,
    commands: COMMANDS,
    log,
    webhookUrl: 'https://example.invalid',
    app: { use: h => { mounted.push(h); return undefined } },
    ...FAST,
  })

  assert.equal(result.mode, 'webhook')
  assert.equal(mounted.length, 1)
  assert.ok(calls.includes('webhookCallback:/telegram'))
})

// =============================================================================
// 2. The success log must only be written on success
// =============================================================================

test('the commands-registered line is not logged when registration failed', async () => {
  const { bot } = makeBot({ setMyCommands: () => Promise.reject(new Error('nope')) })
  const { log, has } = makeLog()

  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  assert.equal(result.commandsRegistered, false)
  assert.ok(has('Failed to register bot commands'))
  assert.equal(has('Bot commands registered'), false)
})

test('the commands-registered line is logged when registration succeeded', async () => {
  const { bot } = makeBot()
  const { log, has, find } = makeLog()

  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  assert.equal(result.commandsRegistered, true)
  assert.ok(has('Bot commands registered'))
  assert.equal(find('Bot commands registered')?.fields?.count, COMMANDS.length)
  assert.equal(has('Failed to register bot commands'), false)
})

test('a command registration failure degrades registration only — the bot still starts', async () => {
  const { bot } = makeBot({ setMyCommands: () => Promise.reject(new Error('nope')) })
  const { log, has } = makeLog()

  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  assert.equal(result.mode, 'polling')
  assert.equal(result.commandsRegistered, false)
  assert.ok(has('Telegram polling started'))
})

// =============================================================================
// 3. Started and degraded are distinguishable outcomes
// =============================================================================

test('a launch that starts cleanly reports polling, not degraded', async () => {
  const { bot } = makeBot({ launch: () => Promise.resolve() })
  const { log, has } = makeLog()

  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  assert.equal(result.mode, 'polling')
  assert.equal(result.error, undefined)
  assert.ok(has('Telegram polling started'))
})

// =============================================================================
// 4. The policy: every start failure degrades, whatever its class
// =============================================================================

test('a non-auth start failure degrades on the same policy as an auth failure', async () => {
  const { bot } = makeBot({ launch: () => Promise.reject(networkError()) })
  const { log } = makeLog()

  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  // Deliberately identical handling: the rest of the process does not depend on Telegram, so
  // restarting it to retry an optional integration costs more than degrading does.
  assert.equal(result.mode, 'degraded')
  assert.match(String(result.error), /FetchError/)
})

// =============================================================================
// 5. Every Telegram call is bounded, not merely caught
// =============================================================================

test('a Telegram call that never settles does not stall startup', async () => {
  const { bot } = makeBot({ setMyCommands: () => never<unknown>() })
  const { log, has } = makeLog()

  const began = Date.now()
  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })
  const elapsed = Date.now() - began

  // The bound is the assertion. Without a timeout this call never returns at all; a test that only
  // asserted "it eventually returned" would pass against an arbitrarily long hang.
  assert.ok(
    elapsed < FAST.callTimeoutMs + FAST.pollingProbeMs + 500,
    `startTelegram took ${elapsed}ms — command registration was not bounded`,
  )
  assert.equal(result.commandsRegistered, false)
  assert.ok(has('Failed to register bot commands'))
  assert.equal(result.mode, 'polling')
})

test('a launch that never settles does not stall startup', async () => {
  const { bot } = makeBot({ launch: () => never<void>() })
  const { log } = makeLog()

  const began = Date.now()
  const result = await startTelegram({ bot, commands: COMMANDS, log, ...FAST })
  const elapsed = Date.now() - began

  assert.equal(result.mode, 'polling')
  assert.ok(
    elapsed < FAST.pollingProbeMs + 500,
    `startTelegram took ${elapsed}ms — the polling start was awaited to completion`,
  )
})

test('the polling error handler is attached before the launch, not after it', async () => {
  const { bot, calls } = makeBot({ launch: () => never<void>() })
  const { log } = makeLog()

  await startTelegram({ bot, commands: COMMANDS, log, ...FAST })

  // `launch()` does not settle while the bot polls, so anything registered after it is never
  // registered at all.
  assert.ok(calls.indexOf('catch') >= 0, 'no error handler was attached')
  assert.ok(calls.indexOf('catch') < calls.indexOf('launch'))
})

// =============================================================================
// 6. Shutdown is wired before the bot is started — independent of everything above
// =============================================================================

test('the signal handlers are registered ahead of the Telegram start in the boot sequence', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const indexPath = path.join(here, '..', '..', '..', 'src', 'index.ts')
  const src = readFileSync(indexPath, 'utf8')

  const sigint = src.indexOf("process.once('SIGINT'")
  const sigterm = src.indexOf("process.once('SIGTERM'")
  const listen = src.indexOf('app.listen(PORT')
  const start = src.indexOf('await startTelegram(')

  assert.ok(sigint > 0 && sigterm > 0 && listen > 0 && start > 0, 'boot sequence markers not found')

  // The Telegram polling start returns a promise that does not settle while the bot is running, so
  // a handler registered after it is never registered: SIGTERM would fall through to the default
  // disposition, leaving warm compute pods running and the database connection open.
  assert.ok(sigterm < start, 'SIGTERM handler must be registered before Telegram is started')
  assert.ok(sigint < start, 'SIGINT handler must be registered before Telegram is started')
  assert.ok(listen < sigterm, 'signal handlers should be registered once the server is listening')
})
