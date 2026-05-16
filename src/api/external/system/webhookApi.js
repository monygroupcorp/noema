const express = require('express');
const crypto = require('crypto');
const { createLogger } = require('../../../utils/logger');
const { processComfyDeployWebhook } = require('../../../core/services/comfydeploy/webhookProcessor');
const { validateAlchemySignature, addAlchemyContextToRequest } = require('../../../core/services/alchemy/webhookUtils');
const bodyParser = require('body-parser');

function verifyComfyDeploySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true; // Dev mode: skip when env var not set
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Creates the webhook API router for handling external webhook events.
 * 
 * @param {Object} dependencies - Dependencies from the main application
 * @returns {express.Router} - The configured Express router for webhook endpoints
 */
function createWebhookApi(dependencies) {
  const logger = createLogger('WebhookAPI');
  const webhookRouter = express.Router();

  // --- ComfyDeploy Webhook Handler ---
  // The global express.json() (with rawBodySaver) pre-parses the body and saves the raw
  // Buffer to req.rawBody. We use req.rawBody for HMAC verification and req.body for the
  // parsed payload — the route-level express.raw() is not needed.
  webhookRouter.post('/comfydeploy', async (req, res) => {
    try {
      const routeLogger = dependencies.logger || console;
      const secret = process.env.COMFY_DEPLOY_WEBHOOK_SECRET;

      // req.rawBody is set by rawBodySaver verify callback on the global express.json()
      const rawBody = req.rawBody;
      const signatureHeader = req.headers['x-comfydeploy-signature'] || req.headers['x-comfy-signature'];
      if (!verifyComfyDeploySignature(rawBody, signatureHeader, secret)) {
        routeLogger.warn('[WebhookAPI] ComfyDeploy webhook rejected: invalid signature');
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
      if (!secret) {
        routeLogger.warn('[WebhookAPI] COMFY_DEPLOY_WEBHOOK_SECRET not set — skipping signature verification (dev mode)');
      }

      // Body already parsed by global express.json(); fall back to manual parse if content-type differed
      let parsedBody = req.body;
      if (!parsedBody || typeof parsedBody !== 'object') {
        try {
          parsedBody = JSON.parse((rawBody || req.body || '').toString('utf8'));
        } catch (parseErr) {
          routeLogger.error('[WebhookAPI] ComfyDeploy webhook: failed to parse JSON body');
          return res.status(400).json({ error: 'Invalid JSON body' });
        }
      }

      routeLogger.debug('[WebhookAPI] Dependencies prepared for webhookProcessor', {
        internalApiClient: {
          exists: Boolean(dependencies.internal?.client),
          hasGet: typeof dependencies.internal?.client?.get === 'function'
        },
        loggerAttached: Boolean(dependencies.logger)
      });

      const processorDeps = {
        internalApiClient: dependencies.internalApiClient || dependencies.internal?.client,
        telegramNotifier: dependencies.telegramNotifier,
        logger: dependencies.logger || console,
        webSocketService: dependencies.webSocketService,
        userCoreDb: dependencies.db?.userCore || null
      };

      const result = await processComfyDeployWebhook(parsedBody, processorDeps);

      if (result.success) {
        res.status(result.statusCode || 200).json(result.data || { message: "Webhook processed" });
      } else {
        res.status(result.statusCode || 500).json({ message: "error", error: result.error || "Webhook processing failed." });
      }

    } catch (error) {
      const routeLogger = dependencies.logger || console;
      routeLogger.error('[WebhookAPI] Unhandled exception:', error);
      res.status(500).json({ message: "error", error: "Internal server error in webhook route handler." });
    }
  });

  // --- Alchemy Webhook Handler ---
  // Support multichain credit services. Expose :chainId route param (defaults to "1")

  const { creditServices = {}, ethereumServices = {}, creditService: legacyCredit, ethereumService: legacyEth } = dependencies;

  /**
   * Helper to grab the correct service pair for a given chain.
   * Falls back to the legacy singleton for backward-compatibility.
   * @param {string|number} cid
   */
  const getChainServices = (cid = '1') => ({
    creditService: creditServices[cid] || legacyCredit,
    ethereumService: ethereumServices[cid] || legacyEth,
  });

  // Resolve signing key per chainId: ENV vars like ALCHEMY_SIGNING_KEY_1, fallback to ALCHEMY_SIGNING_KEY
  const getSigningKey = (cid='1') => process.env[`ALCHEMY_SIGNING_KEY_${cid}`] || process.env.ALCHEMY_SIGNING_KEY;

  // Always mount route; reject if no key for cid at runtime
  webhookRouter.post('/alchemy/:chainId?',
    (req, res, next) => {
      const logger = dependencies.logger || console;
      logger.debug('[AlchemyWebhook] Incoming request', {
        headers: req.headers,
        method: req.method,
        url: req.originalUrl
      });
      next();
    },
    (req, res, next) => {
      const logger = dependencies.logger || console;
      logger.debug('[AlchemyWebhook] Before signature validation', {
        signature: req.header('X-Alchemy-Signature'),
        hasRawBody: !!req.rawBody,
        rawBodyLength: req.rawBody ? req.rawBody.length : 0
      });
      next();
    },
    async (req, res, next) => {
      const chainId = String(req.params.chainId || '1');
      const signingKey = getSigningKey(chainId);
      if (!signingKey) {
        return res.status(403).json({ success:false, message:`No signing key configured for chain ${chainId}`});
      }
      // run signature validator
      try {
        validateAlchemySignature(signingKey)(req,res,next);
      } catch(err){ return; }
    },
    async (req, res) => {
      const logger = dependencies.logger || console;
      logger.debug('[AlchemyWebhook] Handler start', {
        body: req.body,
        rawBody: req.rawBody ? req.rawBody.toString('hex').slice(0, 64) + '...' : undefined
      });
      try {
        const chainId = String(req.params.chainId || '1');
        const { creditService } = getChainServices(chainId);
        if (!creditService) {
          logger.error('[AlchemyWebhook] CreditService not available');
          throw new Error('CreditService not available');
        }
        const result = await creditService.handleEventWebhook(req.body);
        logger.debug('[AlchemyWebhook] Handler result', { chainId, result });
        res.json(result);
      } catch (error) {
        logger.error('[AlchemyWebhook] Error processing webhook:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error processing webhook',
          detail: error.message
        });
      }
    }
  );
  logger.info('[WebhookAPI] Alchemy webhook handler mounted at /alchemy/:chainId?');

  logger.info('Webhook API router initialized.');
  return webhookRouter;
}

module.exports = { createWebhookApi }; 