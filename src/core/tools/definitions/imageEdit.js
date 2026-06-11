// OpenAI gpt-image-1/2 image editing & composition (multi-image reference).
// Input names follow the kontexts convention (input_image / input_second_image /
// input_text) so this is a drop-in for image-swap spells like CamelMemify.
const imageEditTool = {
  toolId: 'gpt-image-edit',
  service: 'openai',
  version: '1.0.0',
  displayName: 'Image Edit',
  commandName: '/imgedit',
  apiPath: '/llm/image/edit',
  description: 'Edit or compose images with OpenAI gpt-image. Give it a base image (and optional reference images) plus an instruction — e.g. "replace the subject with the character from the second image". Understands the scene natively; no prompt-engineering rig required.',
  inputSchema: {
    input_image: {
      name: 'input_image', type: 'image', required: true,
      description: 'The base image to edit.'
    },
    input_second_image: {
      name: 'input_second_image', type: 'image', required: false,
      description: 'Optional reference image the prompt can refer to as "the second image" (e.g. a character to insert).'
    },
    input_text: {
      name: 'input_text', type: 'text', required: true,
      description: 'The edit instruction.'
    },
    model: {
      name: 'model', type: 'enum', required: false, default: 'gpt-image-2',
      enum: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'],
      description: 'gpt-image model to use.'
    },
    size: {
      name: 'size', type: 'enum', required: false, default: '1024x1024',
      enum: ['1024x1024', '1024x1536', '1536x1024'],
      description: 'Output resolution.'
    },
    quality: {
      name: 'quality', type: 'enum', required: false, default: 'medium',
      enum: ['low', 'medium', 'high'], advanced: true,
      description: 'Quality tier (affects cost).'
    },
    moderation: {
      name: 'moderation', type: 'enum', required: false, default: 'low',
      enum: ['low', 'auto'], advanced: true,
      description: 'Content moderation strictness. "low" reduces false refusals on cartoon/meme content.'
    }
  },
  outputSchema: {
    image: { name: 'image', type: 'image', description: 'The edited image.' }
  },
  costingModel: {
    rateSource: 'static',
    // gpt-image-2, 1024x1024, medium ≈ measured $0.088/edit. Per-size/quality in metadata.costTable.
    staticCost: { amount: 0.09, unit: 'run' }
  },
  deliveryMode: 'async',
  webhookStrategy: {
    expectedStatusField: 'status',
    successValue: 'completed',
    durationTracking: false,
    resultPath: ['data[0].url']
  },
  platformHints: {
    primaryInput: 'image',
    requiresMainImage: true,
    supportsSupportingImages: true,
    supportingImageInputs: ['input_second_image'],
    supportsFileCaption: true,
    supportsReplyWithCommand: true
  },
  category: 'image-to-image',
  visibility: 'public',
  humanDefaults: {},
  metadata: {
    provider: 'OpenAI',
    model: 'gpt-image-2',
    outputType: 'image',
    inputType: 'image',
    defaultAdapterParams: { action: 'edit', model: 'gpt-image-2' },
    // USD per edit. gpt-image-1 from OpenAI docs; gpt-image-2 estimated from measured token usage — pin before heavy billing.
    costTable: {
      'gpt-image-2':      { '1024x1024': { low: 0.03, medium: 0.09, high: 0.30 }, '1024x1536': { low: 0.045, medium: 0.135, high: 0.45 }, '1536x1024': { low: 0.045, medium: 0.135, high: 0.45 } },
      'gpt-image-1.5':    { '1024x1024': { low: 0.02, medium: 0.066, high: 0.25 } },
      'gpt-image-1':      { '1024x1024': { low: 0.011, medium: 0.042, high: 0.167 }, '1024x1536': { low: 0.016, medium: 0.063, high: 0.25 }, '1536x1024': { low: 0.016, medium: 0.063, high: 0.25 } },
      'gpt-image-1-mini': { '1024x1024': { low: 0.005, medium: 0.015, high: 0.06 } }
    }
  }
};

module.exports = imageEditTool;
