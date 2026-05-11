/**
 * Fractal Tool — schema validators + helpers for the unified Tool primitive.
 *
 * @typedef {Object} FractalToolSpec
 * @property {string} imageId
 * @property {string} imageVersion
 * @property {string} workflowTemplate
 * @property {string} workflowTemplateVersion
 * @property {string} seedInputKey
 * @property {Object} defaultCookFlags
 * @property {Array<{role:string,id:string,version?:string}>} [requiredModelRefs]
 *
 * @typedef {Object} Gradus  — one step in a composed Tool
 * @property {number} ordine
 * @property {string} stepId
 * @property {{ toolId: string, version: string, contentHash: string }} childToolRef
 * @property {Object} inputBindings   — map of paramKey → { kind, ... }
 * @property {Object} [runCondition]  — { kind: 'expression', expr: string }
 *
 * @typedef {Object} FractalTool
 * @property {string} toolId
 * @property {string} version
 * @property {string|null} service              null for composed tools
 * @property {Object} inputSchema
 * @property {Object} outputSchema
 * @property {FractalToolSpec|null} spec        Atomic recipe; null for composed.
 * @property {Gradus[]} composedSteps           Empty for atomic Tools.
 * @property {Array} exposedInputs
 * @property {Array} exposedOutputs
 */

const VALID_BINDING_KINDS = new Set(['exposedInput', 'static', 'stepOutput', 'expression']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isFractalTool(tool) {
  if (!isPlainObject(tool)) return false;
  if (Array.isArray(tool.composedSteps) && tool.composedSteps.length > 0) {
    return true;
  }
  if (isPlainObject(tool.spec)
      && isNonEmptyString(tool.spec.imageId)
      && isNonEmptyString(tool.spec.workflowTemplate)) {
    return true;
  }
  return false;
}

function isAtomicFractalTool(tool) {
  if (!isFractalTool(tool)) return false;
  return !Array.isArray(tool.composedSteps) || tool.composedSteps.length === 0;
}

function isComposedFractalTool(tool) {
  return Array.isArray(tool.composedSteps) && tool.composedSteps.length > 0;
}

function _validateCommonFields(tool, errors) {
  if (!isNonEmptyString(tool.toolId)) {
    errors.push({ field: 'toolId', message: 'must be a non-empty string' });
  }
  if (!isNonEmptyString(tool.version)) {
    errors.push({ field: 'version', message: 'must be a non-empty string' });
  }
  if (!isPlainObject(tool.inputSchema)) {
    errors.push({ field: 'inputSchema', message: 'must be an object' });
  }
  if (!isPlainObject(tool.outputSchema)) {
    errors.push({ field: 'outputSchema', message: 'must be an object' });
  }
  if (!Array.isArray(tool.composedSteps)) {
    errors.push({ field: 'composedSteps', message: 'must be an array' });
  }
  if (!Array.isArray(tool.exposedInputs)) {
    errors.push({ field: 'exposedInputs', message: 'must be an array' });
  }
  if (!Array.isArray(tool.exposedOutputs)) {
    errors.push({ field: 'exposedOutputs', message: 'must be an array' });
  }
}

function _validateAtomicSpec(tool, errors) {
  if (!isNonEmptyString(tool.service)) {
    errors.push({ field: 'service', message: 'must be a non-empty string for atomic tools' });
  }
  if (!isPlainObject(tool.spec)) {
    errors.push({ field: 'spec', message: 'must be an object' });
  } else {
    if (!isNonEmptyString(tool.spec.imageId)) {
      errors.push({ field: 'spec.imageId', message: 'must be a non-empty string' });
    }
    if (!isNonEmptyString(tool.spec.imageVersion)) {
      errors.push({ field: 'spec.imageVersion', message: 'must be a non-empty string' });
    }
    if (!isNonEmptyString(tool.spec.workflowTemplate)) {
      errors.push({ field: 'spec.workflowTemplate', message: 'must be a non-empty string' });
    }
    if (!isNonEmptyString(tool.spec.workflowTemplateVersion)) {
      errors.push({ field: 'spec.workflowTemplateVersion', message: 'must be a non-empty string' });
    }
    if (!isNonEmptyString(tool.spec.seedInputKey)) {
      errors.push({ field: 'spec.seedInputKey', message: 'must be a non-empty string' });
    }
    if (!isPlainObject(tool.spec.defaultCookFlags)) {
      errors.push({ field: 'spec.defaultCookFlags', message: 'must be an object' });
    }
  }
}

function _validateComposedSteps(steps, errors) {
  const seenStepIds = new Set();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const prefix = `composedSteps[${i}]`;

    if (!isNonEmptyString(s.stepId)) {
      errors.push({ field: `${prefix}.stepId`, message: 'must be a non-empty string' });
    } else if (seenStepIds.has(s.stepId)) {
      errors.push({ field: `${prefix}.stepId`, message: `duplicate stepId '${s.stepId}'` });
    } else {
      seenStepIds.add(s.stepId);
    }

    if (typeof s.ordine !== 'number') {
      errors.push({ field: `${prefix}.ordine`, message: 'must be a number' });
    }

    if (!isPlainObject(s.childToolRef)) {
      errors.push({ field: `${prefix}.childToolRef`, message: 'must be an object' });
    } else {
      if (!isNonEmptyString(s.childToolRef.toolId)) {
        errors.push({ field: `${prefix}.childToolRef.toolId`, message: 'must be a non-empty string' });
      }
      if (!isNonEmptyString(s.childToolRef.version)) {
        errors.push({ field: `${prefix}.childToolRef.version`, message: 'must be a non-empty string' });
      }
      if (!isNonEmptyString(s.childToolRef.contentHash)) {
        errors.push({ field: `${prefix}.childToolRef.contentHash`, message: 'must be a non-empty string (Merkle pin)' });
      }
    }

    if (s.inputBindings !== undefined && !isPlainObject(s.inputBindings)) {
      errors.push({ field: `${prefix}.inputBindings`, message: 'must be an object if present' });
    } else if (isPlainObject(s.inputBindings)) {
      for (const [key, binding] of Object.entries(s.inputBindings)) {
        if (!isPlainObject(binding)) {
          errors.push({ field: `${prefix}.inputBindings.${key}`, message: 'binding must be an object' });
        } else if (!VALID_BINDING_KINDS.has(binding.kind)) {
          errors.push({ field: `${prefix}.inputBindings.${key}.kind`, message: `unknown binding kind '${binding.kind}'. Valid: ${[...VALID_BINDING_KINDS].join(', ')}` });
        }
      }
    }
  }
}

