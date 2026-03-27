/**
 * StationThis Bot - Entry Point
 *
 * This file serves as the entry point for the application.
 */

// Load environment variables FIRST before any other imports
require('dotenv').config();

//const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
let uuidv4;
try {
  ({ v4: uuidv4 } = require('uuid')); // Prefer external lib when available
} catch (err) {
  console.warn('[app] uuid package not found, falling back to crypto.randomUUID');
  uuidv4 = () => randomUUID();
}

// Store application start time
const APP_START_TIME = new Date();

// Import our custom logger
const { createLogger } = require('./src/utils/logger');
const logger = createLogger('app'); // Create a logger for app.js

// Import refactored components
const { initializeDatabase } = require('./src/core/initDB'); // Uses getCachedClient() to ping database and create a connection;
const { initializeServices } = require('./src/core/services'); // Initializes all services
const { initializePlatforms } = require('./src/platforms');
const { initialize } = require('./src/core/initialization');

// Import our new WebSocketService singleton
const websocketServer = require('./src/core/services/websocket/server.js');

// Import new services for notification dispatching
const NotificationDispatcher = require('./src/core/services/notificationDispatcher');
const TelegramNotifier = require('./src/platforms/telegram/telegramNotifier');
const WebSandboxNotifier = require('./src/platforms/web/webSandboxNotifier');
const WebhookNotifier = require('./src/platforms/webhook/webhookNotifier');

// geniusoverhaul: Import ToolRegistry
const { ToolRegistry } = require('./src/core/tools/ToolRegistry.js');
// Note: CommandRegistry is no longer imported here - each platform creates its own instance

/**
 * Initialize and start the refactored application
 */
