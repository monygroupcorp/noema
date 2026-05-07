/**
 * Fractal Tool — schema validators + helpers for the unified Tool primitive.
 *
 * Phase 1 ships atomic-only validation. The shape supports both atomic and
 * composed Tools via optional fields; composed validation is gated until
 * Phase 2 (see docs/plans/2026-05-06-fractal-tool-migration-spec.md §3).
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
 * @typedef {Object} FractalTool
 * @property {string} toolId
 * @property {string} version
 * @property {string} service                    Phase 1 atomic: 'runpod'.
 * @property {Object} inputSchema
 * @property {Object} outputSchema
 * @property {FractalToolSpec} spec              Atomic recipe (atomic case).
 * @property {Array} composedSteps               Empty for atomic Tools.
 * @property {Array} exposedInputs               Empty for atomic Tools.
 * @property {Array} exposedOutputs              Empty for atomic Tools.
 *
 * Composed shape: see fractal-tool spec §3.3 — Phase 2+.
 */

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

function validateFractalTool(tool) {
  const errors = [];

  if (!isPlainObject(tool)) {
    return { isValid: false, errors: [{ field: '<root>', message: 'tool must be an object' }] };
  }

  if (Array.isArray(tool.composedSteps) && tool.composedSteps.length > 0) {
    return {
      isValid: false,
      errors: [{ field: 'composedSteps', message: 'composed Tools not yet supported in Phase 1' }],
    };
  }

  if (!isNonEmptyString(tool.toolId)) {
    errors.push({ field: 'toolId', message: 'must be a non-empty string' });
  }
  if (!isNonEmptyString(tool.version)) {
    errors.push({ field: 'version', message: 'must be a non-empty string' });
  }
  if (!isNonEmptyString(tool.service)) {
    errors.push({ field: 'service', message: 'must be a non-empty string' });
  } else if (tool.service !== 'runpod') {
    errors.push({ field: 'service', message: "Phase 1 atomic Tools must have service === 'runpod'" });
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

  if (!isPlainObject(tool.inputSchema)) {
    errors.push({ field: 'inputSchema', message: 'must be an object' });
  }
  if (!isPlainObject(tool.outputSchema)) {
    errors.push({ field: 'outputSchema', message: 'must be an object' });
  }

  if (!Array.isArray(tool.composedSteps)) {
    errors.push({ field: 'composedSteps', message: 'must be an array (empty for atomic)' });
  }
  if (!Array.isArray(tool.exposedInputs)) {
    errors.push({ field: 'exposedInputs', message: 'must be an array (empty for atomic)' });
  }
  if (!Array.isArray(tool.exposedOutputs)) {
    errors.push({ field: 'exposedOutputs', message: 'must be an array (empty for atomic)' });
  }

  return { isValid: errors.length === 0, errors };
}

module.exports = {
  isFractalTool,
  isAtomicFractalTool,
  validateFractalTool,
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

  const legacy = {
    toolId: 'runmake',
    service: 'runpod',
    version: '1.0.0',
    inputSchema: {},
    outputSchema: {},
  };

  const composed = { ...atomic, composedSteps: [{ stepId: 'gen' }] };

  // A
  assert.strictEqual(isFractalTool(atomic), true, 'A: atomic should be fractal');
  // B
  assert.strictEqual(isFractalTool(legacy), false, 'B: legacy should not be fractal');
  // C
  assert.strictEqual(isAtomicFractalTool(atomic), true, 'C: atomic should be atomic-fractal');
  // D
  assert.strictEqual(isAtomicFractalTool(composed), false, 'D: composed should not be atomic-fractal');
  // E
  const okResult = validateFractalTool(atomic);
  assert.strictEqual(okResult.isValid, true, 'E: atomic should validate');
  assert.deepStrictEqual(okResult.errors, [], 'E: no errors expected');

  // F — collect specific errors at once
  const broken = {
    version: '2.0.0',
    service: 'runpod',
    spec: {
      imageVersion: '1',
      workflowTemplate: 'flux-schnell',
      workflowTemplateVersion: '1',
      seedInputKey: 'input_seed',
      defaultCookFlags: {},
    },
    outputSchema: {},
    composedSteps: 'not-an-array',
    exposedInputs: [],
    exposedOutputs: [],
  };
  const brokenResult = validateFractalTool(broken);
  assert.strictEqual(brokenResult.isValid, false, 'F: broken should fail validation');
  const fields = brokenResult.errors.map(e => e.field);
  assert.ok(fields.includes('toolId'), 'F: missing toolId reported');
  assert.ok(fields.includes('spec.imageId'), 'F: missing spec.imageId reported');
  assert.ok(fields.includes('inputSchema'), 'F: missing inputSchema reported');
  assert.ok(fields.includes('composedSteps'), 'F: composedSteps wrong type reported');

  // G
  const composedResult = validateFractalTool(composed);
  assert.strictEqual(composedResult.isValid, false, 'G: composed should fail Phase 1');
  assert.strictEqual(composedResult.errors.length, 1, 'G: exactly one error');
  assert.strictEqual(composedResult.errors[0].field, 'composedSteps', 'G: error on composedSteps');
  assert.ok(/Phase 1/.test(composedResult.errors[0].message), 'G: Phase-1 message');

  console.log('fractalTool smoke: A B C D E F G all pass');
}
