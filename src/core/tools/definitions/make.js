'use strict';

/**
 * make — Phase 2 migration: the first canonical composed Tool.
 *
 * Wraps `runmake@2.0.0` as its single atomic step, exposing the same
 * input surface. This is the migration deliverable from noema.spells → noemaplane.toolVersions.
 *
 * The childToolRef.contentHash is computed from the live runmake tool definition
 * using hashToolVersion(), giving us a Merkle pin that verifies at compile time.
 */

const runmakeTool = require('./runmake');
const { hashToolVersion } = require('../../services/runpod/deploymentHash');

const RUNMAKE_CONTENT_HASH = hashToolVersion(runmakeTool);

const makeTool = {
  toolId: 'make',
  version: '3.0.0',
  service: null,
  displayName: 'Make',
  commandName: '/make',
  apiPath: '/api/internal/run/make',
  description: 'Generate images via the RunPod fractal pipeline. Composed tool wrapping runmake.',

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
      description: 'Random seed. Omit to shuffle.'
    },
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
      description: 'Generation metadata from the underlying atomic tool.'
    },
  },

  costingModel: {
    rateSource: 'composed',
    unit: 'second',
  },

  deliveryMode: 'composed',

  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: true,
    supportsReplyWithCommand: true,
  },

  category: 'text-to-image',
  visibility: 'public',
  spec: null,

  composedSteps: [
    {
      ordine: 0,
      stepId: 'gen',
      childToolRef: {
        toolId: 'runmake',
        version: '2.0.0',
        contentHash: RUNMAKE_CONTENT_HASH,
      },
      inputBindings: {
        prompt:     { kind: 'exposedInput', key: 'prompt' },
        width:      { kind: 'exposedInput', key: 'width' },
        height:     { kind: 'exposedInput', key: 'height' },
        steps:      { kind: 'exposedInput', key: 'steps' },
        input_seed: { kind: 'exposedInput', key: 'input_seed' },
      },
    },
  ],

  exposedInputs: [
    { stepId: 'gen', paramKey: 'prompt' },
    { stepId: 'gen', paramKey: 'width' },
    { stepId: 'gen', paramKey: 'height' },
    { stepId: 'gen', paramKey: 'steps' },
    { stepId: 'gen', paramKey: 'input_seed' },
  ],

  exposedOutputs: [
    { kind: 'stepOutput', stepId: 'gen', outputKey: 'imageUrl', as: 'imageUrl' },
    { kind: 'stepOutput', stepId: 'gen', outputKey: 'metadata', as: 'metadata' },
  ],
};

module.exports = makeTool;
module.exports.RUNMAKE_CONTENT_HASH = RUNMAKE_CONTENT_HASH;
