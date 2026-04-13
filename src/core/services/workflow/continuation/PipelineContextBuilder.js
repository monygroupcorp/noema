/**
 * PipelineContextBuilder - Builds and manages pipeline context
 * 
 * Handles pipeline context accumulation and merging for multi-step spells.
 */

class PipelineContextBuilder {
    constructor({ logger }) {
        this.logger = logger;
    }

    /**
     * Accumulates step generation IDs
     * @param {Object} pipelineContext - Current pipeline context
     * @param {string} generationId - New generation ID to add
     * @returns {string[]} - Accumulated step generation IDs
     */
    accumulateStepGenerationIds(pipelineContext, generationId) {
        if (!generationId) {
            throw new Error('Generation record missing _id');
        }

        // Get previous step generation IDs with validation
        let previousStepGenIds = [];
        if (pipelineContext && Array.isArray(pipelineContext.stepGenerationIds)) {
            previousStepGenIds = pipelineContext.stepGenerationIds;
        } else if (pipelineContext && pipelineContext.stepGenerationIds) {
            this.logger.warn(`[PipelineContextBuilder] pipelineContext.stepGenerationIds is not an array, resetting`);
        }

        const stepGenerationIds = [...previousStepGenIds, generationId];
        return stepGenerationIds;
    }

    /**
     * Builds the next pipeline context by merging current context with
     * explicitly-mapped inputs for the next step.
     *
     * NOTE: we intentionally do NOT spread the raw `stepOutput` at the top
     * level here. Doing so caused output keys like `text` / `result` from an
     * expression or primitive step to leak into every matching string field
     * on the next step via InputParameterNormalizer's aggressive variation
     * list — e.g. an expression wired only to `input_prompt` would also end
     * up filling `input_text` and `input_prompt_negative` with the same
     * value. Downstream steps reach previous outputs through explicit
     * `nodeOutput` parameterMappings, which resolve from the namespaced
     * `${nodeId}_${outputKey}` keys that `OutputProcessor.mapOutput` puts
     * into `next_inputs`.
     *
     * @param {Object} pipelineContext - Current pipeline context
     * @param {Object} stepOutput - Output from current step (kept in the
     *     signature for call-site symmetry / future diagnostics, but no
     *     longer merged at top level — see note above).
     * @param {Object} next_inputs - Mapped inputs for next step
     * @returns {Object} - Next pipeline context
     */
    buildNextPipelineContext(pipelineContext, stepOutput, next_inputs) {
        return { ...pipelineContext, ...next_inputs };
    }

    /**
     * Merges pipeline context with additional data
     * @param {Object} pipelineContext - Base pipeline context
     * @param {Object} additionalData - Additional data to merge
     * @returns {Object} - Merged pipeline context
     */
    mergeContexts(pipelineContext, additionalData) {
        return { ...pipelineContext, ...additionalData };
    }
}

module.exports = PipelineContextBuilder;