async function startApp() {
  try {
    logger.debug('===| Initializing StationThis Bot Application |====');
    // Initialize Database Connection FIRST
    logger.info('[app] calling initializeDatabase...');
    await initializeDatabase();
    logger.info('[app] initializeDatabase done');
    
    // Initialize core services, passing the WebSocketService instance
    const exportProcessingEnabled = process.env.COLLECTION_EXPORT_PROCESSING_ENABLED !== 'false';
    logger.info('[app] calling initializeServices...');
    const services = await initializeServices({
      logger: logger,
      webSocketService: websocketServer,
      collectionExportProcessingEnabled: exportProcessingEnabled
    });
    logger.info('[app] initializeServices returned');
    _services = services; // Store for graceful shutdown
    // _platforms assigned after initializePlatforms below
    /*
    ] [app]: services (shallow): {
      "session": "object",
      "media": "object",
      "points": "object",
      "comfyUI": "object",
      "workflows": "object",
      "openai": "object",
      "db": "object",
      "internal": "object",
      "internalApiClient": "undefined",
      "userSettingsService": "object",
      "spellsService": "object",
      "workflowExecutionService": "object",
      "logger": "object",
      "appStartTime": "object",
      "toolRegistry": "object"
    }
    */

    // Explicitly initialize WorkflowsService and wait for it
    if (services.workflows && typeof services.workflows.initialize === 'function') {
      logger.debug('Initializing WorkflowsService cache in background...');
      services.workflows.initialize().catch(err => logger.error('Background workflow cache init failed', err));
    } else {
      logger.warn('WorkflowsService not found or does not have an initialize method.');
    }

    // Debug log to verify internal services are available
    logger.debug('DEBUG: Internal API services available:', {
      internalAvailable: services.internal ? 'Yes' : 'No',
      statusService: services.internal?.status ? 'Status service OK' : 'Status service missing'
    });
    
    // Run system initialization
    logger.debug('Starting system initialization sequence...');
    const initResults = await initialize(services, logger); // Pass logger here too
    
    // Log initialization results
    if (initResults.status === 'success') {
      logger.info('Initialization Results: SUCCESS');
    } else if (initResults.status === 'partial') {
      logger.warn('Initialization Results: PARTIAL - Some components failed to initialize');
      logger.warn('Error:', initResults.error);
    } else {
      logger.error('Initialization Results: FAILED');
      logger.error('Error:', initResults.error);
    }
    
    // Create the canonical dependencies object as defined in ADR-001
    // Note: commandRegistry is NOT shared - each platform creates its own instance
    // to avoid conflicts between Telegram and Discord command registrations
    const dependencies = {
      ...services, // Spread all initialized services
      logger,      // Add the root app logger
      appStartTime: APP_START_TIME,
      internalApiClient: services.internalApiClient || services.internal?.client,
      toolRegistry: ToolRegistry.getInstance(),
      // commandRegistry removed - each platform will create its own instance
    };

    // Backward compatibility: ensure legacy path dependencies.internal.client exists
    if (!dependencies.internal) {
      dependencies.internal = {};
    }
    dependencies.internal.client = dependencies.internalApiClient;
    // geniusoverhaul: Add a log to verify dependencies.toolRegistry
    if (!dependencies.toolRegistry || typeof dependencies.toolRegistry.getToolById !== 'function') {
        logger.warn('[App] dependencies.toolRegistry is MISSING or INVALID!', { registry: dependencies.toolRegistry });
    }

    const platforms = _platforms = initializePlatforms(dependencies, {
      enableTelegram: true,
      enableDiscord: true,
      enableWeb: true,
      web: {
        staticPath: path.join(__dirname, 'public')
      }
    });

    // --- Build Platform Notifiers Map (needed for both NotificationDispatcher and Internal API) ---
    const platformNotifiersMap = {};

    // --- Telegram Notifier ---
    if (platforms.telegram && platforms.telegram.bot) {
      try {
        logger.debug('[App] Initializing TelegramNotifier...');
        const telegramNotifierInstance = new TelegramNotifier(platforms.telegram.bot, services.logger);
        platformNotifiersMap.telegram = telegramNotifierInstance;
      } catch (telegramErr) {
        logger.error('[App] Failed to initialize TelegramNotifier:', telegramErr.message);
      }
    } else {
      logger.debug('[App] Telegram platform not available. TelegramNotifier not registered.');
    }

    // --- Web Sandbox Notifier ---
    try {
      if (websocketServer) {
        const webSandboxNotifierInstance = new WebSandboxNotifier(websocketServer, services.logger);
        platformNotifiersMap['web-sandbox'] = webSandboxNotifierInstance;
        logger.debug('[App] WebSandboxNotifier initialized and registered.');
      } else {
        logger.warn('[App] WebSocketService not available. WebSandboxNotifier will not be registered.');
      }
    } catch (webNotifierErr) {
      logger.error('[App] Failed to initialize WebSandboxNotifier:', webNotifierErr.message);
    }

    // --- Discord Notifier ---
    if (platforms.discord && (platforms.discord.client || platforms.discord.bot)) {
      try {
        logger.debug('[App] Initializing DiscordNotifier...');
        const DiscordNotifier = require('./src/platforms/discord/discordNotifier');
        const discordClient = platforms.discord.client || platforms.discord.bot?.client;
        if (discordClient) {
          const discordNotifierInstance = new DiscordNotifier(discordClient, services.logger);
          platformNotifiersMap.discord = discordNotifierInstance;
          logger.debug('[App] DiscordNotifier initialized and registered.');
        } else {
          logger.warn('[App] Discord client not available. DiscordNotifier will not be registered.');
        }
      } catch (discordErr) {
        logger.error('[App] Failed to initialize DiscordNotifier:', discordErr.message);
      }
    } else {
      logger.debug('[App] Discord platform not available. DiscordNotifier not registered.');
    }

    // --- Webhook Notifier ---
    try {
      logger.debug('[App] Initializing WebhookNotifier...');
      // WebhookNotifier needs internalApiClient for fetching cast records
      const internalApiClient = services.internal?.client;
      if (internalApiClient) {
        const webhookNotifierInstance = new WebhookNotifier(services.logger, internalApiClient);
        platformNotifiersMap.webhook = webhookNotifierInstance;
        logger.debug('[App] WebhookNotifier initialized and registered.');
      } else {
        logger.warn('[App] Internal API client not available. WebhookNotifier will not be registered.');
      }
    } catch (webhookErr) {
      logger.error('[App] Failed to initialize WebhookNotifier:', webhookErr.message);
    }

    // Add platform notifiers to services dependencies for Internal API
    services.platformNotifiers = platformNotifiersMap;
    dependencies.platformNotifiers = platformNotifiersMap;
    
    // Update internal API dependencies with platform notifiers
    if (services.internal && typeof services.internal.updateDependencies === 'function') {
      services.internal.updateDependencies({ platformNotifiers: platformNotifiersMap });
      logger.debug('[App] Updated internal API dependencies with platform notifiers.');
    } else {
      logger.warn('[App] Internal API updateDependencies method not available. Notifications may not work.');
    }

    // --- Initialize and Start Notification Dispatcher ---
    if (services.internal?.client && services.logger) {
      try {
        logger.debug('[App] Initializing NotificationDispatcher...');
        const notificationDispatcher = new NotificationDispatcher(
          {
            internalApiClient: services.internal.client,
            logger: services.logger,
            platformNotifiers: platformNotifiersMap,
            workflowExecutionService: services.workflowExecutionService,
            spellService: services.spellService,
            generationOutputsDb: services.db?.generationOutputs || null, // Phase 7h: in-process generation record access
          },
          { /* Optional: pollingIntervalMs, etc. */ }
        );
        await notificationDispatcher.start();
        logger.debug('[App] NotificationDispatcher started.');
      } catch (dispatcherError) {
        logger.error('[App] Failed to initialize or start NotificationDispatcher:', dispatcherError.message, { stack: dispatcherError.stack });
        // Decide if this is a fatal error or if the app can run without it
      }
    } else {
      logger.warn('[App] Could not initialize NotificationDispatcher: Missing dependencies (internal.client, logger, or Telegram platform/bot). Dispatcher will not run.');
    }
    // --- End Notification Dispatcher Initialization ---

    // --- Internal API Auth Middleware (defined within startApp to access logger if needed, and be close to its usage) ---
    const internalApiAuthMiddleware = (req, res, next) => {
      // No public bypasses – all internal routes require X-Internal-Client-Key
      const requestId = uuidv4(); // Generate request ID for error logging
      // Ensure logger is available, fallback to console if services.logger is not yet initialized or passed
      const currentLogger = services && services.logger ? services.logger : logger; // Use app logger as fallback
      const clientKey = req.headers['x-internal-client-key'];

      if (!clientKey) {
        currentLogger.warn(`[AuthMiddleware] Internal API request denied: Missing X-Internal-Client-Key header. Path: ${req.originalUrl}, IP: ${req.ip}, RequestId: ${requestId}`);
        return res.status(401).json({
          error: {
            code: 'MISSING_AUTH_HEADER',
            message: 'Missing X-Internal-Client-Key header.',
            requestId: requestId
          }
        });
      }

      const validKeys = [
        process.env.INTERNAL_API_KEY_SYSTEM, // Added for system-level services
        process.env.INTERNAL_API_KEY_TELEGRAM,
        process.env.INTERNAL_API_KEY_DISCORD,
        process.env.INTERNAL_API_KEY_WEB,
        process.env.INTERNAL_API_KEY_API,
        process.env.INTERNAL_API_KEY_ADMIN,
      ].filter(key => key);

      if (!validKeys.includes(clientKey)) {
        currentLogger.warn(`[AuthMiddleware] Internal API request denied: Invalid X-Internal-Client-Key provided. Path: ${req.originalUrl}, IP: ${req.ip}, KeyProvided: ${clientKey}, RequestId: ${requestId}`);
        return res.status(403).json({
          error: {
            code: 'INVALID_API_KEY',
            message: 'Invalid API key provided.',
            requestId: requestId
          }
        });
      }
      currentLogger.debug(`[AuthMiddleware] Internal API request authorized. Path: ${req.originalUrl}, RequestId: ${requestId}`);
      next();
    };

    // Mount the internal API router
    if (services.internal && services.internal.router && platforms.web && platforms.web.app) {
      // Apply the auth middleware specifically to the /internal path of the web app
      platforms.web.app.use('/internal', internalApiAuthMiddleware);
      platforms.web.app.use('/internal', services.internal.router);
      logger.debug('Internal API authentication middleware and router mounted at /internal');
    } else {
      logger.warn('Internal API router or web app instance not available for mounting. Internal API might not be accessible or secured.');
    }
    
    // Mount the external API router
    if (services.external && services.external.router && platforms.web && platforms.web.app) {
      platforms.web.app.use('/api/v1', services.external.router);
      platforms.web.app.use('/api/external', services.external.router); // legacy path compatibility
      logger.debug('External API router mounted at /api/v1 and /api/external');
    } else {
      logger.warn('External API router or web app instance not available for mounting. External API will not be accessible.');
    }
    
    // Initialize web server routes BEFORE setting up Telegram commands
    if (platforms.web) {
      try {
        // Ensure the web platform exposes its app instance and its own initializeRoutes method
        if (platforms.web.app && typeof platforms.web.initializeRoutes === 'function') {
          logger.debug('Initializing Web platform routes (API, static, SPA)...');
          // This single call will handle API routes, static files, and SPA fallback internally.
          await platforms.web.initializeRoutes(); 
          logger.debug('Web platform routes (API, static, SPA) initialized.');
        } else {
          logger.warn('Web platform app instance or its initializeRoutes method not available.');
        }

        const port = process.env.WEB_PORT || 4000;
        logger.info(`Starting Web platform on port ${port}...`);
        // Get the httpServer instance when starting the web platform
        const httpServer = await platforms.web.start(port);
        logger.info(`Web platform running on port ${port}`);

        // Initialize the WebSocket service by attaching it to the running HTTP server
        logger.debug('Initializing WebSocket service...');
        websocketServer.initialize(httpServer);
        // Set ethereumServices for admin verification
        if (services.ethereumService) {
          websocketServer.setEthereumServices(services.ethereumService);
          logger.debug('WebSocket service ethereumServices configured for admin verification.');
        }
        logger.debug('WebSocket service initialized.');
        
        // --- Credit Service Startup ---
        // This is now started AFTER the web platform is running to ensure
        // the internal API is ready to receive requests from the service.
        const creditServices = services.creditServices;
        if (creditServices && typeof creditServices === 'object') {
            const chainIds = Object.keys(creditServices);
            if (chainIds.length === 0) {
                logger.warn('CreditService registry is empty. On-chain deposit features will not be reconciled.');
            }
            for (const chainId of chainIds) {
                const serviceInstance = creditServices[chainId];
                if (serviceInstance && typeof serviceInstance.start === 'function') {
                    logger.info(`Starting CreditService for chainId ${chainId} to sync with on-chain state...`);
                    serviceInstance.start().catch(err => {
                        logger.error(`CreditService (chain ${chainId}) failed to start or encountered a runtime error:`, err);
                    });
                } else {
                    logger.warn(`CreditService for chainId ${chainId} is missing or invalid. Deposits on this chain will not be reconciled.`);
                }
            }
            if (chainIds.length > 0) {
                logger.debug('CreditService startup invoked for all configured chains.');
            }
        } else {
            logger.warn('CreditService not found or not initialized. On-chain deposit features will not be reconciled.');
        }
        
        // Now setup Telegram commands AFTER web routes are initialized
        if (platforms.telegram) {
          try {
            logger.debug('Setting up Telegram dynamic commands...');
            // Truncate descriptions before setting up commands
            const allTools = dependencies.toolRegistry.getAllTools();
            allTools.forEach(tool => {
                if (tool.description && tool.description.length > 255) {
                    logger.warn(`[App] Truncating description for tool "${tool.displayName}" as it exceeds 255 characters.`);
                    tool.description = tool.description.substring(0, 255);
                }
            });
            await platforms.telegram.setupCommands();
            logger.debug('Telegram dynamic commands configured');
          } catch (telegramError) {
            logger.error('Failed to setup Telegram commands:', telegramError.message);
          }
        }
        
        // Then start Discord...
        
      } catch (webError) {
        logger.error('Failed to start Web platform:', webError.message);
      }
    } else {
      logger.warn('Web platform not configured or disabled');
    }
    
    logger.info('\n===========================================');
    logger.info('| StationThis application is now running! |');
    logger.info('===========================================\n');

    // --- Startup announcement ---
    const startupBot = platforms.telegram && platforms.telegram.bot;
    const startupChatId = process.env.TELEGRAM_FEEDBACK_CHAT_ID;
    if (startupBot && startupChatId) {
      const version = process.env.BUILD_VERSION || 'dev';
      const sha = process.env.COMMIT_SHA || 'unknown';
      const msg = process.env.COMMIT_MSG || 'unknown';
      startupBot.sendMessage(
        startupChatId,
        `*stationthisbot v${version} is live*\n\`${sha}\` ${msg}`,
        { parse_mode: 'Markdown' }
      ).catch((err) => logger.warn('[App] Startup announcement failed:', err.message));
    }
    // --- End startup announcement ---

    // --- Memory monitor: alerts on interesting heap events, silent otherwise ---
    const memFeedbackChatId = process.env.TELEGRAM_FEEDBACK_CHAT_ID;
    const memBot = platforms.telegram && platforms.telegram.bot;
    if (memBot && memFeedbackChatId) {
      const WARN_MB = 400;
      const CRIT_MB = 600;
      const SPIKE_MB = 75;       // single-interval jump
      const LEAK_DELTA_MB = 40;  // cumulative growth over LEAK_CONSECUTIVE intervals
      const LEAK_CONSECUTIVE = 4;
      const DROP_MB = 100;       // GC cleared a lot — worth noting
      const SAMPLE_INTERVAL = 2 * 60 * 1000;

      let lastHeapMB = 0;
      let warnFired = false;
      let critFired = false;
      let consecutiveGrowth = 0;
      let growthSinceLastDrop = 0;
      let isFirstReading = true;

      const send = (msg) => memBot.sendMessage(memFeedbackChatId, msg, { parse_mode: 'Markdown' }).catch((err) => logger.warn('[App] Memory monitor send failed:', err.message));

      const sampleMemory = () => {
        const m = process.memoryUsage();
        const heapUsed = Math.round(m.heapUsed / 1024 / 1024);
        const heapTotal = Math.round(m.heapTotal / 1024 / 1024);
        const rss = Math.round(m.rss / 1024 / 1024);
        const ext = Math.round(m.external / 1024 / 1024);
        const uptimeMins = Math.round(process.uptime() / 60);
        const delta = lastHeapMB ? heapUsed - lastHeapMB : 0;
        const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
        const summary = `Heap: ${heapUsed}/${heapTotal} MB (${deltaStr} MB) | RSS: ${rss} MB | Ext: ${ext} MB`;

        if (isFirstReading) {
          send(`*Memory baseline* (uptime: ${uptimeMins}m)\n${summary}`);
          isFirstReading = false;
          lastHeapMB = heapUsed;
          return;
        }

        // Track consecutive growth for leak detection
        if (delta > 0) {
          consecutiveGrowth++;
          growthSinceLastDrop += delta;
        } else {
          consecutiveGrowth = 0;
          growthSinceLastDrop = 0;
          // Only report a drop if we previously alerted (warning/critical) — confirms recovery
          if (Math.abs(delta) >= DROP_MB && (warnFired || critFired)) {
            send(`*Memory recovered* (uptime: ${uptimeMins}m) — GC cleared ${Math.abs(delta)} MB\n${summary}`);
          }
          warnFired = false;
          critFired = false;
        }

        if (heapUsed >= CRIT_MB && !critFired) {
          critFired = true;
          send(`*CRITICAL: heap at ${heapUsed} MB* (uptime: ${uptimeMins}m) — crash imminent\n${summary}`);
        } else if (heapUsed >= WARN_MB && !warnFired) {
          warnFired = true;
          send(`*Warning: heap at ${heapUsed} MB* (uptime: ${uptimeMins}m)\n${summary}`);
        } else if (delta >= SPIKE_MB) {
          send(`*Spike: +${delta} MB in 2 min* (uptime: ${uptimeMins}m)\n${summary}`);
        } else if (consecutiveGrowth >= LEAK_CONSECUTIVE && growthSinceLastDrop >= LEAK_DELTA_MB) {
          send(`*Sustained growth: +${growthSinceLastDrop} MB over ${consecutiveGrowth} samples* (uptime: ${uptimeMins}m)\n${summary}`);
          consecutiveGrowth = 0;
          growthSinceLastDrop = 0;
        }

        lastHeapMB = heapUsed;
      };

      setTimeout(() => { sampleMemory(); setInterval(sampleMemory, SAMPLE_INTERVAL); }, 2 * 60 * 1000);
      logger.info('[App] Memory monitor active — alerts on threshold/spike/leak/drop events.');
    }
    // --- End memory monitor ---

    // Return components for external access
    return {
      services,
      platforms
    };
  } catch (error) {
    logger.error('Failed to start application:', error);
    throw error;
  }
}

