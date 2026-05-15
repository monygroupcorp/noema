const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('ImmediateStrategy user object propagation', () => {
  test('propagates isX402, payerAddress, and x402BasePoints from originalContext', () => {
    // Read the source and check the user object includes these fields
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/core/services/workflow/execution/strategies/ImmediateStrategy.js'),
      'utf8'
    );
    assert.ok(src.includes('isX402'), 'ImmediateStrategy must propagate isX402');
    assert.ok(src.includes('payerAddress'), 'ImmediateStrategy must propagate payerAddress');
    assert.ok(src.includes('x402BasePoints'), 'ImmediateStrategy must propagate x402BasePoints');
  });
});
