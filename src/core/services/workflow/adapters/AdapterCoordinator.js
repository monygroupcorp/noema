/**
 * AdapterCoordinator - Coordinates adapter-based tool execution
 * 
 * Handles adapter job creation, execution, and coordination.
 */

const { ObjectId } = require('mongodb');
const { isFractalTool } = require('../../../tools/fractalTool');
const { isFractalCompilerEnabled } = require('../../../tools/featureFlags');

class AdapterCoordinator {
    constructor({ logger, adapterRegistry, generationRecordManager, asyncJobPoller, workflowNotifier }) {
        this.logger = logger;
        this.adapterRegistry = adapterRegistry;
        this.generationRecordManager = generationRecordManager;
        this.asyncJobPoller = asyncJobPoller;
        this.workflowNotifier = workflowNotifier || null;
    }

    /**
     * Executes a tool using its adapter
     * @param {Object} tool - Tool definition
     * @param {Object} inputs - Tool inputs (resolved finalInputs from StepExecutor)
     * @param {Object} executionContext - Execution context
     * @param {Object} dependencies - Dependencies (eventId, etc.)
     * @returns {Promise<Object>} - Execution result with { generationId, runId, status }
     */
    async executeWithAdapter(tool, inputs, executionContext, dependencies) {
        const { spell, stepIndex, pipelineContext, originalContext } = executionContext;
        const { eventId } = dependencies;

        const adapter = this.adapterRegistry.get(tool.service);
        if (!adapter) {
            throw new Error(`No adapter found for service ${tool.service}`);
        }

        if (typeof adapter.startJob !== 'function') {
            throw new Error(`Adapter for ${tool.service} does not support startJob()`);
        }

        this.logger.debug(`[AdapterCoordinator] Executing tool ${tool.toolId} via adapter with inputs: ${JSON.stringify(Object.keys(inputs || {}))}`);

        // Compute costRate from tool.costingModel so the comfydeploy webhook
        // processor (and any other downstream debit logic) can charge this
        // step generation. Without this, spell steps were created with no
        // costRate metadata and the debit branch was silently skipped — users
        // could cast a spell from canvas without ever being charged.
        const costRate = this._computeCostRate(tool, inputs);
        if (!costRate) {
            this.logger.warn(`[AdapterCoordinator] No costRate could be computed for tool ${tool.toolId}; spell step generation will not be billed.`);
        }

        // Create generation record FIRST
        const generationParams = {
            masterAccountId: new ObjectId(originalContext.masterAccountId),
            initiatingEventId: new ObjectId(eventId),
            serviceName: tool.service,
            toolId: tool.toolId,
            toolDisplayName: tool.displayName || tool.name || tool.toolId,
            requestPayload: inputs, // Use resolved inputs, not empty pipelineContext
            status: 'processing',
            deliveryStatus: 'pending',
            deliveryStrategy: 'spell_step',
            notificationPlatform: originalContext.platform || 'none',
            metadata: {
                isSpell: true,
                castId: originalContext.castId || null,
                spell: typeof spell.toObject === 'function' ? spell.toObject() : spell,
                stepIndex,
                pipelineContext,
                originalContext,
                run_id: null, // Will be set after startJob
                ...(costRate && { costRate }),
            }
        };

        const { generationId } = await this.generationRecordManager.createGenerationRecord(generationParams);
        this.logger.debug(`[AdapterCoordinator] Created generation record ${generationId} for adapter job`);

        // Fractal Tools pass { tool, inputs, accountContext } so the adapter compiles the Deployment.
        // Legacy tools continue to receive the flat merged-inputs blob.
        // Gate: fractal tools require the compiler feature flag to be enabled for this account.
        let runInfo;
        if (isFractalTool(tool)) {
            const accountContext = { masterAccountId: originalContext.masterAccountId };
            if (!isFractalCompilerEnabled(tool, accountContext)) {
                throw new Error(
                    `[AdapterCoordinator] Fractal compiler not enabled for tool ${tool.toolId} / account ${originalContext.masterAccountId}. ` +
                    `Set NOEMAPLANE_COMPILER_ENABLED=1 or add to NOEMAPLANE_COMPILER_TOOLS + NOEMAPLANE_COMPILER_ALLOWLIST.`
                );
            }
            this.logger.debug(`[AdapterCoordinator] Calling adapter.startJob() (fractal) tool=${tool.toolId} jobId=${generationId}`);
            runInfo = await adapter.startJob({
                tool,
                inputs,
                accountContext: { masterAccountId: originalContext.masterAccountId },
                jobId: generationId.toString(),
            });
        } else {
            // Merge defaultAdapterParams and costTable from tool metadata before calling startJob
            const jobInputs = {
                ...(tool.metadata?.defaultAdapterParams || {}),
                ...inputs,
                // Pass costTable for DALL-E tools so adapter can calculate actual cost
                ...(tool.metadata?.costTable && { costTable: tool.metadata.costTable })
            };
            this.logger.debug(`[AdapterCoordinator] Calling adapter.startJob() with inputs: ${JSON.stringify(jobInputs)}`);
            runInfo = await adapter.startJob(jobInputs);
        }
        this.logger.debug(`[AdapterCoordinator] adapter.startJob() returned runId: ${runInfo?.runId}`);

        // Update generation record with runId
        try {
            await this.generationRecordManager.updateGenerationRecord(generationId, {
                'metadata.run_id': runInfo.runId
            });
            this.logger.debug(`[AdapterCoordinator] Updated generation ${generationId} with run_id ${runInfo.runId}`);
        } catch (updateErr) {
            this.logger.error(`[AdapterCoordinator] Failed to update generation ${generationId} with run_id:`, updateErr.message);
            // Don't throw - webhook processor can still find by run_id in metadata
        }

        return {
            generationId,
            runId: runInfo.runId,
            isNewSession: runInfo.isNewSession ?? false,
            runInfo
        };
    }