// Track services and platforms for graceful shutdown
let _services = null;
let _platforms = null;

/**
 * Gracefully shuts down all services.
 * Call this before process exit to ensure in-flight operations complete.
 * @returns {Promise<void>}
 */
async function shutdownApp() {
  logger.info('[App] Graceful shutdown initiated...');

  // Stop Telegram polling first so the new container doesn't get a 409 conflict
  const telegramBot = _platforms && _platforms.telegram && _platforms.telegram.bot;
  if (telegramBot) {
    try {
      logger.info('[App] Stopping Telegram polling...');
      await telegramBot.stopPolling();
      logger.info('[App] Telegram polling stopped.');
    } catch (err) {
      logger.error('[App] Error stopping Telegram polling:', err.message);
    }
  }

  if (_services && _services.creditServices) {
    const creditServices = _services.creditServices;
    const chainIds = Object.keys(creditServices);

    for (const chainId of chainIds) {
      const serviceInstance = creditServices[chainId];
      if (serviceInstance && typeof serviceInstance.stop === 'function') {
        try {
          logger.info(`[App] Stopping CreditService for chainId ${chainId}...`);
          await serviceInstance.stop();
          logger.info(`[App] CreditService for chainId ${chainId} stopped.`);
        } catch (err) {
          logger.error(`[App] Error stopping CreditService (chain ${chainId}):`, err);
        }
      }
    }
  }

  logger.info('[App] Graceful shutdown complete.');
}

// Setup graceful shutdown handlers
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    logger.warn(`[App] Already shutting down, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  logger.info(`[App] Received ${signal}, starting graceful shutdown...`);

  try {
    await shutdownApp();
  } catch (err) {
    logger.error('[App] Error during graceful shutdown:', err);
  }

  logger.info('[App] Exiting process.');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export components for use in other files
module.exports = {
  startApp,
  shutdownApp,
  APP_START_TIME
};

// Start the app if this file is run directly
if (require.main === module) {
  startApp().catch(error => {
    logger.error('Application startup failed:', error);
    process.exit(1);
  });
} 
