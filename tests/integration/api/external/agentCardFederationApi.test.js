/**
 * Agent Card Federation API Integration Tests
 *
 * Tests:
 *   GET /treasury/:treasuryId/agents/:agentId         (5 cases)
 *   GET /agents/:agentAccountId/capabilities           (4 cases)
 *
 * All dependencies are mocked — no MongoDB or HTTP calls are made.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

const { createAgentCardFederationApi } = require('../../../../src/api/external/agents/agentCardFederationApi');

// ─── Shared mock data ────────────────────────────────────────────────────────

const mockAgentAccount = {
  agentAccountId: 'cmw_test01',
  agentId: '42',
  treasuryId: 'camel-1',
  balance: 37125,       // points → pointsToUsd(37125) = (37125 * 0.000337).toFixed(2) = "12.51"
  status: 'active',
};

const mockTreasury = {
  treasuryId: 'camel-1',
  partnerId: 'pk_live_abc123',
  faucetPolicy: { monthlyMax: 50000 }, // pointsToUsd(50000) = (50000 * 0.000337).toFixed(2) = "16.85"
};

// grossAmount "50000" atomic USDC units → 50000 / 1e6 = 0.05 USDC → "0.050000"
const mockSplitLedgerEntries = [
  {
    spellSlug: 'generate-image',
    grossAmount: '50000',
    createdAt: new Date('2026-05-10'),
    status: 'credited',
  },
];

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeMockAgentAccountDb(account, overrides = {}) {
  return {
    findByAgentId: async (id) => (account && account.agentId === id ? account : null),
    findByAgentAccountId: async (id) => (account && account.agentAccountId === id ? account : null),
    ...overrides,
  };
}

function makeMockTreasuryDb(treasury, overrides = {}) {
  return {
    findByTreasuryId: async (id) => (treasury && treasury.treasuryId === id ? treasury : null),
    ...overrides,
  };
}

function makeMockSplitLedgerDb(entries = mockSplitLedgerEntries, overrides = {}) {
  return {
    findByPartnerId: async (_partnerId, _limit) => entries,
    ...overrides,
  };
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function createTestApp({
  agentAccount = mockAgentAccount,
  treasury = mockTreasury,
  splitLedgerEntries = mockSplitLedgerEntries,
  agentAccountDbOverrides = {},
  treasuryDbOverrides = {},
  splitLedgerDbOverrides = {},
  spellsService = null,
} = {}) {
  const app = express();
  app.use(express.json());

  const router = createAgentCardFederationApi({
    agentAccountDb: makeMockAgentAccountDb(agentAccount, agentAccountDbOverrides),
    treasuryDb: makeMockTreasuryDb(treasury, treasuryDbOverrides),
    splitLedgerDb: makeMockSplitLedgerDb(splitLedgerEntries, splitLedgerDbOverrides),
    spellsService,
    logger: { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} },
  });

  app.use('/', router);
  return app;
}

// ─── Tests: GET /treasury/:treasuryId/agents/:agentId ────────────────────────

describe('Agent Card Federation API — GET /treasury/:treasuryId/agents/:agentId', () => {
  // Test 1: Valid → 200 with correct balance, monthlyCap, recentUsage structure
  test('Valid request → 200 with correct balance, monthlyCap, recentUsage', async () => {
    const app = createTestApp();
    const res = await supertest(app).get('/treasury/camel-1/agents/42');

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_test01');

    // balance
    assert.ok(res.body.balance, 'balance field present');
    assert.equal(res.body.balance.currency, 'USDC');
    assert.ok(typeof res.body.balance.amount === 'string', 'balance.amount is string');

    // monthlyCap
    assert.ok(typeof res.body.monthlyCap === 'string', 'monthlyCap is string');

    // recentUsage structure
    assert.ok(Array.isArray(res.body.recentUsage), 'recentUsage is array');
    if (res.body.recentUsage.length > 0) {
      const entry = res.body.recentUsage[0];
      assert.ok('spell' in entry, 'entry has spell field');
      assert.ok(entry.cost, 'entry has cost');
      assert.equal(entry.cost.currency, 'USDC');
      assert.ok(typeof entry.cost.amount === 'string', 'cost.amount is string');
      assert.ok(typeof entry.timestamp === 'number', 'timestamp is number');
    }
  });

  // Test 2: Agent not found → 404 AGENT_NOT_FOUND
  test('Agent not found → 404 AGENT_NOT_FOUND', async () => {
    const app = createTestApp({ agentAccount: null });
    const res = await supertest(app).get('/treasury/camel-1/agents/99');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'AGENT_NOT_FOUND');
  });

  // Test 3: Treasury mismatch → 404
  test('Treasury mismatch → 404 AGENT_NOT_FOUND', async () => {
    const app = createTestApp();
    // Agent exists but belongs to 'camel-1', not 'camel-other'
    const res = await supertest(app).get('/treasury/camel-other/agents/42');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'AGENT_NOT_FOUND');
  });

  // Test 4: Treasury not found → 500
  test('Treasury not found → 500 TREASURY_NOT_FOUND', async () => {
    const app = createTestApp({ treasury: null });
    const res = await supertest(app).get('/treasury/camel-1/agents/42');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'TREASURY_NOT_FOUND');
  });

  // Test 5: Verify pointsToUsd conversion on balance field
  // 37125 points × 0.000337 = 12.51... → "12.51"
  test('pointsToUsd conversion: 37125 points → balance.amount "12.51"', async () => {
    const app = createTestApp({
      agentAccount: { ...mockAgentAccount, balance: 37125 },
    });
    const res = await supertest(app).get('/treasury/camel-1/agents/42');

    assert.equal(res.status, 200);
    // 37125 * 0.000337 = 12.51...125 → toFixed(2) = "12.51"
    assert.equal(res.body.balance.amount, '12.51');
    // monthlyCap: 50000 * 0.000337 = 16.85 → "16.85"
    assert.equal(res.body.monthlyCap, '16.85');
  });
});

// ─── Tests: GET /agents/:agentAccountId/capabilities ─────────────────────────

describe('Agent Card Federation API — GET /agents/:agentAccountId/capabilities', () => {
  // Test 6: Valid active agent with no spellsService → 200 with static capabilities
  test('Valid active agent → 200 with capabilities array (static fallback)', async () => {
    const app = createTestApp({ spellsService: null });
    const res = await supertest(app).get('/agents/cmw_test01/capabilities');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body), 'response is array');
    assert.ok(res.body.length > 0, 'capabilities array is not empty');
  });

  // Test 7: Agent not found → 404
  test('Agent not found → 404 AGENT_NOT_FOUND', async () => {
    const app = createTestApp({ agentAccount: null });
    const res = await supertest(app).get('/agents/cmw_missing/capabilities');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'AGENT_NOT_FOUND');
  });

  // Test 8: Agent suspended → 403 AGENT_SUSPENDED
  test('Agent suspended → 403 AGENT_SUSPENDED', async () => {
    const app = createTestApp({
      agentAccount: { ...mockAgentAccount, status: 'suspended' },
    });
    const res = await supertest(app).get('/agents/cmw_test01/capabilities');

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'AGENT_SUSPENDED');
  });

  // Test 9: Capabilities array has correct x402 shape
  test('Capabilities array has correct x402 shape', async () => {
    const app = createTestApp({ spellsService: null });
    const res = await supertest(app).get('/agents/cmw_test01/capabilities');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length > 0, 'at least one capability present');

    const cap = res.body[0];
    assert.ok(typeof cap.id === 'string', 'capability has id');
    assert.ok(typeof cap.name === 'string', 'capability has name');
    assert.ok(typeof cap.endpoint === 'string', 'capability has endpoint');
    assert.ok(cap.endpoint.startsWith('https://noema.art/api/v1/partner/spells/'), 'endpoint has correct prefix');
    assert.equal(cap.method, 'POST');

    // x402 shape
    assert.ok(cap.x402, 'capability has x402');
    assert.equal(cap.x402.version, '1');
    assert.ok(cap.x402.price, 'x402 has price');
    assert.ok(typeof cap.x402.price.amount === 'string', 'x402.price.amount is string');
    assert.equal(cap.x402.price.currency, 'USDC');
    assert.ok(Array.isArray(cap.x402.chains), 'x402.chains is array');
    assert.ok(cap.x402.chains.includes(8453), 'chains includes Base mainnet (8453)');
    assert.ok(typeof cap.x402.facilitator === 'string', 'x402.facilitator is string');
  });
});
