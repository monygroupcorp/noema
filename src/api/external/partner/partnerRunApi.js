/**
 * Partner Run API
 *
 * Allows third-party partners to execute spells on behalf of their users
 * via x402 payment. Partners receive a split credit per run recorded in
 * the SplitLedger.
 *
 * Flow:
 * 1. POST /partner/spells/:slug/run without payment → 402 + PaymentRequired
 * 2. POST /partner/spells/:slug/run with X-PAYMENT header → validate, settle, queue
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('../../../utils/logger');
const {
  createX402ExecutionService,
  createPaymentRequired,
  sendPaymentRequired,
  BASE_USDC_ADDRESS,
  BASE_SEPOLIA_USDC_ADDRESS,
  NETWORKS
} = require('../../../core/services/x402');
const { distributeAgentOwnerReward } = require('../../../core/services/charging/agentOwnerReward');
const { USD_PER_POINT } = require('../../../core/constants/economy');
const { economyService } = require('../../../core/services/store/economy/EconomyService');

const logger = createLogger('partnerRunApi');

function usdcAtomicToPoints(atomicStr) {
  return Math.round(Number(atomicStr) / 1e6 / USD_PER_POINT);
}

const DEFAULT_SPELL_PRICE_USDC = process.env.X402_CAST_USDC || '100000'; // $0.10
const DEFAULT_SPLIT_BPS = 500; // 5%

/**
 * Create partner run API router
 *
 * @param {Object} dependencies
 * @param {Object} dependencies.spellsDb - SpellsDB instance
 * @param {Object} dependencies.partnerDb - PartnerDB instance
 * @param {Object} dependencies.uploadRecordDb - UploadRecordDB instance
 * @param {Object} dependencies.splitLedgerDb - SplitLedgerDB instance
 * @param {Object} dependencies.x402PaymentLogDb - X402PaymentLogDB instance
 * @param {Object} [dependencies.castsDb] - CastsDB instance for cast tracking
 * @param {Object} [dependencies.spellsService] - SpellsService for quoting and execution
 * @param {string} dependencies.receiverAddress - Address to receive payments
 * @param {string} [dependencies.network] - Network ID (defaults to Base mainnet)
 */