/**
 * Validate a fractal Tool — works for both atomic and composed.
 * Returns { isValid: boolean, errors: Array<{ field, message }> }.
 */
function validateFractalTool(tool) {
  const errors = [];

  if (!isPlainObject(tool)) {
    return { isValid: false, errors: [{ field: '<root>', message: 'tool must be an object' }] };
  }

  _validateCommonFields(tool, errors);

  if (Array.isArray(tool.composedSteps) && tool.composedSteps.length > 0) {
    _validateComposedSteps(tool.composedSteps, errors);
  } else {
    _validateAtomicSpec(tool, errors);
  }

  return { isValid: errors.length === 0, errors };
}

module.exports = {
  isFractalTool,
  isAtomicFractalTool,
  isComposedFractalTool,
  validateFractalTool,
  VALID_BINDING_KINDS,
};

if (require.main === module) {
  const assert = require('assert');

  const atomic = {
    toolId: 'runmake',
    version: '2.0.0',
    service: 'runpod',
    spec: {
      imageId: 'runpod/pytorch',
      imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
      workflowTemplate: 'flux-schnell',
      workflowTemplateVersion: '1',
      seedInputKey: 'input_seed',
      defaultCookFlags: { batchSize: 1, seedStrategy: 'shuffle' },
    },
    inputSchema: { prompt: { name: 'Prompt', type: 'text', required: true } },
    outputSchema: { imageUrl: { name: 'Result', type: 'string' } },
    composedSteps: [],
    exposedInputs: [],
    exposedOutputs: [],
  };

  const composed = {
    toolId: 'make',
    version: '3.0.0',
    service: null,
    spec: null,
    inputSchema: { prompt: { name: 'Prompt', type: 'text', required: true } },
    outputSchema: { imageUrl: { name: 'Result', type: 'string' } },
    composedSteps: [
      {
        ordine: 0,
        stepId: 'gen',
        childToolRef: { toolId: 'runmake', version: '2.0.0', contentHash: 'sha256:abc123' },
        inputBindings: { prompt: { kind: 'exposedInput', key: 'prompt' } },
      },
    ],
    exposedInputs: [{ stepId: 'gen', paramKey: 'prompt' }],
    exposedOutputs: [{ kind: 'stepOutput', stepId: 'gen', outputKey: 'imageUrl', as: 'imageUrl' }],
  };

  // A. atomic is fractal
  assert.strictEqual(isFractalTool(atomic), true, 'A');
  // B. composed is fractal
  assert.strictEqual(isFractalTool(composed), true, 'B');
  // C. atomic is atomic
  assert.strictEqual(isAtomicFractalTool(atomic), true, 'C');
  // D. composed is not atomic
  assert.strictEqual(isAtomicFractalTool(composed), false, 'D');
  // E. composed is composed
  assert.strictEqual(isComposedFractalTool(composed), true, 'E');
  // F. atomic validates
  const atomicResult = validateFractalTool(atomic);
  assert.strictEqual(atomicResult.isValid, true, `F: ${JSON.stringify(atomicResult.errors)}`);
  // G. composed validates
  const composedResult = validateFractalTool(composed);
  assert.strictEqual(composedResult.isValid, true, `G: ${JSON.stringify(composedResult.errors)}`);
  // H. composed step missing contentHash fails
  const broken = {
    ...composed,
    composedSteps: [{
      ordine: 0,
      stepId: 'gen',
      childToolRef: { toolId: 'runmake', version: '2.0.0' },
      inputBindings: {},
    }],
  };
  const brokenResult = validateFractalTool(broken);
  assert.strictEqual(brokenResult.isValid, false, 'H: missing contentHash should fail');
  assert.ok(brokenResult.errors.some(e => e.field.includes('contentHash')), 'H: contentHash error');
  // I. bad binding kind fails
  const badBinding = {
    ...composed,
    composedSteps: [{
      ordine: 0,
      stepId: 'gen',
      childToolRef: { toolId: 'runmake', version: '2.0.0', contentHash: 'sha256:abc' },
      inputBindings: { prompt: { kind: 'unknown' } },
    }],
  };
  const badResult = validateFractalTool(badBinding);
  assert.strictEqual(badResult.isValid, false, 'I: bad binding kind should fail');

  console.log('fractalTool smoke: A B C D E F G H I all pass');
}
