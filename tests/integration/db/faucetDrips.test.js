// tests/integration/db/faucetDrips.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb } = require('../../helpers/setup');
const FaucetDripsDB = require('../../../src/core/services/db/faucetDripsDb');

const TEST_TREASURY_ID = 'faucet-test-treasury-1';
const TEST_AGENT_1 = 'cmw_faucet01';
const TEST_AGENT_2 = 'cmw_faucet02';
const TEST_NOEMA_ID = '507f1f77bcf86cd799439011';

function makeDrip(overrides = {}) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);
  return {
    treasuryId: TEST_TREASURY_ID,
    agentAccountId: TEST_AGENT_1,
    noemaAccountId: TEST_NOEMA_ID,
    amount: 100,
    periodStart,
    periodEnd,
    scoringInputs: { spellsInvoked30d: 0, sessionRecencyDays: 5, score: 0.83 },
    creditLedgerEntryId: null,
    status: 'credited',
    failureReason: null,
    ...overrides,
  };
}

describe('FaucetDripsDB', () => {
  let db;
  let faucetDripsDb;
  before(async () => {
    ({ db } = await getTestDb());
    faucetDripsDb = new FaucetDripsDB(console);
    await faucetDripsDb.ensureIndexes();
    // Clean up any leftover fixtures from previous runs
    await faucetDripsDb.deleteOne({ faucetDripId: 'drip_dup00001' });
    const { getCachedClient } = require('../../../src/core/services/db/utils/queue');
    const mongoClient = await getCachedClient();
    await mongoClient.db('noema').collection('faucet_drips').deleteMany({ treasuryId: TEST_TREASURY_ID });
    await mongoClient.db('noema').collection('faucet_drips').deleteMany({
      agentAccountId: { $in: ['cmw_faucetX1', 'cmw_faucetX2'] },
    });
  });
  after(async () => {
    // Clean up the duplicate-key test fixture (by faucetDripId)
    await faucetDripsDb.deleteOne({ faucetDripId: 'drip_dup00001' });
    // Clean up remaining test documents via direct mongo access
    const { getCachedClient } = require('../../../src/core/services/db/utils/queue');
    const client = await getCachedClient();
    await client.db('noema').collection('faucet_drips').deleteMany({ treasuryId: TEST_TREASURY_ID });
    // Also clean up agent-scoped entries that use non-TEST_TREASURY_ID agents
    await client.db('noema').collection('faucet_drips').deleteMany({
      agentAccountId: { $in: ['cmw_faucetX1', 'cmw_faucetX2'] },
    });
    await closeTestDb();
  });

  test('createDrip inserts and returns faucetDripId', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    const { faucetDripId, insertedId } = await faucetDripsDb.createDrip(makeDrip());
    assert.ok(faucetDripId, 'faucetDripId should be present');
    assert.ok(faucetDripId.startsWith('drip_'), `faucetDripId should start with drip_, got: ${faucetDripId}`);
    assert.equal(faucetDripId.length, 13, 'drip_ (5) + 8 hex chars = 13');
    assert.ok(insertedId, 'insertedId should be present');
  });

  test('createDrip generates unique faucetDripId on each call', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    const r1 = await faucetDripsDb.createDrip(makeDrip({ amount: 10 }));
    const r2 = await faucetDripsDb.createDrip(makeDrip({ amount: 20 }));
    assert.notEqual(r1.faucetDripId, r2.faucetDripId);
  });

  test('findByAgentAndPeriod returns only credited drips since date', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);

    await faucetDripsDb.createDrip({
      treasuryId: TEST_TREASURY_ID,
      agentAccountId: TEST_AGENT_2,
      noemaAccountId: TEST_NOEMA_ID,
      amount: 50,
      periodStart,
      periodEnd,
      scoringInputs: { spellsInvoked30d: 0, sessionRecencyDays: 2, score: 0.9 },
      creditLedgerEntryId: 'ledger_abc',
      status: 'credited',
      failureReason: null,
    });

    const since = new Date(periodEnd.getTime() - 60 * 86400000); // 60 days ago
    const results = await faucetDripsDb.findByAgentAndPeriod(TEST_AGENT_2, since);
    assert.ok(results.length >= 1);
    assert.ok(results.every(r => r.status === 'credited'));
    assert.ok(results.every(r => r.agentAccountId === TEST_AGENT_2));
  });

  test('findByAgentAndPeriod excludes failed/skipped drips', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    const agent = 'cmw_faucetX1';
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);

    await faucetDripsDb.createDrip(makeDrip({ agentAccountId: agent, status: 'failed', failureReason: 'some error' }));
    await faucetDripsDb.createDrip(makeDrip({ agentAccountId: agent, status: 'skipped', failureReason: 'INSUFFICIENT_BALANCE' }));

    const since = new Date(Date.now() - 60 * 86400000);
    const results = await faucetDripsDb.findByAgentAndPeriod(agent, since);
    assert.equal(results.length, 0, 'failed/skipped drips should not appear in findByAgentAndPeriod');
  });

  test('findByAgentAndPeriod excludes drips before since date', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    const agent = 'cmw_faucetX2';
    const oldPeriodEnd = new Date(Date.now() - 45 * 86400000); // 45 days ago
    const oldPeriodStart = new Date(oldPeriodEnd.getTime() - 30 * 86400000);

    await faucetDripsDb.createDrip({
      treasuryId: TEST_TREASURY_ID,
      agentAccountId: agent,
      noemaAccountId: TEST_NOEMA_ID,
      amount: 75,
      periodStart: oldPeriodStart,
      periodEnd: oldPeriodEnd,
      scoringInputs: { spellsInvoked30d: 0, sessionRecencyDays: 10, score: 0.67 },
      creditLedgerEntryId: 'old_entry',
      status: 'credited',
      failureReason: null,
    });

    // Query since 30 days ago — should exclude the 45-day-old drip
    const since = new Date(Date.now() - 30 * 86400000);
    const results = await faucetDripsDb.findByAgentAndPeriod(agent, since);
    assert.equal(results.length, 0, 'drip older than since date should be excluded');
  });

  test('findByTreasuryId returns drips sorted by createdAt desc', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    // Insert two more drips for the main treasury
    await faucetDripsDb.createDrip(makeDrip({ amount: 11 }));
    await faucetDripsDb.createDrip(makeDrip({ amount: 22 }));

    const results = await faucetDripsDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.ok(results.length >= 2, 'should return at least 2 results');
    // Verify descending order
    for (let i = 1; i < results.length; i++) {
      assert.ok(
        results[i - 1].createdAt >= results[i].createdAt,
        `createdAt at index ${i - 1} should be >= index ${i}`,
      );
    }
  });

  test('findByTreasuryId respects limit', async () => {
    const faucetDripsDb = new FaucetDripsDB(console);
    const results = await faucetDripsDb.findByTreasuryId(TEST_TREASURY_ID, 2);
    assert.ok(results.length <= 2, `limit=2 should return at most 2 results, got ${results.length}`);
  });

  test('faucetDripId has unique index (duplicate insert → error)', async () => {
    // faucetDripsDb instance created in before() with ensureIndexes() already called
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 86400000);
    const fixedId = 'drip_dup00001';

    // Insert first document with a known faucetDripId
    await faucetDripsDb.insertOne({
      faucetDripId: fixedId,
      treasuryId: TEST_TREASURY_ID,
      agentAccountId: TEST_AGENT_1,
      noemaAccountId: TEST_NOEMA_ID,
      amount: 5,
      periodStart,
      periodEnd,
      scoringInputs: { spellsInvoked30d: 0, sessionRecencyDays: 1, score: 0.97 },
      creditLedgerEntryId: null,
      status: 'credited',
      createdAt: new Date(),
    });

    // Second insert with same faucetDripId must throw
    await assert.rejects(
      () => faucetDripsDb.insertOne({
        faucetDripId: fixedId,
        treasuryId: TEST_TREASURY_ID,
        agentAccountId: TEST_AGENT_2,
        noemaAccountId: TEST_NOEMA_ID,
        amount: 5,
        periodStart,
        periodEnd,
        scoringInputs: { spellsInvoked30d: 0, sessionRecencyDays: 1, score: 0.97 },
        creditLedgerEntryId: null,
        status: 'credited',
        createdAt: new Date(),
      }),
      (err) => {
        assert.ok(err.code === 11000 || /duplicate key/.test(err.message), `expected duplicate key error, got: ${err.message}`);
        return true;
      },
    );
  });
});
