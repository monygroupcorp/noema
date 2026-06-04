const { getPricingService } = require('./pricing');

class SpellsService {
    constructor({ logger, db, workflowExecutionService, spellPermissionsDb, creditService, spellMigrator, toolRegistry }) {
        this.logger = logger;
        this.db = db; // Contains spellsDb
        this.workflowExecutionService = workflowExecutionService;
        this.spellPermissionsDb = spellPermissionsDb;
        this.creditService = creditService; // Optional: for upfront payment charging
        this.spellMigrator = spellMigrator; // Optional: for auto-healing spells when tool schemas change
        // Optional: used by augmentExposedInputsIfEmpty to look up each
        // step's inputSchema so we can compute implicit exposed inputs for
        // legacy spells that were saved without any. Fall back to reading
        // the registry from spellMigrator so callers only need to inject one.
        this.toolRegistry = toolRegistry || spellMigrator?.toolRegistry || null;
    }

    /**
     * Compute implicit exposed inputs for a spell whose `exposedInputs`
     * field is empty. Walks each step, looks up the current tool schema,
     * and returns `[{nodeId, paramKey, type?}]` entries for every required input
     * that has neither a static value nor an upstream wire.
     *
     * Mirrors the client-side auto-expose logic in
     * src/platforms/web/frontend/src/sandbox/subgraph.js so existing spells
     * created before auto-expose shipped still get a sensible default.
     *
     * @private
     * @param {Object} spell
     * @returns {Array<{nodeId: string, paramKey: string, type?: string}>}
     */
    _computeImplicitExposedInputs(spell) {
        if (!spell || !Array.isArray(spell.steps) || spell.steps.length === 0) return [];
        if (!this.toolRegistry || typeof this.toolRegistry.getToolById !== 'function') return [];

        const exposed = [];
        for (const step of spell.steps) {
            const toolId = step.toolIdentifier || step.toolId;
            if (!toolId) continue;
            const tool = this.toolRegistry.getToolById(toolId);
            const schema = tool?.inputSchema || tool?.metadata?.inputSchema;
            if (!schema || typeof schema !== 'object') continue;

            const mappings = step.parameterMappings || {};
            const nodeId = step.id || step.stepId || step.nodeId;
            if (!nodeId) continue;
            for (const [paramKey, paramDef] of Object.entries(schema)) {
                if (!paramDef?.required) continue;
                if (mappings[paramKey]) continue; // already has a static or nodeOutput
                // Carry the param type so spell windows can render typed input anchors
                // (mirrors the client-side autoExpose in subgraph.js).
                exposed.push({ nodeId, paramKey, ...(paramDef.type && { type: paramDef.type }) });
            }
        }
        return exposed;
    }

    /**
     * If `spell.exposedInputs` is empty, compute implicit entries from the
     * spell's steps (required inputs with no mapping) and return a shallow
     * copy of the spell with those entries set. Returns the spell unchanged
     * otherwise. Never mutates the input.
     *
     * Used at both read time (so SpellPage can render a form) and cast time
     * (so the telegram `prompt` fall-through in SpellExecutor has something
     * to route to).
     *
     * @param {Object} spell
     * @returns {Object}
     */
    augmentExposedInputsIfEmpty(spell) {
        if (!spell) return spell;
        const current = spell.exposedInputs;
        if (Array.isArray(current) && current.length > 0) return spell;
        const implicit = this._computeImplicitExposedInputs(spell);
        if (implicit.length === 0) return spell;
        this.logger.debug(`[SpellsService] Augmenting spell "${spell.name || spell._id}" with ${implicit.length} implicit exposed inputs: ${JSON.stringify(implicit)}`);
        return { ...spell, exposedInputs: implicit };
    }

