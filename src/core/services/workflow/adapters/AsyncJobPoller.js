/**
 * AsyncJobPoller - Handles async job polling for adapter-based tools
 *
 * Polls adapter jobs until completion and updates generation records.
 *
 * Billing: spell-step async adapter tools (e.g. OpenAI gpt-image / dall-e) do
 * NOT flow through the ComfyDeploy webhook, so nothing debited them — the cost
 * was recorded on the generation but never charged. This poller now debits on
 * successful completion via the shared chargeGeneration path (idempotency-keyed,
 * so it can't double-charge anything the webhook or upfront-quote already billed).
 */

const { chargeGeneration } = require('../../charging/chargeGeneration');
const { getPricingService } = require('../../pricing');
const { USD_PER_POINT } = require('../../../constants/economy');

class AsyncJobPoller {
    constructor({ logger, generationRecordManager }) {
        this.logger = logger;
        this.generationRecordManager = generationRecordManager;
    }

    /**
     * Starts polling an async adapter job
     * @param {string} generationId - Generation record ID
     * @param {string} runId - Adapter run ID
     * @param {Object} adapter - Adapter instance with pollJob method
     * @param {Object} options - Polling options
     * @param {number} options.maxAttempts - Maximum polling attempts (default: 60)
     * @param {number} options.pollInterval - Polling interval in ms (default: 5000)
     * @param {Function} options.normalizeOutput - Optional output normalization function
     * @returns {Promise<void>} - Resolves when polling completes (doesn't wait for background polling)
     */
    async startPolling(generationId, runId, adapter, options = {}) {
        const {
            maxAttempts = 60, // 5 min at 5s interval
            pollInterval = 5000,
            normalizeOutput = null
        } = options;

        // Start background polling (fire-and-forget)
        this._pollInBackground(generationId, runId, adapter, maxAttempts, pollInterval, normalizeOutput);
    }

