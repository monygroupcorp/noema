/**
 * Telegram Platform Adapter
 * 
 * Main entry point for the Telegram bot implementation.
 * This file sets up the bot, initializes the dispatchers, and registers all feature handlers.
 *
 * Canonical Dependency Injection Pattern:
 * - All handlers and managers receive the full `dependencies` object.
 * - All internal API calls must use `dependencies.services.internal.client`.
 * - There should be no top-level `internalApiClient` in dependencies.
 */

const TelegramBot = require('node-telegram-bot-api');

// --- Refactored Imports ---
const { CallbackQueryDispatcher, MessageReplyDispatcher, CommandDispatcher, DynamicCommandDispatcher } = require('./dispatcher');
const replyContextManager = require('./utils/replyContextManager.js');
const { ensureCleanKeyboard } = require('./utils/keyboardContextManager');

// Import all feature managers
const settingsMenuManager = require('./components/settingsMenuManager');
const modsMenuManager = require('./components/modsMenuManager');
const spellMenuManager = require('./components/spellMenuManager');
const trainingMenuManager = require('./components/trainingMenuManager');
const collectionMenuManager = require('./components/collectionMenuManager');
const adminManager = require('./components/adminManager');
const dashboardMenuManager = require('./components/dashboardMenuManager');
const walletManager = require('./components/walletManager');
const buyPointsManager = require('./components/buyPointsManager');
const toolsMenuManager = require('./components/toolsMenuManager');
const groupMenuManager = require('./components/groupMenuManager');
// Delivery Menu Managers
const globalMenuManager = require('./components/deliveryMenu/globalMenuManager');
const infoManager = require('./components/deliveryMenu/infoManager');
const rateManager = require('./components/deliveryMenu/rateManager');
const rerunManager = require('./components/deliveryMenu/rerunManager');
const tweakManager = require('./components/deliveryMenu/tweakManager');
// Simple Command Handlers
const createStatusCommandHandler = require('./commands/statusCommand');
const { handleBatchMediaSync } = require('./commands/batchCommand');

/**
 * Create and configure the Telegram bot
 * @param {Object} dependencies - Injected dependencies
 * @param {string} token - Telegram bot token
 * @param {Object} options - Bot configuration options
 * @returns {Object} - Configured bot instance
 */
