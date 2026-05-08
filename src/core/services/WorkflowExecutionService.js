/**
 * WorkflowExecutionService - Thin facade for workflow execution
 * 
 * This service orchestrates spell execution by delegating to specialized services:
 * - SpellExecutor: Spell-level orchestration
 * - StepExecutor: Step execution using Execution Strategy pattern
 * - StepContinuator: Step continuation and output processing
 * 
 * Architecture:
 * - Management: CastManager, GenerationRecordManager, CostAggregator
 * - Execution: SpellExecutor, StepExecutor, ParameterResolver, Execution Strategies
 * - Continuation: StepContinuator, OutputProcessor, PipelineContextBuilder
 * - Adapters: AdapterCoordinator, AsyncJobPoller
 * - Notifications: WorkflowNotifier
 * 
 * Public API (maintained for backward compatibility):
 * - execute(spell, context): Start spell execution
 * - continueExecution(completedGeneration): Continue after step completion
 */

const CastManager = require('./workflow/management/CastManager');
const GenerationRecordManager = require('./workflow/management/GenerationRecordManager');
const CostAggregator = require('./workflow/management/CostAggregator');
const { generationService } = require('./store/generations/GenerationService');
const StepExecutor = require('./workflow/execution/StepExecutor');
const SpellExecutor = require('./workflow/execution/SpellExecutor');
const StepContinuator = require('./workflow/continuation/StepContinuator');
const AsyncJobPoller = require('./workflow/adapters/AsyncJobPoller');
const AdapterCoordinator = require('./workflow/adapters/AdapterCoordinator');
const WorkflowNotifier = require('./workflow/notifications/WorkflowNotifier');

class WorkflowExecutionService {
    constructor({ logger, toolRegistry, comfyUIService, internalApiClient, db, workflowsService, spellService, generationExecutionService }) {
        this.logger = logger;
        this.toolRegistry = toolRegistry;
        this.internalApiClient = internalApiClient;
        // Note: comfyUIService, db are kept for backward compatibility but may not be used
        this.comfyuiService = comfyUIService;
        this.db = db;
        this.workflowsService = workflowsService;

        // Initialize management services
        this.castManager = new CastManager({ logger, spellService });
        this.generationRecordManager = new GenerationRecordManager({ logger, generationService, internalApiClient });
        this.costAggregator = new CostAggregator({ logger, generationService, internalApiClient });
        
        // Initialize adapter and notification services
        const adapterRegistry = require('./adapterRegistry');

        // Register ComfyDeploy adapter so WebhookStrategy is selected for comfyui tools
        if (comfyUIService) {
            const ComfyDeployAdapter = require('./comfydeploy/comfyDeployAdapter');
            adapterRegistry.register('comfyui', new ComfyDeployAdapter(comfyUIService));
        }

        // Register RunPod adapter: Compiler + SessionManager + GenerationRunner
        const { GenerationRunner, WorkflowTemplateRegistry, Compiler, SessionManager, SessionRecovery } = require('./runpod');
        const RunPodAdapter = require('./runpod/RunPodAdapter');
        const workflowTemplates = new WorkflowTemplateRegistry({ logger });
        const compiler = new Compiler({ workflowTemplates, logger });
        const generationRunner = new GenerationRunner({ logger });
        const sessionStore = db && db.runpodSessions ? db.runpodSessions : null;
        const sessionManager = new SessionManager({ logger, sessionStore });
        adapterRegistry.register('runpod', new RunPodAdapter({ generationRunner, compiler, sessionManager, logger }));

        // Fire-and-forget: recover live sessions from DB after process restart.
        // Early requests cold-start normally; recovered sessions become available once probing completes.
        if (sessionStore) {
            const sessionRecovery = new SessionRecovery({ logger });
            sessionRecovery.recover(sessionManager, generationRunner.service, sessionStore)
                .catch(err => logger.error(`[WorkflowExecutionService] Session recovery failed: ${err.message}`));
        }

        this.asyncJobPoller = new AsyncJobPoller({
            logger,
            generationRecordManager: this.generationRecordManager
        });
        this.workflowNotifier = new WorkflowNotifier({ logger });
        this.adapterCoordinator = new AdapterCoordinator({
            logger,
            adapterRegistry,
            generationRecordManager: this.generationRecordManager,
            asyncJobPoller: this.asyncJobPoller,
            workflowNotifier: this.workflowNotifier
        });
        
        // Initialize execution services
        this.stepExecutor = new StepExecutor({
            logger,
            toolRegistry,
            workflowsService,
            internalApiClient,
            userEventsDb: db && db.userEvents ? db.userEvents : null, // Phase 7a: direct DB for event creation
            adapterRegistry,
            generationRecordManager: this.generationRecordManager,
            adapterCoordinator: this.adapterCoordinator,
            workflowNotifier: this.workflowNotifier,
            generationExecutionService: generationExecutionService || null, // Phase 8
        });
        this.spellExecutor = new SpellExecutor({
            logger,
            stepExecutor: this.stepExecutor
        });
        
        // Initialize continuation services
        this.stepContinuator = new StepContinuator({
            logger,
            castManager: this.castManager,
            generationRecordManager: this.generationRecordManager,
            costAggregator: this.costAggregator,
            stepExecutor: this.stepExecutor
        });
    }

    /**
     * Kicks off the execution of a spell.
     * This method is fire-and-forget. It starts the first step, and the
     * NotificationDispatcher will drive the rest of the execution.
     * @param {object} spell - The spell document.
     * @param {object} context - The initial execution context from the /cast command.
     */
    async execute(spell, context) {
        // Delegate to SpellExecutor
        await this.spellExecutor.execute(spell, context);
    }

    /**
     * Called by the NotificationDispatcher when a spell step is complete.
     * It processes the output and triggers the next step or finalizes the spell.
     * @param {object} completedGeneration - The completed generation record for the step.
     */
    async continueExecution(completedGeneration) {
        // Delegate to StepContinuator - handles all continuation logic
        await this.stepContinuator.continue(completedGeneration);
    }
}

module.exports = WorkflowExecutionService; 