    /**
     * Polls adapter job in background until completion
     * @private
     */
    _pollInBackground(generationId, runId, adapter, maxAttempts, pollInterval, normalizeOutput) {
        this.logger.debug(`[AsyncJobPoller] Starting background polling for generation ${generationId}, runId ${runId}`);
        (async () => {
            try {
                let attempts = 0;
                while (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, pollInterval));
                    attempts++;
                    this.logger.debug(`[AsyncJobPoller] Polling attempt ${attempts}/${maxAttempts} for runId ${runId}`);
                    const pollRes = await adapter.pollJob(runId);
                    this.logger.debug(`[AsyncJobPoller] Poll result for runId ${runId}: status=${pollRes?.status}`);

                    if (pollRes.status === 'succeeded' || pollRes.status === 'failed' || pollRes.status === 'completed') {
                        const finalStatus = (pollRes.status === 'failed') ? 'failed' : 'completed';
                        let finalData = pollRes.data;

                        // Normalize output if function provided
                        if (normalizeOutput && typeof normalizeOutput === 'function') {
                            finalData = normalizeOutput({ type: pollRes.type, data: finalData });
                        }

                        // Update generation record with final result
                        const updatePayload = {
                            status: finalStatus,
                            responsePayload: [{ type: pollRes.type, data: finalData }],
                            ...(pollRes.costUsd && { costUsd: pollRes.costUsd })
                        };

                        await this.generationRecordManager.updateGenerationRecord(generationId, updatePayload);
                        this.logger.info(`[AsyncJobPoller] Updated generation ${generationId} with final status: ${finalStatus}`);
                        // NOTE: We don't emit generationUpdated here because the API endpoint (generationOutputsApi.js)
                        // already emits it when the record is updated. Emitting here would cause duplicate handling.

                        // Debit the user on success (these tools are not billed by the comfy webhook).
                        if (finalStatus === 'completed') {
                            await this._chargeOnCompletion(generationId, pollRes);
                        }

                        break; // Job completed, exit polling loop
                    }

                    attempts++;
                }

                if (attempts >= maxAttempts) {
                    this.logger.error(`[AsyncJobPoller] Adapter job ${runId} did not complete within ${maxAttempts * pollInterval / 1000} seconds`);
                    await this.generationRecordManager.updateGenerationRecord(generationId, {
                        status: 'failed',
                        deliveryError: 'Job did not complete within timeout period'
                    });
                }
            } catch (pollErr) {
                this.logger.error(`[AsyncJobPoller] Background poller error for adapter job ${runId}:`, pollErr.message);
                try {
                    await this.generationRecordManager.updateGenerationRecord(generationId, {
                        status: 'failed',
                        deliveryError: `Polling error: ${pollErr.message}`
                    });
                } catch (updateErr) {
                    this.logger.error(`[AsyncJobPoller] Failed to update generation ${generationId} status after polling error:`, updateErr.message);
                }
            }
        })();
    }

    /**
     * Debit the payer for a completed async adapter generation.
     *
     * Skips when the cast was already paid upfront (quote), when there's no
     * payer, or when no usable cost is known. Prices the raw compute cost
     * through the standard pricing tier and charges via chargeGeneration with a
     * canonical idempotency key, so re-runs / other charge paths can't duplicate.
     * Never throws — billing failures are logged, not allowed to break delivery.
     * @private
     */
    async _chargeOnCompletion(generationId, pollRes) {
        try {
            const rec = await this.generationRecordManager.getGenerationRecord(generationId);
            if (!rec) {
                this.logger.warn(`[AsyncJobPoller] charge: generation ${generationId} not found — skipping debit`);
                return;
            }
            if (rec.metadata?.castChargedUpfront) {
                this.logger.debug(`[AsyncJobPoller] charge: ${generationId} cast charged upfront — skipping per-step debit`);
                return;
            }
            if (!rec.masterAccountId) {
                this.logger.warn(`[AsyncJobPoller] charge: ${generationId} has no masterAccountId — skipping debit`);
                return;
            }

            // Prefer the actual cost from the run; fall back to the costRate estimate.
            const costRate = rec.metadata?.costRate;
            const computeCostUsd = [
                pollRes?.costUsd,
                typeof rec.costUsd === 'number' ? rec.costUsd : (rec.costUsd?.$numberDecimal ? Number(rec.costUsd.$numberDecimal) : null),
                costRate && costRate.unit === 'run' ? costRate.amount : null,
            ].find(v => typeof v === 'number' && v > 0);
            if (!computeCostUsd) {
                this.logger.warn(`[AsyncJobPoller] charge: ${generationId} has no usable cost (costUsd/costRate) — skipping debit`);
                return;
            }

            const priced = getPricingService().calculateCost({
                computeCostUsd,
                serviceName: rec.serviceName,
                isMs2User: false, // standard tier; spell-step records don't carry the MS2 flag
                toolId: rec.toolId,
            });
            const basePoints = Math.max(1, Math.round(priced.finalCostUsd / USD_PER_POINT));

            const chargeResult = await chargeGeneration({
                masterAccountId: rec.masterAccountId,
                generationRecord: rec,
                basePoints,
                toolId: rec.toolId,
                idempotencyKey: `${generationId}:final-debit`,
                logger: this.logger,
            });

            await this.generationRecordManager.updateGenerationRecord(generationId, {
                pointsSpent: chargeResult.totalPointsCharged,
                contributorRewardPoints: chargeResult.totalRewards,
                rewardBreakdown: chargeResult.rewardBreakdown,
            }).catch(() => {});

            this.logger.info(`[AsyncJobPoller] Debited ${chargeResult.totalPointsCharged} pts for async generation ${generationId} (computeUsd=$${computeCostUsd}, finalUsd=$${priced.finalCostUsd?.toFixed?.(4)})`);
        } catch (err) {
            this.logger.error(`[AsyncJobPoller] Charge failed for generation ${generationId}: ${err.message}`);
        }
    }
}

module.exports = AsyncJobPoller;

