/**
 * Telegram start seam.
 *
 * The Telegram integration is one delivery surface among several (HTTP API, web app, publication
 * worker, reapers, census). Starting it must therefore be:
 *
 *   1. NON-FATAL   — it returns a result, it never throws. A chat integration that cannot start
 *                    must not be able to take down a process that has already bound its port.
 *   2. BOUNDED     — every Telegram call is raced against a timeout. Catching an error is not the
 *                    same as bounding a call: an awaited call that neither resolves nor rejects
 *                    stalls everything after it for as long as the remote takes to give up.
 *   3. NON-BLOCKING on polling — `Telegraf#launch()` in polling mode awaits `startPolling()`, whose
 *                    promise settles only when the bot STOPS. Awaiting it to completion would mean
 *                    nothing after the call ever runs. We start it, watch a short window for a
 *                    fast failure (auth and connectivity failures surface in `getMe()`, the first
 *                    thing `launch()` does), and return while it keeps running.
 *
 * POLICY — every start failure degrades; none of them is fatal.
 *
 * A rejected credential and a transient network error are handled the same way, deliberately. The
 * argument for failing fast on a transient error is that the restart policy would retry into a
 * healthy state; the argument against is decisive here — a restart tears down the HTTP server, the
 * API and the workers, none of which depend on Telegram, in order to retry an optional integration
 * that the caller already retries at the polling layer. One predictable policy also means the
 * operator reads one log line at 3am rather than deducing which error class the process considered
 * fatal. Degrade, log what is degraded and what still works, carry on.
 */

export interface BotCommandSpec {
  command: string
  description: string
}

/** Structural view of the bot. Deliberately not `Telegraf`, so a fake can satisfy it in tests. */
export interface TelegramStartable {
  telegram: {
    setMyCommands(commands: BotCommandSpec[]): Promise<unknown>
    setWebhook(url: string): Promise<unknown>
  }
  // `Telegraf#launch` is overloaded on a leading callback; accepting that shape here is what lets a
  // real bot satisfy this interface structurally. Only the config form is used.
  launch(config?: { allowedUpdates: string[] } | (() => void), onLaunch?: () => void): Promise<unknown>
  webhookCallback(path: string): unknown
  catch(handler: (err: unknown) => void): unknown
}

export interface StartLogger {
  info(msg: string, fields?: Record<string, unknown>): void
  warn(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

/** Minimal express surface used here — `app.use(bot.webhookCallback(path))`. */
export interface WebhookMountable {
  use(handler: unknown): unknown
}

export interface StartTelegramOptions {
  bot: TelegramStartable
  commands: BotCommandSpec[]
  log: StartLogger
  /** Absent/empty → long polling. Present → webhook mode. */
  webhookUrl?: string
  /** Required in webhook mode, to mount the callback. */
  app?: WebhookMountable
  /** Bound on a single Telegram API round trip (command registration, setWebhook). */
  callTimeoutMs?: number
  /**
   * How long to watch a started polling loop for a fast failure before reporting it started.
   * `launch()` resolves only when polling stops, so this window — not the promise — is what
   * distinguishes "started" from "failed to start".
   */
  pollingProbeMs?: number
}

export type TelegramStartResult = {
  /** How updates are being received. `degraded` = they are not. */
  mode: 'polling' | 'webhook' | 'degraded'
  /** False when command registration failed or timed out. The bot still runs. */
  commandsRegistered: boolean
  /** Present when something degraded — the start failure, or the command-registration failure. */
  error?: string
}

export const DEFAULT_CALL_TIMEOUT_MS = 10_000
export const DEFAULT_POLLING_PROBE_MS = 8_000

class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not settle within ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Race a promise against a timer. The timer is unref'd so a pending Telegram call can never hold
 * the event loop open, and it is always cleared so a fast call leaves nothing behind.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer: NodeJS.Timeout | number = setTimeout(() => reject(new TimeoutError(label, ms)), ms)
    ;(timer as NodeJS.Timeout).unref?.()
    p.then(
      v => { clearTimeout(timer as NodeJS.Timeout); resolve(v) },
      e => { clearTimeout(timer as NodeJS.Timeout); reject(e) },
    )
  })
}

const PENDING = Symbol('pending')

/** Resolve to PENDING after `ms`, without holding the event loop open. */
function pendingAfter(ms: number): Promise<typeof PENDING> {
  return new Promise(resolve => {
    const timer: NodeJS.Timeout | number = setTimeout(() => resolve(PENDING), ms)
    ;(timer as NodeJS.Timeout).unref?.()
  })
}