    /**
     * Creates an async adapter job and starts polling
     * @param {Object} tool - Tool definition
     * @param {Object} inputs - Tool inputs
     * @param {Object} executionContext - Execution context
     * @param {Object} dependencies - Dependencies
     * @param {Function} normalizeOutput - Output normalization function
     * @returns {Promise<Object>} - Execution result
     */
    async createAsyncJob(tool, inputs, executionContext, dependencies, normalizeOutput) {
        this.logger.debug(`[AdapterCoordinator] createAsyncJob called for tool ${tool.toolId}`);
        try {
            const result = await this.executeWithAdapter(tool, inputs, executionContext, dependencies);
            this.logger.debug(`[AdapterCoordinator] executeWithAdapter completed. GenID: ${result.generationId}, RunId: ${result.runId}`);

            // Notify the user immediately so cold starts don't look like a hung spinner.
            if (this.workflowNotifier) {
                const liveStatus = result.isNewSession
                    ? '❄️ Warming GPU (~7-9 min)…'
                    : '⚡ Running…';
                await this.workflowNotifier.notifyStepProgress(executionContext, result.generationId, tool, {
                    progress: result.isNewSession ? 0.05 : 0.4,
                    status: 'running',
                    liveStatus,
                }).catch(err => this.logger.warn(`[AdapterCoordinator] notifyStepProgress failed: ${err.message}`));
            }

            const adapter = this.adapterRegistry.get(tool.service);
            if (!adapter) {
                throw new Error(`Adapter not found for service ${tool.service}`);
            }

            // Start polling for async adapter jobs
            this.logger.debug(`[AdapterCoordinator] Starting polling for generation ${result.generationId}, runId ${result.runId}`);
            await this.asyncJobPoller.startPolling(
                result.generationId,
                result.runId,
                adapter,
                {
                    maxAttempts: 60,
                    pollInterval: 5000,
                    normalizeOutput: normalizeOutput
                }
            );

            this.logger.debug(`[AdapterCoordinator] Started async job via adapter. GenID: ${result.generationId}, RunId: ${result.runId}`);

            return {
                generationId: result.generationId,
                runId: result.runId,
                status: 'processing',
                pollingRequired: true
            };
        } catch (error) {
            this.logger.error(`[AdapterCoordinator] Error in createAsyncJob for tool ${tool.toolId}: ${error.stack || error}`);
            throw error;
        }
    }

    /**
     * Handles immediate tools (no adapter needed)
     * @param {Object} tool - Tool definition
     * @returns {boolean} - True if tool is immediate and should skip adapter path
     */
    shouldSkipAdapter(tool) {
        return tool.deliveryMode === 'immediate';
    }

    /**
     * Checks if adapter supports async jobs
     * @param {Object} tool - Tool definition
     * @returns {boolean} - True if adapter supports async jobs
     */
    adapterSupportsAsyncJobs(tool) {
        const adapter = this.adapterRegistry.get(tool.service);
        return adapter && typeof adapter.startJob === 'function';
    }

