const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// We test the fallback chain logic by mocking the deps
describe('distributeAgentOwnerReward', () => {
  test('credits owner via upsertRewardTally when userId present', async () => {
    const { distributeAgentOwnerReward } = require('../../../src/core/services/charging/agentOwnerReward');

    let credited = null;
    const mockEconomy = {
      _toOid: (id) => id,
      creditLedger: {
        upsertRewardTally: async (args) => { credited = args; },
      },
    };

    const result = await distributeAgentOwnerReward({
      agentDoc:   { _id: 'agent_1', agentOwnerAddress: null },
      collection: { userId: 'owner_user_1', config: { revShareBps: 500 } },
      grossPoints: 297,
      runId:      'run_1',
      spellSlug:  'test-spell',
      economyService: mockEconomy,
      splitLedgerDb: null,
      logger: console,
    });

    assert.equal(result.status, 'credited');
    assert.equal(result.pointsAmount, 14); // floor(297 * 500 / 10000)
    assert.equal(credited.points, 14);
    assert.equal(credited.rewardCategory, 'agent_owner');
  });

  test('creates unclaimed entry when no userId but ownerAddress present', async () => {
    const { distributeAgentOwnerReward } = require('../../../src/core/services/charging/agentOwnerReward');

    let unclaimed = null;
    const mockSplitLedger = {
      createUnclaimedAgentOwnerEntry: async (args) => { unclaimed = args; },
    };

    const result = await distributeAgentOwnerReward({
      agentDoc:   { agentId: 'agent_2', agentOwnerAddress: '0xdeadbeef' },
      collection: { userId: null, config: {} },
      grossPoints: 297,
      runId:      'run_2',
      spellSlug:  'test-spell',
      economyService: null,
      splitLedgerDb: mockSplitLedger,
      logger: console,
    });

    assert.equal(result.status, 'unclaimed');
    assert.equal(result.pointsAmount, 14);
    assert.equal(unclaimed.ownerAddress, '0xdeadbeef');
    assert.equal(unclaimed.pointsAmount, 14);
  });

  test('skips entirely when no userId and no ownerAddress', async () => {
    const { distributeAgentOwnerReward } = require('../../../src/core/services/charging/agentOwnerReward');

    const result = await distributeAgentOwnerReward({
      agentDoc:   { agentId: 'agent_3', agentOwnerAddress: null },
      collection: null,
      grossPoints: 297,
      runId:      'run_3',
      spellSlug:  'test-spell',
      economyService: null,
      splitLedgerDb: null,
      logger: console,
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.pointsAmount, 0);
  });

  test('defaults to revShareBps 500 when config missing', async () => {
    const { distributeAgentOwnerReward } = require('../../../src/core/services/charging/agentOwnerReward');

    let credited = null;
    const mockEconomy = {
      _toOid: (id) => id,
      creditLedger: { upsertRewardTally: async (args) => { credited = args; } },
    };

    await distributeAgentOwnerReward({
      agentDoc:   { agentOwnerAddress: null },
      collection: { userId: 'owner_1', config: {} },  // no revShareBps
      grossPoints: 1000,
      runId: 'run_4', spellSlug: 'test', economyService: mockEconomy,
      splitLedgerDb: null, logger: console,
    });

    assert.equal(credited.points, 50); // floor(1000 * 500 / 10000)
  });
});
