const expressionTool = {
  toolId: 'expression',
  service: 'expression',
  version: '1.0.0',
  displayName: 'Expression',
  commandName: '/expression',
  apiPath: '/expression/eval',
  description: 'Evaluate expressions to transform text, numbers, and data. Replaces the String Primitive.',

  inputSchema: {
    expression: {
      name: 'Expression',
      type: 'string',
      required: true,
      description: 'The expression to evaluate. Use variable names matching your inputs. In batch context, n = index, N = total.',
      order: 0
    },
    input: {
      name: 'Input',
      type: 'string',
      required: false,
      description: 'Primary input value, available as "input" in the expression.',
      order: 1
    },
    input0: {
      name: 'Input 0',
      type: 'string',
      required: false,
      description: 'Named input slot 0, available as "input0" in the expression.',
      order: 2
    },
    input1: {
      name: 'Input 1',
      type: 'string',
      required: false,
      description: 'Named input slot 1, available as "input1" in the expression.',
      order: 3
    },
    input2: {
      name: 'Input 2',
      type: 'string',
      required: false,
      description: 'Named input slot 2, available as "input2" in the expression.',
      order: 4
    },
  },
  outputSchema: {
    result: {
      name: 'result',
      type: 'string',
      description: 'The expression result.'
    }
  },
  costingModel: {
    rateSource: 'static',
    staticCost: {
      amount: 0,
      unit: 'token'
    }
  },
  deliveryMode: 'immediate',
  platformHints: {
    primaryInput: 'text',
    supportsFileCaption: false,
    supportsReplyWithCommand: false
  },
  category: 'text-to-text',
  visibility: 'public',
  metadata: {
    provider: 'Local',
    model: 'expression',
    outputType: 'text',
    inputType: 'text',
  }
};

module.exports = expressionTool;