function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

/**
 * Register commands and start Telegram. Never throws; always returns a result.
 *
 * The caller logs on `degraded`; this function logs the detail it alone has.
 */
export async function startTelegram(opts: StartTelegramOptions): Promise<TelegramStartResult> {
  const {
    bot,
    commands,
    log,
    webhookUrl,
    app,
    callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
    pollingProbeMs = DEFAULT_POLLING_PROBE_MS,
  } = opts

  // --- Command registration. Bounded, non-fatal, and only claimed when it actually succeeded. ---
  let commandsRegistered = false
  let commandsError: string | undefined
  try {
    await withTimeout(
      Promise.resolve(bot.telegram.setMyCommands(commands)),
      callTimeoutMs,
      'setMyCommands',
    )
    commandsRegistered = true
    log.info('Bot commands registered', { count: commands.length })
  } catch (e: unknown) {
    commandsError = describe(e)
    log.warn('Failed to register bot commands — existing command list left in place', {
      error: commandsError,
    })
  }

  // --- Start. ---
  if (webhookUrl) {
    try {
      const hookUrl = `${webhookUrl}/telegram`
      await withTimeout(
        Promise.resolve(bot.telegram.setWebhook(hookUrl)),
        callTimeoutMs,
        'setWebhook',
      )
      if (!app) throw new Error('webhook mode requires an app to mount the callback on')
      app.use(bot.webhookCallback('/telegram'))
      log.info('Telegram webhook set', { url: hookUrl })
      return { mode: 'webhook', commandsRegistered, error: commandsError }
    } catch (e: unknown) {
      return { mode: 'degraded', commandsRegistered, error: describe(e) }
    }
  }

  // Polling. The error handler is attached BEFORE the launch: `launch()` does not resolve while
  // polling, so anything registered after it would never be registered at all.
  try {
    attachPollingErrorHandler(bot, log)
  } catch (e: unknown) {
    log.warn('Could not attach Telegram polling error handler', { error: describe(e) })
  }

  let launchError: unknown
  const launched = Promise.resolve(bot.launch({ allowedUpdates: ['message', 'callback_query'] }))
    .then(() => undefined)
    .catch((e: unknown) => { launchError = e; throw e })
  // The rejection is observed by the race below within the probe window; past it, keep it observed
  // so a late failure cannot become an unhandled rejection.
  launched.catch(() => {})

  const outcome = await Promise.race([
    launched.then(() => 'settled' as const).catch(() => 'failed' as const),
    pendingAfter(pollingProbeMs),
  ])

  if (outcome === 'failed') {
    return { mode: 'degraded', commandsRegistered, error: describe(launchError) }
  }

  // Either the probe window elapsed with the launch still pending (long polling, the normal case)
  // or the promise resolved. Both mean the start succeeded; only a rejection means it did not.
  log.info('Telegram polling started')
  return { mode: 'polling', commandsRegistered, error: commandsError }
}

/**
 * Post-start polling errors: a 409 means a concurrent instance is holding the update stream, and a
 * run of consecutive errors means the loop is wedged. Both are recovered by re-launching after a
 * back-off, and neither is fatal.
 */
function attachPollingErrorHandler(bot: TelegramStartable, log: StartLogger): void {
  let restartInProgress = false
  let consecutiveErrors = 0

  const relaunch = (delayMs: number, reason: string): void => {
    restartInProgress = true
    consecutiveErrors = 0
    const timer: NodeJS.Timeout | number = setTimeout(() => {
      restartInProgress = false
      Promise.resolve(bot.launch({ allowedUpdates: ['message', 'callback_query'] }))
        .catch((e: unknown) => log.error(`Bot failed restart after ${reason}`, { error: describe(e) }))
    }, delayMs)
    ;(timer as NodeJS.Timeout).unref?.()
  }

  bot.catch((err: unknown) => {
    const status = (err as { response?: { error_code?: number } })?.response?.error_code

    if (status === 409) {
      log.warn('Bot 409 conflict — concurrent instance. Backing off 50s.')
      if (!restartInProgress) relaunch(50_000, '409')
      return
    }

    consecutiveErrors++
    log.error(`Bot polling error (${consecutiveErrors})`, { error: describe(err) })

    if (consecutiveErrors >= 5 && !restartInProgress) relaunch(5_000, 'errors')
  })
}
