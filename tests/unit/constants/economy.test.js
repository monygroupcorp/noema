const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('economy constants', () => {
  test('USD_PER_POINT is exported and correct', () => {
    const { USD_PER_POINT } = require('../../../src/core/constants/economy');
    assert.equal(USD_PER_POINT, 0.000337);
  });

  test('chargeGeneration uses central USD_PER_POINT', () => {
    // chargeGeneration must not define its own USD_PER_POINT
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/core/services/charging/chargeGeneration.js'),
      'utf8'
    );
    assert.ok(!src.includes('const USD_PER_POINT'), 'chargeGeneration must not define USD_PER_POINT locally');
    assert.ok(src.includes("require('../../constants/economy')") || src.includes('require("../../constants/economy")'),
      'chargeGeneration must import from constants/economy');
  });

  test('pricingService uses central USD_PER_POINT', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/core/services/pricing/pricingService.js'),
      'utf8'
    );
    assert.ok(!src.includes('const USD_PER_POINT'), 'pricingService must not define USD_PER_POINT locally');
  });
});
