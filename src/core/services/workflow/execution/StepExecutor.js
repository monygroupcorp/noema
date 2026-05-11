/**
 * StepExecutor - Executes a single step of a spell
 * 
 * Uses Execution Strategy pattern - NO service-specific conditionals!
 */

const { validateStepIndex, validateStep, validateTool } = require('../utils/ValidationUtils');
const { createEvent } = require('../utils/EventManager');
const ParameterResolver = require('./ParameterResolver');
const StrategyFactory = require('./strategies/StrategyFactory');

const MAX_SPELL_DEPTH = 5;

class StepExecutor {
    constructor({ logger, toolRegistry, workflowsService, internalApiClient, userEventsDb, adapterRegistry, generationRecordManager, adapterCoordinator, workflowNotifier, generationExecutionService, spellsDb, castManager }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.workflowsService = workflowsService;
        this.internalApiClient = internalApiClient;
        // userEventsDb preferred for event creation; falls back to internalApiClient
        this.userEventsDb = userEventsDb || null;
        this.adapterRegistry = adapterRegistry;
        this.generationRecordManager = generationRecordManager;
        this.generationExecutionService = generationExecutionService || null;
        this.spellsDb = spellsDb || null;
        this.castManager = castManager || null;

        // Initialize sub-services
        this.parameterResolver = new ParameterResolver({ logger });
        this.adapterCoordinator = adapterCoordinator;
        this.workflowNotifier = workflowNotifier;
        this.strategyFactory = new StrategyFactory({
            logger,
            adapterRegistry,
            adapterCoordinator,
            workflowNotifier,
            generationExecutionService: this.generationExecutionService, // Phase 8
        });
    }