    /**
     * Derives a `{ amount, unit }` cost rate from a tool's costingModel.
     * Mirrors the logic in generationExecutionService.execute() so spell-step
     * generation records carry the same `metadata.costRate` shape that the
     * comfydeploy webhook processor uses to compute and debit cost.
     *
     * @private
     * @param {Object} tool - Tool definition with costingModel
     * @param {Object} [inputs] - Resolved tool inputs (used for costTable lookups)
     * @returns {{ amount: number, unit: string }|null}
     */
    _computeCostRate(tool, inputs) {
        const costingModel = tool?.costingModel;
        if (!costingModel || !costingModel.rateSource) return null;

        try {
            if (costingModel.rateSource === 'machine') {
                if (typeof costingModel.rate === 'number' && costingModel.unit) {
                    return { amount: costingModel.rate, unit: costingModel.unit };
                }
                return null;
            }
            if (costingModel.rateSource === 'fixed' && costingModel.fixedCost) {
                return {
                    amount: costingModel.fixedCost.amount,
                    unit: costingModel.fixedCost.unit,
                };
            }
            if (costingModel.rateSource === 'static' && costingModel.staticCost) {
                let staticAmount = costingModel.staticCost.amount;
                if (staticAmount === 0 && tool.metadata?.costTable) {
                    const ci = inputs || {};
                    const m = ci.model || tool.metadata.model || 'dall-e-3';
                    const sz = ci.size || '1024x1024';
                    const q = ci.quality || 'standard';
                    const price = tool.metadata.costTable?.[m]?.[sz]?.[q];
                    if (price) staticAmount = price;
                }
                return { amount: staticAmount, unit: costingModel.staticCost.unit };
            }
        } catch (err) {
            this.logger.warn(`[AdapterCoordinator] _computeCostRate failed for tool ${tool?.toolId}: ${err.message}`);
        }
        return null;
    }
}

module.exports = AdapterCoordinator;

