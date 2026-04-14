/**
 * SpellExecutor - Orchestrates spell-level execution
 * 
 * Handles spell initialization and delegates to StepExecutor.
 */

const StepExecutor = require('./StepExecutor');

class SpellExecutor {
    constructor({ logger, stepExecutor }) {
        this.logger = logger;
        this.stepExecutor = stepExecutor;
    }

    /**
     * Executes a spell starting from the first step
     * @param {Object} spell - Spell definition
     * @param {Object} context - Initial execution context from /cast command
     * @returns {Promise<void>}
     */
    async execute(spell, context) {
        this.logger.info(`[SpellExecutor] Starting execution for spell: "${spell.name}" (ID: ${spell._id})`);

        // Normalize the 'prompt' parameter to 'input_prompt' for consistency
        if (context.parameterOverrides && context.parameterOverrides.prompt && !context.parameterOverrides.input_prompt) {
            this.logger.debug('[SpellExecutor] Adding alias "input_prompt" for provided "prompt" input.');
            context.parameterOverrides.input_prompt = context.parameterOverrides.prompt;
            // Keep original 'prompt' key so tools that expect it still work
        }

        // Route text-command free text into the spell's exposed inputs.
        //
        // Text-command casters (e.g. Telegram `/cast <slug> <free text>`)
        // dump their whole argument into `parameterOverrides.prompt` because
        // the command has no way to know the spell's paramKeys. A spell
        // that exposes a primitive's `value` input (or any non-`prompt`
        // paramKey) would otherwise fail at the first step with a missing
        // required input, since nothing ever lands on the exposed key.
        //
        // Policy: if exactly one exposed input is still unset, fall the
        // caster's `prompt` through to it. With multiple unset exposed
        // inputs we bail out with a warning — the caster must use explicit
        // `key=value` syntax to disambiguate, otherwise we'd silently
        // broadcast the same text to every field.
        if (
            context.parameterOverrides &&
            context.parameterOverrides.prompt &&
            Array.isArray(spell.exposedInputs) &&
            spell.exposedInputs.length > 0
        ) {
            // Normalize exposedInputs — legacy spells stored them as a
            // string array, current schema uses `{nodeId, paramKey}` objects.
            const exposedKeys = spell.exposedInputs
                .map(inp => (typeof inp === 'string' ? inp : inp?.paramKey))
                .filter(Boolean);

            const isUnset = (key) => {
                const v = context.parameterOverrides[key];
                return v === undefined || v === null || v === '';
            };
            const unsetKeys = exposedKeys.filter(isUnset);

            if (unsetKeys.length === 1) {
                const target = unsetKeys[0];
                context.parameterOverrides[target] = context.parameterOverrides.prompt;
                this.logger.debug(`[SpellExecutor] Routed caster "prompt" to sole unset exposed input "${target}" for spell "${spell.name}".`);
            } else if (unsetKeys.length > 1) {
                this.logger.warn(`[SpellExecutor] Caster provided "prompt" but spell "${spell.name}" has ${unsetKeys.length} unset exposed inputs (${unsetKeys.join(', ')}). Use explicit key=value syntax to fill each one.`);
            }
        }

        // The initial pipeline context starts with the global parameters from the /cast command
        const initialPipelineContext = { ...context.parameterOverrides };

        // Execute first step
        await this.stepExecutor.executeStep(spell, 0, initialPipelineContext, context);
    }
}

module.exports = SpellExecutor;

