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

const logger = createLogger('partnerRunApi');

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
 * @param {string} dependencies.receiverAddress - Address to receive payments
 * @param {string} [dependencies.network] - Network ID (defaults to Base mainnet)
 */
function createPartnerRunApi({ spellsDb, partnerDb, uploadRecordDb, splitLedgerDb, x402PaymentLogDb, receiverAddress, network = NETWORKS.BASE_MAINNET }) {
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

      // Validate spell exists and is published
      const spell = await spellsDb.findOne({ slug, published: true });
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

      const amount = spell.x402Price || DEFAULT_SPELL_PRICE_USDC;
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

      // Mark upload as used
      if (uploadId) {
        await uploadRecordDb.markUsed(uploadId, runId);
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

      // TODO: dispatch spell execution (wire to existing spell execution service)
      // For now return accepted — execution dispatch wired in next task
      return res.status(202).json({ runId, status: 'queued', spellSlug: slug });

    } catch (err) {
      logger.error('[partnerRun] execution error', { error: err.message, slug: req.params.slug });
      return res.status(500).json({ error: 'EXECUTION_ERROR', message: 'Spell execution failed' });
    }
  });

  return router;
}

module.exports = { createPartnerRunApi };
