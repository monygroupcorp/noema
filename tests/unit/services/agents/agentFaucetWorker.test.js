// tests/unit/services/agents/agentFaucetWorker.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { runFaucet, startFaucet, FAUCET_INTERVAL_MS } = require('../../../../src/core/services/agents/agentFaucetWorker');

// ── helpers ────────────────────────────────────────────────────────────────

function makeTreasury(overrides = {}) {
  return {
    treasuryId: 'treasury-test-1',
    issuerName: 'camel',
    issuerDomain: 'camelcabal.fun',
    balance: 1000,
    faucetPolicy: {
      starterGrant: 100,
      monthlyMax: 500,
      perCycleBudget: 200,
      subsidyMode: 'on',
      refillCadence: 'weekly',
    },
    status: 'active',
    lastDripAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeAgent(overrides = {}) {
  return {
    agentAccountId: 'cmw_abc001',
    treasuryId: 'treasury-test-1',
    noemaAccountId: '507f1f77bcf86cd799439011',
    status: 'active',
    balance: 0,
    sessionIssuedAt: new Date(Date.now() - 2 * 86400000), // 2 days ago → high score
    ...overrides,
  };
}

function makeNullLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function makeDefaultDeps(overrides = {}) {
  const treasury = makeTreasury();
  const agent = makeAgent();
  return {
    treasuryDb: {
      findActiveTreasuries: async () => [treasury],
      debitBalance: async () => true,
      updateLastDripAt: async () => {},
      ...overrides.treasuryDb,
    },
    agentAccountDb: {
      findActiveByTreasuryId: async () => [agent],
      addBalance: async () => {},
      ...overrides.agentAccountDb,
    },
    faucetDripsDb: {
      findByAgentAndPeriod: async () => [],
      createDrip: async () => ({ faucetDripId: 'drip_00000001', insertedId: 'oid' }),
      ...overrides.faucetDripsDb,
    },
    economyService: {
      creditPoints: async () => ({ entryId: { toString: () => 'entry_abc' } }),
      ...overrides.economyService,
    },
    logger: makeNullLogger(),
    ...overrides.top,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('agentFaucetWorker', () => {

  test('runFaucet skips treasury not yet due (cadence not elapsed)', async () => {
    // lastDripAt = 1 hour ago, weekly cadence requires 7 days
    const treasury = makeTreasury({ lastDripAt: new Date(Date.now() - 60 * 60 * 1000) });
    let agentsQueried = false;
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [treasury],
        debitBalance: async () => true,
        updateLastDripAt: async () => {},
      },
      agentAccountDb: {
        findActiveByTreasuryId: async () => { agentsQueried = true; return []; },
        addBalance: async () => {},
      },
    });
    const result = await runFaucet(deps);
    assert.equal(agentsQueried, false, 'should not query agents for a not-yet-due treasury');
    assert.equal(result.treasuriesProcessed, 0);
    assert.equal(result.agentsDripped, 0);
  });

  test('runFaucet processes treasury due for weekly cadence', async () => {
    // lastDripAt = 8 days ago — weekly cadence = 7 days → due
    const treasury = makeTreasury({ lastDripAt: new Date(Date.now() - 8 * 86400000) });
    let lastDripAtUpdated = false;
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [treasury],
        debitBalance: async () => true,
        updateLastDripAt: async () => { lastDripAtUpdated = true; },
      },
    });
    const result = await runFaucet(deps);
    assert.equal(result.treasuriesProcessed, 1);
    assert.ok(result.agentsDripped >= 1);
    assert.ok(lastDripAtUpdated, 'lastDripAt should be updated after processing');
  });

  test('runFaucet skips agent with 0 dripAmount (fully capped)', async () => {
    // monthlyMax = 200, agent already received 200 this month → cap = 0
    const treasury = makeTreasury({ balance: 1000, faucetPolicy: { ...makeTreasury().faucetPolicy, monthlyMax: 200 } });
    const agent = makeAgent();
    let createDripCalled = false;
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [treasury],
        debitBalance: async () => true,
        updateLastDripAt: async () => {},
      },
      agentAccountDb: {
        findActiveByTreasuryId: async () => [agent],
        addBalance: async () => {},
      },
      faucetDripsDb: {
        // Agent has already received 200 points this month
        findByAgentAndPeriod: async () => [{ amount: 200, status: 'credited' }],
        createDrip: async () => { createDripCalled = true; return { faucetDripId: 'drip_x', insertedId: 'oid' }; },
      },
    });
    const result = await runFaucet(deps);
    assert.equal(createDripCalled, false, 'no drip record should be created for a fully-capped agent');
    assert.equal(result.agentsDripped, 0);
  });

  test('runFaucet caps drip at monthlyMax - pointsReceivedThisMonth', async () => {
    // monthlyMax = 300, received 250 → cap = 50. Treasury balance = 1000, rawAlloc > 50.
    const treasury = makeTreasury({ balance: 1000, faucetPolicy: { ...makeTreasury().faucetPolicy, monthlyMax: 300 } });
    const agent = makeAgent();

    let dripAmountUsed = null;
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [treasury],
        debitBalance: async (id, amount) => { dripAmountUsed = amount; return true; },
        updateLastDripAt: async () => {},
      },
      agentAccountDb: {
        findActiveByTreasuryId: async () => [agent],
        addBalance: async () => {},
      },
      faucetDripsDb: {
        findByAgentAndPeriod: async () => [{ amount: 250, status: 'credited' }],
        createDrip: async () => ({ faucetDripId: 'drip_y', insertedId: 'oid' }),
      },
    });
    await runFaucet(deps);
    assert.equal(dripAmountUsed, 50, 'drip should be capped at monthlyMax - pointsReceivedThisMonth = 50');
  });

  test('runFaucet stops loop when debitBalance returns false (insufficient balance)', async () => {
    const treasury = makeTreasury({ balance: 1000 });
    const agent1 = makeAgent({ agentAccountId: 'cmw_agent1' });
    const agent2 = makeAgent({ agentAccountId: 'cmw_agent2' });

    let addBalanceCalls = 0;
    const dripsCreated = [];
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [treasury],
        debitBalance: async () => false, // always fails → insufficient balance
        updateLastDripAt: async () => {},
      },
      agentAccountDb: {
        findActiveByTreasuryId: async () => [agent1, agent2],
        addBalance: async () => { addBalanceCalls++; },
      },
      faucetDripsDb: {
        findByAgentAndPeriod: async () => [],
        createDrip: async (record) => { dripsCreated.push(record.status); return { faucetDripId: 'drip_z', insertedId: 'oid' }; },
      },
    });
    await runFaucet(deps);
    assert.equal(addBalanceCalls, 0, 'addBalance should not be called when debitBalance fails');
    // Both agents should receive skipped records (Fix 5: no longer breaks after first failure)
    assert.equal(dripsCreated.length, 2);
    assert.ok(dripsCreated.every(s => s === 'skipped'), 'all drip records should be skipped');
  });

  test('runFaucet creates faucetDrip record with status:credited on success', async () => {
    const dripsCreated = [];
    const deps = makeDefaultDeps({
      faucetDripsDb: {
        findByAgentAndPeriod: async () => [],
        createDrip: async (record) => { dripsCreated.push(record); return { faucetDripId: 'drip_s1', insertedId: 'oid' }; },
      },
    });
    await runFaucet(deps);
    assert.ok(dripsCreated.length >= 1, 'at least one drip record should be created');
    const credited = dripsCreated.find(d => d.status === 'credited');
    assert.ok(credited, 'a credited drip record should exist');
    assert.ok(credited.creditLedgerEntryId, 'creditLedgerEntryId should be set');
    assert.equal(credited.failureReason, null);
  });

  test('runFaucet creates faucetDrip record with status:failed when creditPoints throws', async () => {
    const dripsCreated = [];
    const deps = makeDefaultDeps({
      faucetDripsDb: {
        findByAgentAndPeriod: async () => [],
        createDrip: async (record) => { dripsCreated.push(record); return { faucetDripId: 'drip_f1', insertedId: 'oid' }; },
      },
      economyService: {
        creditPoints: async () => { throw new Error('ledger unavailable'); },
      },
    });
    const result = await runFaucet(deps);
    assert.ok(result.errors >= 1, 'errors should be incremented');
    const failed = dripsCreated.find(d => d.status === 'failed');
    assert.ok(failed, 'a failed drip record should exist');
    assert.equal(failed.failureReason, 'ledger unavailable');
    assert.equal(failed.creditLedgerEntryId, null);
  });

  test('runFaucet updates treasury lastDripAt after successful sweep', async () => {
    let lastDripAtArgs = null;
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [makeTreasury()],
        debitBalance: async () => true,
        updateLastDripAt: async (id, date) => { lastDripAtArgs = { id, date }; },
      },
    });
    await runFaucet(deps);
    assert.ok(lastDripAtArgs, 'updateLastDripAt should have been called');
    assert.equal(lastDripAtArgs.id, 'treasury-test-1');
    assert.ok(lastDripAtArgs.date instanceof Date, 'date should be a Date instance');
  });

  test('runFaucet skips treasury with no active agents', async () => {
    let updateLastDripCalled = false;
    const deps = makeDefaultDeps({
      agentAccountDb: {
        findActiveByTreasuryId: async () => [], // no agents
        addBalance: async () => {},
      },
      treasuryDb: {
        findActiveTreasuries: async () => [makeTreasury()],
        debitBalance: async () => true,
        updateLastDripAt: async () => { updateLastDripCalled = true; },
      },
    });
    const result = await runFaucet(deps);
    assert.equal(result.treasuriesProcessed, 0);
    assert.equal(updateLastDripCalled, false, 'lastDripAt should not be updated for empty-agent treasury');
  });

  test('runFaucet surfaces updateLastDripAt failure and does not silently swallow it', async () => {
    // Stub updateLastDripAt to throw after agents have been dripped.
    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [makeTreasury()],
        debitBalance: async () => true,
        updateLastDripAt: async () => { throw new Error('db write timeout'); },
      },
    });
    const result = await runFaucet(deps);
    // The error must be surfaced in the return value so operators can see it.
    assert.ok(result.errors >= 1, 'errors should be >= 1 when updateLastDripAt throws');
    // treasuriesProcessed must NOT be incremented — the sweep did not finish cleanly.
    assert.equal(result.treasuriesProcessed, 0, 'treasuriesProcessed should be 0 when updateLastDripAt throws');
  });

  test('runFaucet re-attempts drip on second call when updateLastDripAt failed (double-drip regression)', async () => {
    // Simulate: first call drips agents but updateLastDripAt fails, so lastDripAt is never
    // persisted. On the second call the treasury is still "due" and agents must be dripped
    // again (since from the DB's perspective no drip occurred).
    const treasury = makeTreasury(); // lastDripAt: null → always due
    let dripsAttempted = 0;

    const deps = makeDefaultDeps({
      treasuryDb: {
        findActiveTreasuries: async () => [treasury],
        debitBalance: async () => true,
        updateLastDripAt: async () => { throw new Error('db write timeout'); },
      },
      agentAccountDb: {
        findActiveByTreasuryId: async () => { dripsAttempted++; return [makeAgent()]; },
        addBalance: async () => {},
      },
    });

    await runFaucet(deps); // first call — drips agents, updateLastDripAt fails
    await runFaucet(deps); // second call — lastDripAt still null, must attempt drip again
    assert.ok(dripsAttempted >= 2, 'agents should be queried on both calls when lastDripAt was never updated');
  });

  test('startFaucet calls runFaucet immediately and returns handle', async () => {
    let runCount = 0;
    // Patch runFaucet via the module — we test the module's startFaucet directly.
    // Since we can't monkey-patch a closed-over function easily, we verify the
    // handle is returned and has the setInterval interface.
    let depsCalled = false;
    const deps = {
      treasuryDb: { findActiveTreasuries: async () => { depsCalled = true; return []; } },
      agentAccountDb: { findActiveByTreasuryId: async () => [] },
      faucetDripsDb: { findByAgentAndPeriod: async () => [], createDrip: async () => ({}) },
      economyService: { creditPoints: async () => ({ entryId: { toString: () => 'e' } }) },
      logger: makeNullLogger(),
    };
    const handle = startFaucet(deps);
    assert.ok(handle, 'startFaucet should return a handle');
    assert.ok(typeof handle === 'object' || typeof handle === 'number', 'handle should be a timer reference');
    // Give the immediate call a tick to execute
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(depsCalled, true, 'runFaucet should have been called immediately on startFaucet');
    clearInterval(handle);
  });

});
