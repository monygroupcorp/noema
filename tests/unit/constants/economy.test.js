const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('economy constants', () => {
  test('USD_PER_POINT is exported and correct', () => {
    const { USD_PER_POINT } = require('../../../src/core/constants/economy');
    assert.equal(USD_PER_POINT, 0.000337);
  });

  test('DEFAULT_AGENT_OWNER_REV_SHARE_BPS is exported and correct', () => {
    const { DEFAULT_AGENT_OWNER_REV_SHARE_BPS } = require('../../../src/core/constants/economy');
    assert.equal(DEFAULT_AGENT_OWNER_REV_SHARE_BPS, 500);
  });

  test('agentOwnerReward uses central DEFAULT_AGENT_OWNER_REV_SHARE_BPS', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/core/services/charging/agentOwnerReward.js'),
      'utf8'
    );
    assert.ok(!src.includes('const DEFAULT_REV_SHARE_BPS = '), 'agentOwnerReward must not define DEFAULT_REV_SHARE_BPS as a literal');
    assert.ok(src.includes('DEFAULT_AGENT_OWNER_REV_SHARE_BPS'), 'agentOwnerReward must import DEFAULT_AGENT_OWNER_REV_SHARE_BPS');
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

  test('generationExecutionService uses central USD_PER_POINT', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../src/core/services/generationExecutionService.js'),
      'utf8'
    );
    assert.ok(!src.includes('const USD_PER_POINT'), 'generationExecutionService must not define USD_PER_POINT locally');
    assert.ok(src.includes("require('../constants/economy')") || src.includes('require("../constants/economy")'),
      'generationExecutionService must import from constants/economy');
  });
});
