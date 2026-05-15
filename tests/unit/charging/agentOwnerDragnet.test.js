const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { runDragnet } = require('../../../src/core/services/charging/agentOwnerDragnet');

describe('agentOwnerDragnet', () => {
  test('credits owner when wallet address is linked', async () => {
    const entry = {
      runId: 'run_1',
      spellSlug: 'test-spell',
      agentId: 'agent_1',
      ownerAddress: '0xabc123',
      pointsAmount: 50,
    };

    let upsertArgs = null;
    let incrementArgs = null;
    let markedRunId = null;

    const splitLedgerDb = {
      findUnclaimed: async () => [entry],
      markAgentOwnerCredited: async (runId) => { markedRunId = runId; },
    };

    const userCoreDb = {
      findUserCoreByWalletAddress: async () => ({ _id: 'user_1' }),
    };

    const economyService = {
      _toOid: (id) => id,
      creditLedger: {
        upsertRewardTally: async (args) => { upsertArgs = args; },
      },
      userEconomy: {
        incrementContributorRewards: async (userId, rewardType, points) => {
          incrementArgs = { userId, rewardType, points };
        },
      },
    };

    const result = await runDragnet({ splitLedgerDb, userCoreDb, economyService, logger: null });

    assert.deepEqual(result, { credited: 1, skipped: 0, errors: 0 });
    assert.equal(upsertArgs.points, 50);
    assert.equal(upsertArgs.rewardCategory, 'agent_owner');
    assert.equal(incrementArgs.rewardType, 'agent_owner');
    assert.equal(incrementArgs.points, 50);
    assert.equal(markedRunId, 'run_1');
  });

  test('skips when no user found for address', async () => {
    const entry = {
      runId: 'run_2',
      spellSlug: 'test-spell',
      agentId: 'agent_2',
      ownerAddress: '0xunknown',
      pointsAmount: 30,
    };

    let upsertCalled = false;

    const splitLedgerDb = {
      findUnclaimed: async () => [entry],
      markAgentOwnerCredited: async () => {},
    };

    const userCoreDb = {
      findUserCoreByWalletAddress: async () => null,
    };

    const economyService = {
      _toOid: (id) => id,
      creditLedger: {
        upsertRewardTally: async () => { upsertCalled = true; },
      },
      userEconomy: {
        incrementContributorRewards: async () => {},
      },
    };

    const result = await runDragnet({ splitLedgerDb, userCoreDb, economyService, logger: null });

    assert.deepEqual(result, { credited: 0, skipped: 1, errors: 0 });
    assert.equal(upsertCalled, false);
  });

  test('counts errors but continues processing subsequent entries', async () => {
    const entries = [
      { runId: 'run_3a', spellSlug: 'spell', agentId: 'a1', ownerAddress: '0xfail', pointsAmount: 10 },
      { runId: 'run_3b', spellSlug: 'spell', agentId: 'a2', ownerAddress: '0xok', pointsAmount: 20 },
    ];

    let markedRunId = null;

    const splitLedgerDb = {
      findUnclaimed: async () => entries,
      markAgentOwnerCredited: async (runId) => { markedRunId = runId; },
    };

    let callCount = 0;
    const userCoreDb = {
      findUserCoreByWalletAddress: async (addr) => {
        // Both addresses resolve to a user so the error must come from economyService
        return { _id: `user_for_${addr}` };
      },
    };

    const economyService = {
      _toOid: (id) => id,
      creditLedger: {
        upsertRewardTally: async () => {
          callCount++;
          if (callCount === 1) throw new Error('DB exploded');
        },
      },
      userEconomy: {
        incrementContributorRewards: async () => {},
      },
    };

    const result = await runDragnet({ splitLedgerDb, userCoreDb, economyService, logger: null });

    assert.deepEqual(result, { credited: 1, skipped: 0, errors: 1 });
    assert.equal(markedRunId, 'run_3b');
  });

  test('returns zeroes when no unclaimed entries exist', async () => {
    const splitLedgerDb = {
      findUnclaimed: async () => [],
      markAgentOwnerCredited: async () => {},
    };

    const userCoreDb = {
      findUserCoreByWalletAddress: async () => null,
    };

    const economyService = {
      _toOid: (id) => id,
      creditLedger: { upsertRewardTally: async () => {} },
      userEconomy: { incrementContributorRewards: async () => {} },
    };

    const result = await runDragnet({ splitLedgerDb, userCoreDb, economyService, logger: null });

    assert.deepEqual(result, { credited: 0, skipped: 0, errors: 0 });
  });
});
