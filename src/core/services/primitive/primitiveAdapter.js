/**
 * PrimitiveAdapter — identity-function adapter for the `primitive` tool.
 *
 * A primitive node on the canvas holds a value (text, number). When a
 * composed spell is executed, each primitive becomes a step that simply
 * passes its `value` input through to its output. No parsing, no external
 * calls, no cost.
 *
 * Output shape mirrors the expression adapter's conventions so that
 * downstream steps can read from `data.value`, `data.result`, or the
 * normalized `data.text` depending on how the connection was wired.
 *
 * See src/core/tools/definitions/primitiveTool.js for the tool metadata.
 */
const registry = require('../adapterRegistry');

class PrimitiveAdapter {
  async execute(params) {
    const { value } = params || {};
    const passthrough = value === undefined || value === null ? '' : value;
    const text = Array.isArray(passthrough)
      ? JSON.stringify(passthrough)
      : String(passthrough);
    return {
      type: 'text',
      data: {
        text: [text],
        result: passthrough,
        value: passthrough,
      },
      status: 'succeeded',
    };
  }
}

const adapter = new PrimitiveAdapter();
registry.register('primitive', adapter);
module.exports = adapter;