if (require.main === module) {
    (async () => {
        const { ObjectId } = require('mongodb');
        const failures = [];
        const noop = { debug: () => {}, warn: () => {}, error: () => {}, info: () => {} };

        const fractalTool = {
            toolId: 'runmake',
            service: 'runpod',
            spec: { imageId: 'runpod/pytorch', workflowTemplate: 'flux-schnell' },
        };
        const legacyTool = { toolId: 'dall-e', service: 'openai' };

        const fakeGenId = new ObjectId();
        const makeGenMgr = () => ({
            createGenerationRecord: async () => ({ generationId: fakeGenId }),
            updateGenerationRecord: async () => {},
        });
        const makePoller = () => ({ startPolling: async () => {} });
        const makeRegistry = (startJobFn) => ({
            get: () => ({ startJob: startJobFn }),
        });

        const makeContext = () => ({
            spell: { _id: 'spell1', toObject() { return {}; } },
            stepIndex: 0,
            pipelineContext: {},
            originalContext: {
                masterAccountId: new ObjectId().toString(),
                platform: 'telegram',
                castId: 'cast1',
            },
        });

        const originalEnv = { ...process.env };
        const resetEnv = () => {
            delete process.env.NOEMAPLANE_COMPILER_ENABLED;
            delete process.env.NOEMAPLANE_COMPILER_TOOLS;
            delete process.env.NOEMAPLANE_COMPILER_ALLOWLIST;
        };

        // A. Feature flag OFF → fractal tool throws
        {
            resetEnv();
            const coordinator = new AdapterCoordinator({
                logger: noop,
                adapterRegistry: makeRegistry(async () => ({ runId: 'r1', isNewSession: true })),
                generationRecordManager: makeGenMgr(),
                asyncJobPoller: makePoller(),
            });
            const err = await coordinator.executeWithAdapter(
                fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }
            ).then(() => null).catch(e => e.message);
            if (!err || !/not enabled/i.test(err)) {
                failures.push(`A: expected "not enabled" error, got: ${err}`);
            }
            console.log(`  A flag-off fractal guard: "${err?.slice(0, 80)}…"`);
        }

        // B. Feature flag ON → fractal path succeeds
        {
            resetEnv();
            process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
            let startJobArgs;
            const coordinator = new AdapterCoordinator({
                logger: noop,
                adapterRegistry: makeRegistry(async (args) => { startJobArgs = args; return { runId: 'r2', isNewSession: false }; }),
                generationRecordManager: makeGenMgr(),
                asyncJobPoller: makePoller(),
            });
            await coordinator.executeWithAdapter(fractalTool, { prompt: 'test' }, makeContext(), { eventId: new ObjectId().toString() });
            if (!startJobArgs?.tool) failures.push('B: fractal path should pass { tool } to startJob');
            if (!startJobArgs?.accountContext) failures.push('B: fractal path should pass accountContext');
            console.log(`  B flag-on fractal: startJob received tool=${startJobArgs?.tool?.toolId} accountContext=${!!startJobArgs?.accountContext}`);
        }

        // C. Legacy (non-fractal) tool bypasses feature flag check
        {
            resetEnv();
            let startJobArgs;
            const coordinator = new AdapterCoordinator({
                logger: noop,
                adapterRegistry: makeRegistry(async (args) => { startJobArgs = args; return { runId: 'r3' }; }),
                generationRecordManager: makeGenMgr(),
                asyncJobPoller: makePoller(),
            });
            const err = await coordinator.executeWithAdapter(
                legacyTool, { size: '1024x1024' }, makeContext(), { eventId: new ObjectId().toString() }
            ).then(() => null).catch(e => e.message);
            if (err) failures.push(`C: legacy tool should not throw, got: ${err}`);
            if (startJobArgs?.tool) failures.push('C: legacy path should NOT pass { tool } to startJob');
            console.log(`  C legacy bypasses flag: err=${err} hasTool=${!!startJobArgs?.tool}`);
        }

        // D. Cold-start notification fires with correct liveStatus
        {
            resetEnv();
            process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
            let capturedStatus;
            const notifier = {
                notifyStepProgress: async (ctx, genId, tool, opts) => { capturedStatus = opts.liveStatus; },
            };
            const coordinator = new AdapterCoordinator({
                logger: noop,
                adapterRegistry: makeRegistry(async () => ({ runId: 'r4', isNewSession: true })),
                generationRecordManager: makeGenMgr(),
                asyncJobPoller: makePoller(),
                workflowNotifier: notifier,
            });
            await coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null);
            if (!capturedStatus?.includes('❄️')) failures.push(`D: cold-start liveStatus should include ❄️, got: ${capturedStatus}`);
            console.log(`  D cold-start notification: "${capturedStatus}"`);
        }

        // E. Warm notification fires with ⚡
        {
            resetEnv();
            process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
            let capturedStatus;
            const notifier = {
                notifyStepProgress: async (ctx, genId, tool, opts) => { capturedStatus = opts.liveStatus; },
            };
            const coordinator = new AdapterCoordinator({
                logger: noop,
                adapterRegistry: makeRegistry(async () => ({ runId: 'r5', isNewSession: false })),
                generationRecordManager: makeGenMgr(),
                asyncJobPoller: makePoller(),
                workflowNotifier: notifier,
            });
            await coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null);
            if (!capturedStatus?.includes('⚡')) failures.push(`E: warm liveStatus should include ⚡, got: ${capturedStatus}`);
            console.log(`  E warm notification: "${capturedStatus}"`);
        }

        // F. No workflowNotifier → no crash
        {
            resetEnv();
            process.env.NOEMAPLANE_COMPILER_ENABLED = '1';
            const coordinator = new AdapterCoordinator({
                logger: noop,
                adapterRegistry: makeRegistry(async () => ({ runId: 'r6', isNewSession: true })),
                generationRecordManager: makeGenMgr(),
                asyncJobPoller: makePoller(),
            });
            const err = await coordinator.createAsyncJob(fractalTool, {}, makeContext(), { eventId: new ObjectId().toString() }, null)
                .then(() => null).catch(e => e.message);
            if (err) failures.push(`F: no notifier should not throw, got: ${err}`);
            console.log(`  F no-notifier: err=${err}`);
        }

        // Restore env
        for (const k of ['NOEMAPLANE_COMPILER_ENABLED', 'NOEMAPLANE_COMPILER_TOOLS', 'NOEMAPLANE_COMPILER_ALLOWLIST']) {
            if (originalEnv[k] === undefined) delete process.env[k];
            else process.env[k] = originalEnv[k];
        }

        if (failures.length) { console.error('FAIL:', failures.join('; ')); process.exit(1); }
        console.log('PASS: AdapterCoordinator');
    })().catch(err => { console.error('FAIL:', err.stack || err); process.exit(1); });
}

