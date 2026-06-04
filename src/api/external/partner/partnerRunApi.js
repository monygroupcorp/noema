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
const { ObjectId } = require('mongodb');
const { createLogger } = require('../../../utils/logger');
const { getActiveJobProgress } = require('../../../core/services/comfydeploy/webhookProcessor');
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

// Minimum weight assigned to steps with no duration history (near-instant sync steps).
// Keeps them present in the math but proportionally tiny vs a 5-min ComfyUI run.
const INSTANT_STEP_MS = 200;

/**
 * Return per-step duration weights for a spell.
 * Each weight is the historical avg execution time (ms) for that step's tool,
 * floored at INSTANT_STEP_MS so zero-cost sync steps don't collapse to zero.
 *
 * @param {Object} spell
 * @param {Object} generationOutputsDb
 * @returns {Promise<number[]>} one weight per step, same order as spell.steps
 */
async function getStepWeights(spell, generationOutputsDb) {
  const steps = spell.steps || [];
  if (!steps.length || !generationOutputsDb) return steps.map(() => INSTANT_STEP_MS);

  const uniqueToolIds = [...new Set(steps.map(s => s.toolIdentifier || s.toolId).filter(Boolean))];

  const durationMap = {};
  await Promise.all(uniqueToolIds.map(async toolId => {
    try {
      const [stats] = await generationOutputsDb.aggregate([
        { $match: {
            $or: [{ toolId }, { toolDisplayName: toolId }, { serviceName: toolId }],
            status: 'completed',
            durationMs: { $exists: true, $gt: 0 },
        }},
        { $sort: { _id: -1 } },
        { $limit: 20 },
        { $group: { _id: null, avgDurationMs: { $avg: '$durationMs' } } },
      ]);
      durationMap[toolId] = stats?.avgDurationMs || 0;
    } catch (_) {
      durationMap[toolId] = 0;
    }
  }));

  return steps.map(step => {
    const toolId = step.toolIdentifier || step.toolId;
    const avg = durationMap[toolId] || 0;
    return avg > INSTANT_STEP_MS ? avg : INSTANT_STEP_MS;
  });
}

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
 * @param {Object} [dependencies.generationOutputsDb] - GenerationOutputsDB for output URLs in status endpoint
 * @param {Object} [dependencies.spellsService] - SpellsService for quoting and execution
 * @param {string} dependencies.receiverAddress - Address to receive payments
 * @param {string} [dependencies.network] - Network ID (defaults to Base mainnet)
 */