    /**
     * Finds and executes a spell.
     * @param {string} slug - The spell's slug.
     * @param {Object} context - Execution context { masterAccountId, parameterOverrides, ... }
     * @param {Object} castsDb - Optional casts database for creating cast records
     * @returns {Promise<any>} The final result of the spell execution.
     */
    async castSpell(slug, context, castsDb = null) {
        this.logger.debug(`[SpellsService] Attempting to cast spell with slug: "${slug}" for MAID ${context.masterAccountId}`);

        // 1. Find the spell
        let spell = await this.db.spells.findBySlug(slug);

        // If not found try direct name match (names are unique & act as slug)
        if(!spell){
            spell = await this.db.spells.findByName(slug);
            if(spell){
                this.logger.debug(`[SpellsService] Found spell by unique name fallback: ${spell.name}`);
            }
        }

        // If not found, try public slug lookup (for public spells)
        if (!spell) {
            spell = await this.db.spells.findByPublicSlug(slug);
            if (spell) {
                this.logger.debug(`[SpellsService] Found spell by public slug: ${spell.slug || spell.publicSlug}`);
            }
        }

        // If not found try by ObjectId (support legacy callers sending _id)
        if (!spell && require('mongodb').ObjectId.isValid(slug)) {
            spell = await this.db.spells.findById(slug);
            if (spell) {
                this.logger.debug(`[SpellsService] Found spell by ObjectId fallback: ${spell.slug}`);
            }
        }

        // If still not found and user is authenticated, try a partial match for spells owned by the user
        if (!spell && context.masterAccountId) {
            this.logger.debug(`[SpellsService] Exact slug "${slug}" not found. Trying partial match for user ${context.masterAccountId}.`);
            const possibleSpells = await this.db.spells.findSpellsByOwnerAndPartialSlug(context.masterAccountId, slug);
            
            if (possibleSpells.length === 1) {
                spell = possibleSpells[0];
                this.logger.debug(`[SpellsService] Found unique partial match: "${spell.slug}"`);
            } else if (possibleSpells.length > 1) {
                this.logger.warn(`[SpellsService] Ambiguous partial slug "${slug}" for user ${context.masterAccountId} matched ${possibleSpells.length} spells.`);
                const spellNames = possibleSpells.map(s => `• ${s.name} (\`${s.slug}\`)`).join('\\n');
                throw new Error(`Multiple spells found starting with "${slug}". Please be more specific:\n${spellNames}`);
            }
        }
        
        if (!spell) {
            this.logger.warn(`[SpellsService] Spell with slug "${slug}" not found for user ${context.masterAccountId}.`);
            throw new Error(`Spell "${slug}" not found.`);
        }

        // 1.5. Auto-heal: Migrate spell steps to current tool versions
        if (this.spellMigrator) {
            const { spell: migratedSpell, migrated, changes } = this.spellMigrator.migrate(spell);
            if (migrated) {
                this.logger.info(`[SpellsService] Auto-healed spell "${spell.name}": ${JSON.stringify(changes)}`);
                spell = migratedSpell;

                // Optionally persist the healed spell (unless explicitly disabled)
                if (context.persistMigration !== false) {
                    try {
                        await this.db.spells.updateSpell(spell._id, { steps: spell.steps });
                        this.logger.info(`[SpellsService] Persisted migrated spell "${spell.name}" to database.`);
                    } catch (persistError) {
                        this.logger.warn(`[SpellsService] Failed to persist migrated spell "${spell.name}": ${persistError.message}`);
                        // Continue execution even if persistence fails
                    }
                }
            }
        }

        // 1.6. Augment exposedInputs if empty — for spells created before
        // auto-expose shipped, or saved via an older client. Needed so the
        // telegram-cast "prompt → sole unset exposed input" fall-through in
        // SpellExecutor has something to route to.
        spell = this.augmentExposedInputsIfEmpty(spell);

        // 2. Check permissions
        const canCast = await this.checkPermissions(spell, context.masterAccountId);
        if (!canCast) {
            this.logger.warn(`[SpellsService] User ${context.masterAccountId} does not have permission to cast spell ${spell._id} ("${spell.name}").`);
            throw new Error('You do not have permission to cast this spell.');
        }

        // 2.5. Create cast record if not already provided
        let castId = context.castId;
        // Use castsDb parameter if provided, otherwise try to get it from this.db.casts
        const castsDbToUse = castsDb || this.db?.casts;
        if (!castId && castsDbToUse) {
            try {
                // Build metadata with webhook URL if provided
                const castMetadata = {};
                if (context.webhookUrl) {
                    castMetadata.webhookUrl = context.webhookUrl;
                    if (context.webhookSecret) {
                        castMetadata.webhookSecret = context.webhookSecret;
                    }
                    castMetadata.spellSlug = spell.slug || spell.name;
                }

                const newCast = await castsDbToUse.createCast({
                    spellId: spell._id.toString(), // Use spell._id instead of slug
                    initiatorAccountId: context.masterAccountId,
                    ...(context.agentAccountId && { agentAccountId: context.agentAccountId }),
                    metadata: castMetadata
                });
                castId = newCast._id.toString();
                context.castId = castId;
                this.logger.info(`[SpellsService] Created cast record ${castId} for spell ${spell._id}.`);
            } catch (e) {
                this.logger.warn(`[SpellsService] Cast creation failed for spell ${spell._id}:`, e.message);
            }
        } else if (!castId && !castsDbToUse) {
            this.logger.warn(`[SpellsService] No castsDb available and no castId provided. Cast tracking will be disabled for this spell execution.`);
        }

        // 2.6. Charge upfront payment if quote provided (for guest users or when explicitly requested)
        if (context.quote && context.chargeUpfront !== false && this.creditService) {
            try {
                const quote = context.quote;
                if (!quote.totalCostPts || typeof quote.totalCostPts !== 'number') {
                    throw new Error('Invalid quote: totalCostPts is required');
                }

                this.logger.info(`[SpellsService] Charging upfront payment of ${quote.totalCostPts} points for spell ${spell._id}`);
                
                const chargeResult = await this.creditService.chargeSpellExecution(
                    context.masterAccountId,
                    spell._id.toString(),
                    quote
                );
                
                context.creditTxId = chargeResult.creditTxId;
                context.pointsCharged = chargeResult.pointsCharged;
                context.castChargedUpfront = true;

                this.logger.info(`[SpellsService] Upfront payment successful: ${chargeResult.pointsCharged} points charged, creditTxId: ${chargeResult.creditTxId}`);
            } catch (error) {
                if (error.message === 'INSUFFICIENT_POINTS') {
                    this.logger.warn(`[SpellsService] Insufficient points for spell execution. User: ${context.masterAccountId}, Required: ${context.quote.totalCostPts}`);
                    throw new Error('Insufficient points to execute spell. Please purchase more points.');
                }
                this.logger.error(`[SpellsService] Failed to charge upfront payment:`, error);
                throw error;
            }
        }

        // 3. Execute the spell via WorkflowExecutionService
        // NOTE: WorkflowExecutionService now uses the centralized execution endpoint for all tool executions.
        this.logger.info(`[SpellsService] Permissions check passed. Handing off to WorkflowExecutionService for spell "${spell.name}". CastId: ${castId || 'none'}`);

        // Annotate context with the spell author so LoRA resolution can access private
        // models the author embedded in the spell without requiring the executor to hold
        // separate permissions for each one.
        context.spellAuthorAccountId = spell.ownedBy?.toString() || null;

        try {
            const result = await this.workflowExecutionService.execute(spell, context);
            this.logger.info(`[SpellsService] WorkflowExecutionService.execute() returned for spell "${spell.name}": ${JSON.stringify(result || 'undefined')}`);
            
            // 4. Increment usage count (fire and forget)
            this.db.spells.incrementUsage(spell._id).catch(err => {
                this.logger.error(`[SpellsService] Failed to increment usage for spell ${spell._id}: ${err.message}`);
            });

            return result;
        } catch (execError) {
            this.logger.error(`[SpellsService] Error executing spell "${spell.name}": ${execError.stack || execError}`);
            throw execError;
        }
    }