    /**
     * Executes a single step of a spell
     * @param {Object} spell - Spell definition
     * @param {number} stepIndex - Step index
     * @param {Object} pipelineContext - Pipeline context
     * @param {Object} originalContext - Original execution context
     * @returns {Promise<any>} - Execution result
     */
    async executeStep(spell, stepIndex, pipelineContext, originalContext) {
        // Validate step
        validateStepIndex(stepIndex, spell.steps.length, spell.name);
        const step = spell.steps[stepIndex];
        validateStep(step, stepIndex, spell.name);

        // Route spell-call steps before any tool lookup
        if (step.spellRef) {
            return await this._executeSpellCallStep(spell, step, stepIndex, pipelineContext, originalContext);
        }

        // Resolve tool
        let tool = this.toolRegistry.findByDisplayName(step.toolIdentifier);
        if (!tool) {
            tool = this.toolRegistry.getToolById(step.toolIdentifier);
        }
        validateTool(tool, step.toolIdentifier, step.stepId, stepIndex, spell.name);

        this.logger.debug(`[StepExecutor] Executing Step ${stepIndex + 1}/${spell.steps.length}: ${tool.displayName}`);

        // Create event FIRST (required for initiatingEventId in generation records)
        // Use userEventsDb directly if available (Phase 7a), fall back to internalApiClient
        const { eventId } = await createEvent(
            'spell_step_triggered',
            originalContext,
            { spellId: spell._id, stepId: step.stepId, toolId: tool.toolId },
            this.userEventsDb || this.internalApiClient
        );
        this.logger.debug(`[StepExecutor] Created event ${eventId} for spell step ${stepIndex + 1}`);

        // Resolve parameters
        const stepInput = this.parameterResolver.resolveStepInputs(step, pipelineContext, tool);

        // Validate required inputs
        const missing = this.parameterResolver.validateRequiredInputs(tool, stepInput);
        if (missing.length) {
            this.logger.warn(`[StepExecutor] Missing required inputs for tool '${tool.displayName}' (step ${step.stepId} of spell '${spell.name}'): ${missing.join(', ')}`);
            // TODO: emit metric 'spell_missing_input' with tags { toolId, spellId }
        }

        // Prepare tool run payload (may include LoRA resolution, etc.)
        const { inputs: finalInputs, loraResolutionData } = await this.workflowsService.prepareToolRunPayload(
            tool.toolId,
            stepInput,
            originalContext.masterAccountId,
            { internal: { client: this.internalApiClient } }
        );

        // Get execution strategy (from tool definition or factory)
        const strategy = tool.executionStrategy || this.strategyFactory.createDefaultStrategy(tool);

        // Build execution context
        const executionContext = {
            tool,
            spell,
            stepIndex,
            pipelineContext,
            originalContext,
            loraResolutionData
        };

        // Prepare dependencies
        const dependencies = {
            adapter: this.adapterRegistry.get(tool.service),
            internalApiClient: this.internalApiClient,
            generationRecordManager: this.generationRecordManager,
            workflowNotifier: this.workflowNotifier,
            eventId: eventId
        };

        // Execute using strategy - NO CONDITIONALS!
        try {
            const result = await strategy.execute(finalInputs, executionContext, dependencies);

            // Handle response if completed
            if (result.status === 'completed' && strategy.handleResponse) {
                await strategy.handleResponse(result, executionContext, dependencies);
            }

            return result;
        } catch (error) {
            // Handle error using strategy
            if (strategy.handleError) {
                const errorResult = await strategy.handleError(error, executionContext, dependencies);
                if (errorResult.handled) {
                    // Error handled by strategy, return early
                    return { status: 'failed', handled: true };
                }
            }
            // Re-throw if not handled
            throw error;
        }
    }
    /**
     * Handles a spell-call step (spellRef set on the step).
     * Creates a synthetic generation record as the join-point between the parent and sub-spell,
     * then fires the sub-spell's first step. The parent is suspended until
     * StepContinuator._finalizeSubCast() resolves the synthetic gen.
     * @private
     */
    async _executeSpellCallStep(parentSpell, step, stepIndex, pipelineContext, originalContext) {
        if (!this.spellsDb) throw new Error('[StepExecutor] spellsDb required for spell-call steps');
        if (!this.castManager) throw new Error('[StepExecutor] castManager required for spell-call steps');

        // 1. Load sub-spell
        const subSpell = await this.spellsDb.findBySlug(step.spellRef);
        if (!subSpell) {
            throw Object.assign(new Error(`Sub-spell not found: "${step.spellRef}"`), { code: 'SPELL_NOT_FOUND' });
        }

        // 2. Circular reference + depth guard
        const activeSet = new Set(originalContext.activeSpellSlugs || []);
        if (activeSet.has(step.spellRef)) {
            throw Object.assign(
                new Error(`Circular spell reference detected: "${step.spellRef}" is already in the call stack`),
                { code: 'CIRCULAR_SPELL_REF' }
            );
        }
        if (activeSet.size >= MAX_SPELL_DEPTH) {
            throw Object.assign(
                new Error(`Max spell nesting depth (${MAX_SPELL_DEPTH}) exceeded`),
                { code: 'MAX_DEPTH_EXCEEDED' }
            );
        }

        // 3. Resolve sub-spell inputs — treat exposedInputs as the schema boundary
        const inputSchema = this._exposedInputsToSchema(subSpell.exposedInputs || []);
        const subInputs = this.parameterResolver.resolveStepInputs(step, pipelineContext, { inputSchema });

        // 4. Create synthetic generation record (the join point for parent spell continuation)
        const parentCastId = pipelineContext.castId || originalContext.castId;
        const { generationId: syntheticGenId } = await this.generationRecordManager.createGenerationRecord({
            masterAccountId: originalContext.masterAccountId,
            serviceName: 'spell-composer',
            toolId: `spell-call:${step.spellRef}`,
            toolDisplayName: subSpell.name,
            status: 'processing',
            costUsd: 0,
            requestPayload: subInputs,
            metadata: {
                // Fields StepContinuator.continue() needs to resume the PARENT spell
                isSpell: true,
                spell: parentSpell,
                stepIndex,
                pipelineContext,
                originalContext,
                castId: parentCastId,
                // Sub-spell tracking
                isSubSpellBoundary: true,
                subSpellSlug: step.spellRef,
                subSpellOutputMappings: step.outputMappings || {},
            },
        });

        // 5. Create sub-cast so sub-spell steps have dedup/cost tracking
        const subCast = await this.castManager.createSubCast({
            spellId: subSpell._id.toString(),
            initiatorAccountId: originalContext.masterAccountId,
            parentCastId,
            syntheticGenId: syntheticGenId.toString(),
        });
        const subCastId = subCast._id.toString();

        // 6. Build sub-spell execution context
        const subOriginalContext = {
            ...originalContext,
            parameterOverrides: subInputs,
            activeSpellSlugs: [...activeSet, step.spellRef],
            isSubSpell: true,
            parentCastId,
            syntheticGenId: syntheticGenId.toString(),
            castId: subCastId,
        };
        const initialSubPipelineContext = { ...subInputs, castId: subCastId };

        this.logger.info(`[StepExecutor] Dispatching sub-spell "${step.spellRef}" (syntheticGen: ${syntheticGenId}, subCast: ${subCastId})`);

        // 7. Fire sub-spell step 0 — fire-and-forget; parent suspended until synthetic gen resolves
        await this.executeStep(subSpell, 0, initialSubPipelineContext, subOriginalContext);

        return { status: 'processing', syntheticGenId };
    }

    /**
     * Converts a spell's exposedInputs array into an inputSchema-compatible object
     * so ParameterResolver can validate/prune inputs the same way it does for tools.
     * @private
     */
    _exposedInputsToSchema(exposedInputs) {
        const schema = {};
        for (const inp of exposedInputs) {
            const key = typeof inp === 'string' ? inp : inp?.paramKey;
            if (key) schema[key] = { required: false, type: 'any' };
        }
        return schema;
    }
}

module.exports = StepExecutor;