function createPartnerRunApi({ spellsDb, partnerDb, uploadRecordDb, splitLedgerDb, x402PaymentLogDb, userCoreDb, cookCollectionsDb, agentAccountDb, castsDb, generationOutputsDb, spellsService, receiverAddress, network = NETWORKS.BASE_MAINNET }) {
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
        agentId: agentDoc?.agentId || null,
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
      let agentAccountDoc = null;
      // Look up agent if agentId provided in request body — skip if unavailable
      if (userCoreDb && req.body?.agentId) {
        agentDoc = await userCoreDb.findByAgentId(req.body.agentId).catch(() => null);
      }
      // Fall back to provisioned agentAccountDb for ERC-8004 agents not in userCoreDb
      if (!agentDoc && agentAccountDb && req.body?.agentId) {
        agentAccountDoc = await agentAccountDb.findByAgentId(req.body.agentId).catch(() => null);
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
          // Tag cast with provisioned agentAccountId so it appears in gallery feed
          ...(agentAccountDoc?.agentAccountId && { agentAccountId: agentAccountDoc.agentAccountId }),
          // Forward optional caller-supplied webhook for result delivery
          ...(req.body.webhookUrl && { webhookUrl: req.body.webhookUrl }),
        };
        try {
          const castResult = await spellsService.castSpell(slug, castContext, castsDb);
          castId = castResult?.castId || castContext.castId || null;
          logger.info('[partnerRun] Spell cast dispatched', { runId, slug, castId });
          if (castId) {
            splitLedgerDb.setCastId(runId, castId).catch(err =>
              logger.error('[partnerRun] setCastId failed:', err.message)
            );
          }
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

  /**
   * GET /partner/runs/:runId
   *
   * Poll the status of a spell run initiated via the partner run endpoint.
   * Authenticated by partnerId query param + Origin domain check.
   *
   * Query:
   * - partnerId: string (required)
   *
   * Response:
   * - { runId, spellSlug, castId, status, stepsDone, stepsTotal, outputs, failureReason? }
   */
  router.get('/runs/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      const { partnerId } = req.query;

      if (!partnerId) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: 'partnerId required' });
      }

      // Same domain validation as run endpoint
      const origin = req.get('Origin') || '';
      const domain = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

      const partner = await partnerDb.findPartnerById(partnerId);
      if (!partner) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Partner not found' });
      }
      if (!partner.allowedDomains.includes(domain)) {
        logger.warn('[partnerRun/status] Domain mismatch', { partnerId, domain, allowed: partner.allowedDomains });
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Domain not registered for this partner' });
      }

      // Look up run — validates partnerId ownership
      const ledgerEntry = await splitLedgerDb.findByRunId(runId);
      if (!ledgerEntry || ledgerEntry.partnerId !== partnerId) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Run not found' });
      }

      const { castId, spellSlug } = ledgerEntry;

      if (!castId) {
        return res.json({ runId, spellSlug, status: 'queued', stepsDone: 0, stepsTotal: 0, outputs: [] });
      }

      // Fetch cast document
      const cast = await castsDb.findOne({ _id: new ObjectId(castId) });
      if (!cast) {
        return res.json({ runId, spellSlug, castId, status: 'unknown', stepsDone: 0, stepsTotal: 0, outputs: [] });
      }

      // Step count for progress (best-effort spell fetch)
      const spell = await spellsDb.findOne({ slug: spellSlug });
      const stepsTotal = spell?.steps?.length || 0;
      const stepsDone = cast.stepGenerationIds?.length || 0;

      // Collect output URLs from completed generation records
      let outputs = [];
      if (cast.stepGenerationIds?.length && generationOutputsDb) {
        const gens = await generationOutputsDb.findGenerations(
          { _id: { $in: cast.stepGenerationIds } },
          { projection: { artifactUrls: 1, responsePayload: 1, status: 1 } }
        );
        for (const g of gens) {
          if (g.artifactUrls?.length) {
            for (const url of g.artifactUrls) outputs.push({ url, type: 'image' });
          } else {
            const rp = g.responsePayload;
            const text = rp?.text || rp?.response;
            if (text) outputs.push({ type: 'text', text });
          }
        }
      }

      // Factor in ComfyUI Deploy progress for the currently-running step.
      // stepGenerationIds only holds completed steps, so while a ComfyUI job is
      // in-flight its generation record exists (status:'processing') but hasn't
      // been appended yet. We look it up and pull progress from the in-memory
      // webhook cache to give an accurate overall percentage.
      let currentStepProgress = 0;
      let currentStepLiveStatus = null;
      if (cast.status === 'running' && generationOutputsDb) {
        const [inProgressGen] = await generationOutputsDb.findGenerations(
          { castId: new ObjectId(castId), status: 'processing' },
          { sort: { requestTimestamp: -1 }, limit: 1,
            projection: { 'metadata.run_id': 1 } }
        );
        if (inProgressGen?.metadata?.run_id) {
          const jobState = getActiveJobProgress().get(inProgressGen.metadata.run_id);
          if (jobState) {
            currentStepProgress = typeof jobState.progress === 'number' ? jobState.progress : 0;
            currentStepLiveStatus = jobState.live_status || null;
          }
        }
      }

      // Weight each step by its historical avg duration so a 200ms string primitive
      // doesn't claim the same slice of progress as a 5-min ComfyUI run.
      let progress;
      if (cast.status === 'completed') {
        progress = 1;
      } else if (spell && stepsTotal > 0) {
        const weights = await getStepWeights(spell, generationOutputsDb);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const completedWeight = weights.slice(0, stepsDone).reduce((a, b) => a + b, 0);
        const activeWeight = (weights[stepsDone] ?? 0) * currentStepProgress;
        progress = totalWeight > 0
          ? Math.min((completedWeight + activeWeight) / totalWeight, 1)
          : 0;
      } else {
        progress = 0;
      }

      return res.json({
        runId,
        spellSlug,
        castId,
        status: cast.status,
        progress,
        stepsDone,
        stepsTotal,
        outputs,
        ...(currentStepLiveStatus && { currentStepLiveStatus }),
        ...(cast.failureReason && { failureReason: cast.failureReason }),
        ...(cast.completedAt && { completedAt: cast.completedAt }),
      });

    } catch (err) {
      logger.error('[partnerRun/status] error', { error: err.message, runId: req.params.runId });
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Status lookup failed' });
    }
  });

  return router;
}

module.exports = { createPartnerRunApi };