function createPartnerRunApi({ spellsDb, partnerDb, uploadRecordDb, splitLedgerDb, x402PaymentLogDb, userCoreDb, cookCollectionsDb, castsDb, spellsService, receiverAddress, network = NETWORKS.BASE_MAINNET }) {
  if (!receiverAddress) throw new Error('partnerRunApi requires receiverAddress');

  const router = express.Router();
  const x402ExecutionService = createX402ExecutionService({ x402PaymentLogDb });

  // Determine USDC address based on network
  const usdcAddress = network === NETWORKS.BASE_SEPOLIA
    ? BASE_SEPOLIA_USDC_ADDRESS
    : BASE_USDC_ADDRESS;

  /**
   * POST /partner/spells/:slug/run
   *
   * Execute a published spell with x402 payment.
   *
   * Without X-PAYMENT header: Returns 402 with PaymentRequired
   * With X-PAYMENT header: Validates, settles, queues execution
   *
   * Body:
   * - partnerId: string (required)
   * - inputs: object (spell inputs)
   * - uploadId: string (optional, presigned upload to attach)
   */
  router.post('/spells/:slug/run', async (req, res) => {
    try {
      const { slug } = req.params;
      const { inputs = {}, uploadId, partnerId } = req.body;

      if (!partnerId) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'partnerId required' });
      }

      // Validate partner + domain
      const origin = req.get('Origin') || '';
      const domain = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

      const partner = await partnerDb.findPartnerById(partnerId);
      if (!partner) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Partner not found' });
      }
      if (!partner.allowedDomains.includes(domain)) {
        logger.warn('[partnerRun] Domain mismatch', { partnerId, domain, allowed: partner.allowedDomains });
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Domain not registered for this partner' });
      }

      // Validate spell exists (published flag is deprecated; access is controlled
      // by partner credential + domain validation above)
      const spell = await spellsDb.findOne({ slug });
      if (!spell) {
        return res.status(404).json({ error: 'NOT_FOUND', message: `Spell '${slug}' not found` });
      }

      // Validate uploadId if provided
      if (uploadId) {
        const upload = await uploadRecordDb.findUploadRecord(uploadId);
        if (!upload) {
          return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid or expired uploadId' });
        }
        if (upload.partnerId !== partnerId) {
          return res.status(403).json({ error: 'FORBIDDEN', message: 'uploadId does not belong to this partner' });
        }
      }

      // Compute x402 price dynamically from historical execution data.
      // Falls back to spell.x402Price or the env default if quoteSpell is unavailable.
      let amount = spell.x402Price || DEFAULT_SPELL_PRICE_USDC;
      if (spellsService) {
        try {
          const quote = await spellsService.quoteSpell(slug);
          if (quote.totalCostPts > 0) {
            amount = String(Math.round(quote.totalCostPts * USD_PER_POINT * 1e6));
          }
        } catch (quoteErr) {
          logger.warn('[partnerRun] quoteSpell failed, using fallback price', { slug, error: quoteErr.message });
        }
      }

      const x402 = req.x402;

      // No payment — issue 402
      if (!x402 || !x402.verified) {
        logger.info('[partnerRun] No payment provided, returning 402', { slug, amount });

        const paymentRequired = createPaymentRequired({
          receiverAddress,
          network,
          amount,
          asset: usdcAddress,
          description: `Spell execution: ${spell.name || slug}`,
          resourceUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
        });

        return sendPaymentRequired(res, paymentRequired);
      }

      // Validate payment covers cost (validatePaymentForExecution expects USD, not atomic units)
      const requiredCostUsd = x402ExecutionService.usdcAtomicToUsd(amount);
      const validation = await x402ExecutionService.validatePaymentForExecution(x402, requiredCostUsd);
      if (!validation.valid) {
        logger.warn('[partnerRun] Payment validation failed', { error: validation.errorCode, slug });
        return res.status(402).json({ error: validation.errorCode, message: 'Payment invalid' });
      }

      const runId = uuidv4();

      // Record payment as verified before settlement
      const record = await x402ExecutionService.recordPaymentVerified(x402, {
        toolId: slug,
        spellId: spell._id ? String(spell._id) : undefined,
        costUsd: requiredCostUsd,
      });
      const signatureHash = record.signatureHash;

      // Mark upload as used (atomic check to prevent double-use)
      if (uploadId) {
        const markResult = await uploadRecordDb.markUsed(uploadId, runId);
        if (markResult.modifiedCount === 0) {
          return res.status(409).json({ error: 'UPLOAD_CONSUMED', message: 'uploadId already used or expired' });
        }
      }

      // Record split ledger entry
      const splitBps = partner.splitBps != null ? partner.splitBps : DEFAULT_SPLIT_BPS;
      const grossAmount = x402.amount || amount;
      const partnerAmount = String(Math.floor((Number(grossAmount) * splitBps) / 10000));

      await splitLedgerDb.createEntry({
        partnerId,
        runId,
        spellSlug: slug,
        uploadId: uploadId || null,
        grossAmount: String(grossAmount),
        partnerAmount,
        asset: x402.asset,
        network: x402.network,
      });

      // Settle payment and check result before marking credited
      const settlement = await x402ExecutionService.settlePayment(x402, signatureHash);
      if (!settlement.success) {
        logger.error('[partnerRun] Settlement failed', { error: settlement.error, runId, slug });
        return res.status(202).json({ runId, status: 'queued', spellSlug: slug, settlementPending: true });
      }
      await splitLedgerDb.markCredited(runId);

      logger.info('[partnerRun] Spell queued', { runId, slug, partnerId });

      // Agent/collection owner rev-share for partner-proxied runs (best-effort)
      const grossPoints = usdcAtomicToPoints(grossAmount);
      let agentDoc = null;
      let agentCollection = null;
      // Look up agent if agentId provided in request body — skip if unavailable
      if (userCoreDb && req.body?.agentId) {
        agentDoc = await userCoreDb.findByAgentId(req.body.agentId).catch(() => null);
      }
      if (agentDoc?.agentCollection && cookCollectionsDb) {
        agentCollection = await cookCollectionsDb.findById(agentDoc.agentCollection).catch(() => null);
      }
      if (agentDoc) {
        await distributeAgentOwnerReward({
          agentDoc,
          collection: agentCollection,
          grossPoints,
          runId,
          spellSlug: slug,
          economyService,
          splitLedgerDb: splitLedgerDb || null,
          logger,
        }).catch(err => logger.error('[partnerRun] agentOwnerReward failed:', err.message));
      }

      // Dispatch spell execution. Use the spell owner's MAID as masterAccountId so
      // checkPermissions passes without relaxing the permission model — the x402
      // payment already authorized this execution.
      let castId = null;
      if (spellsService) {
        const castContext = {
          masterAccountId: spell.ownedBy?.toString(),
          inputs,
          runId,
          // Forward optional caller-supplied webhook for result delivery
          ...(req.body.webhookUrl && { webhookUrl: req.body.webhookUrl }),
        };
        try {
          const castResult = await spellsService.castSpell(slug, castContext, castsDb);
          castId = castResult?.castId || castContext.castId || null;
          logger.info('[partnerRun] Spell cast dispatched', { runId, slug, castId });
        } catch (castErr) {
          logger.error('[partnerRun] castSpell failed after payment settled', { error: castErr.message, runId, slug });
          // Payment is already settled — return 202 so the partner knows payment succeeded
          // even if execution failed to dispatch. They can retry via support.
          return res.status(202).json({ runId, status: 'dispatch_failed', spellSlug: slug, castId });
        }
      }

      return res.status(202).json({ runId, status: 'running', spellSlug: slug, castId });

    } catch (err) {
      logger.error('[partnerRun] execution error', { error: err.message, slug: req.params.slug });
      return res.status(500).json({ error: 'EXECUTION_ERROR', message: 'Spell execution failed' });
    }
  });

  return router;
}

module.exports = { createPartnerRunApi };
