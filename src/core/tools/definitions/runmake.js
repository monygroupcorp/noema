/**
 * RunMake — fractal-Tool atomic shape (Phase 1).
 * Compiles via src/core/services/runpod/Compiler.js into a Deployment.
 *
 * @type {import('../fractalTool').FractalTool}
 */
const runmakeTool = {
  toolId: 'runmake',
  service: 'runpod',
  version: '2.0.0',
  displayName: 'RunMake GPU',
  commandName: '/runmake',
  apiPath: '/api/internal/run/runmake',
  description: 'Execute ComfyUI workflows on RunPod SECURE GPU compute. Phase 1 ships FLUX-schnell text-to-image.',

  inputSchema: {
    prompt: {
      name: 'prompt',
      type: 'string',
      required: true,
      description: 'Text prompt for image generation.'
    },
    width: {
      name: 'width',
      type: 'number',
      required: false,
      default: 512,
      advanced: true,
      description: 'Output image width in pixels.'
    },
    height: {
      name: 'height',
      type: 'number',
      required: false,
      default: 512,
      advanced: true,
      description: 'Output image height in pixels.'
    },
    steps: {
      name: 'steps',
      type: 'number',
      required: false,
      default: 4,
      advanced: true,
      description: 'Number of inference steps.'
    },
    input_seed: {
      name: 'input_seed',
      type: 'seed',
      required: false,
      advanced: true,
      description: 'Random seed. Omit to shuffle; set per-account default via user preferences.'
    }
  },

  outputSchema: {
    imageUrl: {
      name: 'imageUrl',
      type: 'string',
      description: 'Signed URL of the generated image.'
    },
    metadata: {
      name: 'metadata',
      type: 'object',
      description: 'Generation metadata: deployment hash, podId, gpuTypeId, timings, cost.'
    }
  },

  costingModel: {
    rateSource: 'machine',
    unit: 'second'
  },

  deliveryMode: 'async',

  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'succeeded',
    durationTracking: true,
    resultPath: ['outputs']
  },

  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: true,
    supportsReplyWithCommand: true
  },

  category: 'text-to-image',
  visibility: 'public',

  humanDefaults: {
    width: 512,
    height: 512,
    steps: 4
  },

  spec: {
    imageId: 'runpod/pytorch',
    imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
    workflowTemplate: 'flux-schnell',
    workflowTemplateVersion: '1',
    seedInputKey: 'input_seed',
    requiredModelRefs: [],
    defaultCookFlags: {
      batchSize: 1,
      seedStrategy: 'shuffle',
      seedPlaceholder: 88888888,
      privateMode: false
    }
  },

  composedSteps: [],
  exposedInputs: [],
  exposedOutputs: [],

  metadata: {
    provider: 'RunPod',
    cloudType: 'SECURE',
    warmPoolEnabled: false,
    modelAffinityScheduling: false
  },

  legacyInputSchema: {
    workflow:        { name: 'Workflow',        type: 'string',  required: true },
    imageUrl:        { name: 'Input Image',     type: 'image',   required: false },
    loraId:          { name: 'LoRA Model',      type: 'string',  required: false },
    loraStrength:    { name: 'LoRA Strength',   type: 'number',  required: false, default: 0.8 },
    baseModel:       { name: 'Base Model',      type: 'enum',    required: false, default: 'flux-schnell', enum: ['flux-schnell', 'flux-dev', 'sdxl', 'sd15'] },
    negativePrompt:  { name: 'Negative Prompt', type: 'string',  required: false },
    customScript:    { name: 'Custom Script',   type: 'text',    required: false },
    privateMode:     { name: 'Private Mode',    type: 'boolean', required: false, default: false }
  }
};

module.exports = runmakeTool;