    async checkPermissions(spell, masterAccountId) {
        // Owner can always cast their own spells
        if (masterAccountId && spell.ownedBy && spell.ownedBy.toString() === masterAccountId.toString()) {
            return true;
        }

        // Handle visibility levels
        const visibility = spell.visibility || (spell.isPublic ? 'public' : 'private');

        switch (visibility) {
            case 'public':
                // Public spells can be cast by any authenticated user
                return true;

            case 'listed':
                // Listed (marketplace) spells require purchase/license
                if (!masterAccountId) return false;
                const hasLicense = await this.spellPermissionsDb.hasAccess(masterAccountId, spell._id);
                return !!hasLicense;

            case 'private':
            default:
                // Private spells - only owner (already checked above)
                return false;
        }
    }

    async quoteSpell(spellIdentifier, { sampleSize = 10 } = {}) {
        // Accept either slug or ObjectId string as spellIdentifier
        this.logger.info(`[SpellsService] Generating quote for spell "${spellIdentifier}" (sampleSize=${sampleSize}).`);

        // 1. Fetch the spell metadata
        let spell;
        if (require('mongodb').ObjectId.isValid(spellIdentifier)) {
            spell = await this.db.spells.findById(spellIdentifier);
        } else {
            spell = await this.db.spells.findBySlug(spellIdentifier);
            if (!spell) {
                spell = await this.db.spells.findByPublicSlug(spellIdentifier);
            }
        }

        if (!spell) {
            throw new Error(`Spell \"${spellIdentifier}\" not found.`);
        }

        const steps = Array.isArray(spell.steps) ? spell.steps : [];
        if (steps.length === 0) {
            throw new Error('Spell contains no steps – cannot generate quote.');
        }

        const generationOutputsDb = this.db.generationOutputs;
        if (!generationOutputsDb || typeof generationOutputsDb.aggregate !== 'function') {
            throw new Error('GenerationOutputsDB is not available – cannot generate quote.');
        }

        const pricingService = getPricingService(this.logger);

        // Pre-fetch historical stats once per unique toolId to avoid redundant DB queries
        // when a spell repeats the same tool across multiple steps.
        const uniqueToolIds = [...new Set(
            steps.map(s => s.toolIdentifier || s.toolId).filter(Boolean)
        )];

        const historyCache = {};
        await Promise.all(uniqueToolIds.map(async (toolId) => {
            const [stats] = await generationOutputsDb.aggregate([
                { $match: {
                    $or: [
                        { toolId },
                        { toolDisplayName: toolId },
                        { serviceName: toolId }
                    ],
                    status: 'completed',
                    durationMs: { $exists: true, $ne: null, $gt: 0 }
                }},
                { $sort: { responseTimestamp: -1, requestTimestamp: -1 } },
                { $limit: sampleSize },
                { $group: {
                    _id: null,
                    count:         { $sum: 1 },
                    avgDurationMs: { $avg: '$durationMs' },
                    // Also average actual billed cost — used as fallback when
                    // toolRegistry rate is unavailable (e.g. tool re-registered
                    // with different ID, or rate lookup failed at startup).
                    // Billing is accurate post-webhook fix (2026-05-11).
                    avgCostUsd:    { $avg: { $toDouble: '$costUsd' } },
                    billedCount:   { $sum: { $cond: [{ $gt: [{ $toDouble: '$costUsd' }, 0] }, 1, 0] } },
                }}
            ]);
            historyCache[toolId] = stats || null;
        }));

        const breakdown = [];
        let totalRuntimeMs = 0;
        let totalCostPts = 0;

        for (const step of steps) {
            const toolId = step.toolIdentifier || step.toolId;
            if (!toolId) {
                this.logger.warn(`[SpellsService] Step ${step.stepId || '<unknown>'} missing toolIdentifier/toolId – skipping.`);
                continue;
            }

            const toolDef = this.toolRegistry?.getToolById(toolId) ?? null;
            const costingModel = toolDef?.costingModel ?? null;
            const serviceName = toolDef?.service || 'comfyui';

            const hist = historyCache[toolId];
            const avgDurationMs = hist?.avgDurationMs || 0;
            const historicalCostUsd = (hist?.billedCount > 0) ? (hist.avgCostUsd || 0) : 0;

            if (!hist || hist.count === 0) {
                this.logger.warn(`[SpellsService] No history for tool "${toolId}".`);
            }

            // Resolve compute cost with priority:
            //   1. Static cost from costingModel (joycaption, ltx-video, etc.)
            //   2. Rate × duration from costingModel (comfy tools via toolRegistry)
            //   3. Historical avgCostUsd (fallback when toolRegistry rate is unavailable)
            let computeCostUsd = 0;
            let rateSource = 'none';

            if (costingModel) {
                if (costingModel.rateSource === 'static' && costingModel.staticCost?.amount > 0) {
                    // Static-cost tools store price in staticCost.amount, not costingModel.rate
                    computeCostUsd = costingModel.staticCost.amount;
                    rateSource = 'static';
                } else if (typeof costingModel.rate === 'number' && costingModel.rate > 0) {
                    const unit = costingModel.unit?.toLowerCase();
                    if (unit === 'second' || unit === 'seconds') {
                        const estimatedSec = avgDurationMs > 0 ? avgDurationMs / 1000 : 30;
                        computeCostUsd = costingModel.rate * estimatedSec;
                        rateSource = 'rate×duration';
                    } else {
                        computeCostUsd = costingModel.rate;
                        rateSource = 'rate×fixed';
                    }
                }
            }

            // Fallback: if costingModel gave nothing, use historical avgCostUsd.
            // This handles comfy tools where toolRegistry rate lookup failed at
            // startup, or tools that have been re-keyed since last registration.
            if (computeCostUsd === 0 && historicalCostUsd > 0) {
                computeCostUsd = historicalCostUsd;
                rateSource = 'historical-costUsd';
            }

            // Only apply platform markup and minimum charge when there is actual
            // compute cost. Zero-cost orchestration tools (primitives, expressions,
            // string ops) should not inflate the quote with minimum-charge noise.
            let avgCostPts = 0;
            if (computeCostUsd > 0) {
                const quote = pricingService.getQuote({ computeCostUsd, serviceName, isMs2User: false, toolId });
                avgCostPts = quote.totalPoints;
                this.logger.info(`[SpellsService] Quote "${toolId}": $${computeCostUsd.toFixed(6)} [${rateSource}] × ${quote.multiplier}x = ${avgCostPts}pts (avgDurMs=${avgDurationMs.toFixed(0)})`);
            } else {
                this.logger.info(`[SpellsService] Quote "${toolId}": no compute cost [${rateSource}] – 0pts`);
            }

            breakdown.push({ toolId, avgRuntimeMs: avgDurationMs, avgCostPts });
            totalRuntimeMs += avgDurationMs;
            totalCostPts += avgCostPts;
        }

        // Last-resort fallback: if every step had no data and no static cost,
        // return the cached quote from the spell document rather than 0.
        if (totalCostPts === 0 && spell.avgCostPtsCached > 0) {
            this.logger.warn(`[SpellsService] Live quote yielded 0 pts for "${spellIdentifier}" – falling back to cached ${spell.avgCostPtsCached} pts`);
            return {
                spellId: spell._id,
                totalRuntimeMs: spell.avgRuntimeMsCached || 0,
                totalCostPts: Math.ceil(spell.avgCostPtsCached),
                breakdown: [],
                fromCache: true,
            };
        }

        return {
            spellId: spell._id,
            totalRuntimeMs,
            totalCostPts,
            breakdown
        };
    }
}

module.exports = SpellsService; 