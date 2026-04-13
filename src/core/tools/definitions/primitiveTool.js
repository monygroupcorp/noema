/**
 * Primitive tool — a zero-cost, zero-compute pass-through step.
 *
 * A "primitive" node is a value holder on the canvas (e.g. a text box, a
 * number). Inside a composed spell it executes "for free": it takes its
 * `value` input and emits it unchanged as its output. This lets primitives
 * live in a saved spell as first-class nodes — castable, re-editable,
 * re-usable across downstream steps — without any special-casing in the
 * execution engine. It's just a tool whose body is the identity function.
 *
 * Serializers in the frontend emit primitive canvas windows as steps with
 * `toolIdentifier: 'primitive'`; see src/platforms/web/frontend/src/sandbox/subgraph.js.
 * The backend adapter is at src/core/services/primitive/primitiveAdapter.js.
 */
const primitiveTool = {
  toolId: 'primitive',
  service: 'primitive',
  version: '1.0.0',
  displayName: 'Primitive',
  commandName: '/primitive',
  apiPath: '/primitive/passthrough',
  description: 'A constant value node. Passes its `value` input through unchanged as its output.',

  inputSchema: {
    value: {
      name: 'Value',
      type: 'string',
      required: true,
      description: 'The value to carry through. When exposed as a spell input, the caster supplies this at run time.',
      order: 0,
    },
  },
  outputSchema: {
    value: {
      name: 'value',
      type: 'string',
      description: 'The pass-through value.',
    },
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0,
      unit: 'token',
    },
  },
  deliveryMode: 'immediate',
  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: false,
    supportsReplyWithCommand: false,
  },
  category: 'text-to-text',
  visibility: 'hidden', // Not a discoverable tool — only used inside spells via the canvas.
  humanDefaults: {},
  metadata: {
    provider: 'Local',
    model: 'primitive',
    outputType: 'text',
    inputType: 'text',
    hideFromLanding: true,
  },
};

module.exports = primitiveTool;