function createTelegramBot(dependencies, token, options = {}) {
  const { logger = console, commandRegistry } = dependencies;

  const bot = new TelegramBot(token, {
    polling: options.polling !== false,
    ...options
  });
  const botStartupTime = Date.now();

  // --- Initialize Dispatchers ---
  const callbackQueryDispatcher = new CallbackQueryDispatcher(logger);
  const messageReplyDispatcher = new MessageReplyDispatcher(logger);
  const commandDispatcher = new CommandDispatcher(logger);
  const dynamicCommandDispatcher = new DynamicCommandDispatcher(commandRegistry, logger);

  // --- Register All Handlers ---
  function registerAllHandlers() {
    const dispatcherInstances = { callbackQueryDispatcher, messageReplyDispatcher, commandDispatcher, dynamicCommandDispatcher };
    const allDependencies = { ...dependencies, bot, replyContextManager };

    const { disabledFeatures = {} } = dependencies;

    // Register component managers conditionally based on feature toggles
    settingsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    modsMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    toolsMenuManager.registerHandlers(dispatcherInstances, allDependencies);

    if (!disabledFeatures.spells) {
      spellMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    }
    if (!disabledFeatures.train) {
      trainingMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    }

    collectionMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    adminManager.registerHandlers(dispatcherInstances, allDependencies);
    dashboardMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    walletManager.registerHandlers(dispatcherInstances, allDependencies);
    
    // Register platform linking handlers
    const linkManager = require('./components/linkManager');
    linkManager.registerHandlers(dispatcherInstances, allDependencies);
    buyPointsManager.registerHandlers(dispatcherInstances, allDependencies);

    groupMenuManager.registerHandlers(dispatcherInstances, allDependencies);

    // Register delivery menu managers
    globalMenuManager.registerHandlers(dispatcherInstances, allDependencies);
    infoManager.registerHandlers(dispatcherInstances, allDependencies);
    rateManager.registerHandlers(dispatcherInstances, allDependencies);
    rerunManager.registerHandlers(dispatcherInstances, allDependencies);
    tweakManager.registerHandlers(dispatcherInstances, allDependencies);

    // Register simple, stateless command handlers
    const handleStatusCommand = createStatusCommandHandler(allDependencies);
    commandDispatcher.register(/^\/status(?:@\w+)?/i, handleStatusCommand);

    logger.debug('[Bot] All feature handlers registered with dispatchers.');
  }

  registerAllHandlers();

  const canonicalCommands = [
    { command: 'account', description: 'Manage your account' },
    { command: 'status', description: 'View your status' },
    { command: 'settings', description: 'Configure preferences' },
    { command: 'tools', description: 'Utilities & extras' }
  ];
  bot.setMyCommands(canonicalCommands, { scope: { type: 'all_private_chats' } }).catch(console.error);

  // --- Refactored Event Handlers ---

  bot.on('callback_query', async (callbackQuery) => {
    try {
      await callbackQueryDispatcher.handle(bot, callbackQuery, { ...dependencies, replyContextManager });
    } catch (error) {
      logger.error(`Unhandled error in callback_query dispatcher: ${error.stack}`);
      if (!callbackQuery.answered) {
        try { await bot.answerCallbackQuery(callbackQuery.id, { text: "Sorry, a critical error occurred.", show_alert: true }); }
        catch (e) { logger.error("[Bot CB] Critical: Failed to answer callback query in error path:", e.stack); }
      }
    }
  });

  bot.on('photo', async (message) => {
    try {
      // Synchronously accumulate batch album photos BEFORE any async work.
      // This must run even for captionless photos so all album members are captured.
      if (message.media_group_id) handleBatchMediaSync(message);

      if (!message.caption) return;

      if (message.date * 1000 < botStartupTime) {
        logger.debug(`[Bot] Ignoring pre-startup photo message`);
        return;
      }

      const fullDependencies = { ...dependencies, replyContextManager };

      // CLEAN KEYBOARD FOR PHOTOS
      await ensureCleanKeyboard(bot, message, fullDependencies);

      // Check for replies with a specific context first
      if (message.reply_to_message) {
        const context = replyContextManager.getContext(message.reply_to_message);
        if (context) {
            const handled = await messageReplyDispatcher.handle(bot, message, context, fullDependencies);
            if (handled) {
                replyContextManager.removeContext(message.reply_to_message);
                return;
            }
        }
      }

      // Check for explicit commands (e.g. /status)
      if (message.caption.startsWith('/')) {
        const handled = await commandDispatcher.handle(bot, message, fullDependencies);
        if (handled) return;
      }

      // If no other handler has returned, treat as a potential dynamic command
      const dynamicHandled = await dynamicCommandDispatcher.handle(bot, message, fullDependencies);
      if (dynamicHandled) return;

    } catch (error) {
        logger.error(`[Bot] Error processing message: ${error.stack}`);
        await bot.sendMessage(message.chat.id, "Sorry, an unexpected error occurred.", { reply_to_message_id: message.message_id });
    }
  });

  // Handle image files (documents) sent as albums with /batch caption
  bot.on('document', async (message) => {
    try {
      // Synchronously accumulate batch album documents BEFORE any async work.
      // Runs even for captionless docs so all album members are captured.
      if (message.media_group_id && message.document?.mime_type?.startsWith('image/')) {
        handleBatchMediaSync(message);
      }

      if (!message.caption) return;

      if (message.date * 1000 < botStartupTime) return;

      const fullDependencies = { ...dependencies, replyContextManager };

      if (message.caption.startsWith('/')) {
        const handled = await commandDispatcher.handle(bot, message, fullDependencies);
        if (handled) return;
      }

      const dynamicHandled = await dynamicCommandDispatcher.handle(bot, message, fullDependencies);
      if (dynamicHandled) return;
    } catch (error) {
      logger.error(`[Bot] Error processing document message: ${error.stack}`);
    }
  });

  bot.on('message', async (message) => {
    try {
      if (!message.text) return;

      if (message.date * 1000 < botStartupTime) {
        logger.debug(`[Bot] Ignoring pre-startup message`);
        return;
      }

      const fullDependencies = { ...dependencies, replyContextManager };

      // CLEAN KEYBOARD FOR TEXT MESSAGES
      await ensureCleanKeyboard(bot, message, fullDependencies);

      // Check for replies with a specific context first
      if (message.reply_to_message) {
        const context = replyContextManager.getContext(message.reply_to_message);
        if (context) {
            const handled = await messageReplyDispatcher.handle(bot, message, context, fullDependencies);
            if (handled) {
                replyContextManager.removeContext(message.reply_to_message);
                return;
            }
        }
      }

      // Check for explicit commands (e.g. /status)
      if (message.text.startsWith('/')) {
        const handled = await commandDispatcher.handle(bot, message, fullDependencies);
        if (handled) return;
      }

      // If no other handler has returned, treat as a potential dynamic command
      const dynamicHandled = await dynamicCommandDispatcher.handle(bot, message, fullDependencies);
      if (dynamicHandled) return;

    } catch (error) {
        logger.error(`[Bot] Error processing message: ${error.stack}`);
        await bot.sendMessage(message.chat.id, "Sorry, an unexpected error occurred.", { reply_to_message_id: message.message_id });
    }
  });

  // Polling watchdog: restart bot client after 5 consecutive polling errors.
  // 409 Conflict errors (two instances polling same token during blue-green deploy) are
  // handled separately — they require a long backoff, not rapid cycling.
  let consecutivePollingErrors = 0;
  let pollingRestartInProgress = false;

  function restartPollingAfter(delayMs, reason) {
    if (pollingRestartInProgress) return;
    pollingRestartInProgress = true;
    consecutivePollingErrors = 0;
    // Timeout stopPolling at 12s — node-telegram-bot-api can hang here;
    // if it does we must not leave pollingRestartInProgress stuck forever.
    Promise.race([
      bot.stopPolling(),
      new Promise(resolve => setTimeout(resolve, 12000))
    ]).then(() => {
      setTimeout(() => {
        pollingRestartInProgress = false;
        bot.startPolling().then(() => {
          logger.info(`[Bot] Polling restarted after ${reason}.`);
        }).catch(err => logger.error('[Bot] Failed to restart polling:', err));
      }, delayMs);
    }).catch(err => {
      pollingRestartInProgress = false;
      logger.error('[Bot] Failed to stop polling before restart:', err);
    });
  }

  bot.on('polling_error', (error) => {
    const statusCode = error?.response?.statusCode;

    if (statusCode === 409) {
      // 409 = another instance is polling the same token (expected during blue-green deploy).
      // Wait 50s (> 35s stop timeout + health check buffer) so the old container has time to fully stop.
      logger.warn('[Bot] Telegram 409 conflict — concurrent instance detected (blue-green deploy?). Backing off 50s...');
      restartPollingAfter(50000, '409 conflict backoff');
      return;
    }

    consecutivePollingErrors++;
    logger.error(`Telegram polling error (${consecutivePollingErrors} consecutive):`, error);
    if (consecutivePollingErrors >= 5) {
      logger.error('[Bot] 5 consecutive polling errors — restarting polling...');
      restartPollingAfter(5000, '5 consecutive errors');
    }
  });

  // Verify token and connectivity at startup
  bot.getMe().then(me => {
    logger.info(`[Bot] Polling active. Bot identity confirmed: @${me.username} (id=${me.id})`);
  }).catch(err => {
    logger.error(`[Bot] CRITICAL: getMe() failed at startup — token invalid or Telegram unreachable: ${err.message}`);
  });

  logger.debug('Telegram bot configured and ready with dispatcher architecture.');
  
  return bot;
}

module.exports = createTelegramBot;