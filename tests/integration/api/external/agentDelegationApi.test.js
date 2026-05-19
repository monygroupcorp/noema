/**
 * Agent Delegation API Integration Tests
 *
 * Tests the single public endpoint:
 *   POST /agents/:agentId/delegations/:token/redeem
 *
 * All dependencies are mocked — no MongoDB or JWT_SECRET required in env.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');

const { createAgentDelegationApi } = require('../../../../src/api/external/agents/agentDelegationApi');

const TEST_JWT_SECRET = 'test-delegation-secret';

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockAgentDoc = {
  _id: 'agent-oid-001',
  agentId: '42',
  agentChainId: 1,
  agentTokenId: '42',
  agentCollection: '0xCamelCollection',
  scope: ['generate'],
  profile: { name: 'Test Agent' },
};

function makeMockDelegation(overrides = {}) {
  return {
    _id: 'deleg-oid-001',
    agentId: '42',
    agentAccountId: 'agent-oid-001',
    token: 'opaque-token-abc',
    label: 'test link',
    spendCapPoints: null,
    pointsSpent: 0,
    revokedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeMockDelegationsDb(delegation, overrides = {}) {
  return {
    findByToken: async (token) => (delegation && delegation.token === token ? delegation : null),
    ...overrides,
  };
}

function makeMockUserCoreDb(agentDoc, overrides = {}) {
  return {
    findUserCoreById: async (id) => (agentDoc && agentDoc._id === String(id) ? agentDoc : null),
    ...overrides,
  };
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function createTestApp({
  delegation = makeMockDelegation(),
  agentDoc = mockAgentDoc,
  delegationsDbOverrides = {},
  userCoreDbOverrides = {},
} = {}) {
  const app = express();
  app.use(express.json());
  const router = createAgentDelegationApi({
    db: {
      agentDelegations: makeMockDelegationsDb(delegation, delegationsDbOverrides),
      userCore: makeMockUserCoreDb(agentDoc, userCoreDbOverrides),
    },
    logger: { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} },
  });
  app.use('/', router);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Set JWT_SECRET for the entire suite
before(() => { process.env.JWT_SECRET = TEST_JWT_SECRET; });
after(() => { delete process.env.JWT_SECRET; });

describe('Agent Delegation API — POST /agents/:agentId/delegations/:token/redeem', () => {

  // 1. Happy path — no spend cap
  test('Valid token, no cap → 200 with agent profile and session cookie', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.sessionType, 'delegation');
    assert.equal(res.body.agent.agentId, '42');
    assert.ok(res.body.agent._id, 'agent._id present');
    assert.ok(Array.isArray(res.body.agent.scope), 'agent.scope is array');

    // Cookie must be set
    const cookies = res.headers['set-cookie'];
    assert.ok(cookies && cookies.length > 0, 'Set-Cookie header present');
    const cookieStr = cookies[0];
    assert.ok(cookieStr.startsWith('jwt='), 'cookie is named jwt');
    assert.ok(cookieStr.includes('HttpOnly'), 'cookie is HttpOnly');
  });

  // 2. Happy path — JWT payload has correct fields
  test('Session JWT has correct payload fields', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 200);

    const cookieStr = res.headers['set-cookie'][0];
    const rawJwt = cookieStr.split('=')[1].split(';')[0];
    const payload = jwt.verify(rawJwt, TEST_JWT_SECRET);

    assert.equal(payload.agentId, '42');
    assert.equal(payload.sessionType, 'delegation');
    assert.equal(payload.delegationId, 'deleg-oid-001');
    assert.equal(payload.masterAccountId, 'agent-oid-001');
    assert.equal(payload.delegationRemainingPoints, undefined, 'no cap = no remainingPoints in JWT');
  });

  // 3. Happy path — with spend cap, remaining points included in JWT
  test('With spend cap → delegationRemainingPoints in JWT', async () => {
    const delegation = makeMockDelegation({ spendCapPoints: 500, pointsSpent: 150 });
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 200);

    const cookieStr = res.headers['set-cookie'][0];
    const rawJwt = cookieStr.split('=')[1].split(';')[0];
    const payload = jwt.verify(rawJwt, TEST_JWT_SECRET);

    assert.equal(payload.delegationRemainingPoints, 350);
  });

  // 4. Token not found → 401
  test('Unknown token → 401 INVALID_TOKEN', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .post('/42/delegations/wrong-token/redeem');

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_TOKEN');
  });

  // 5. Token belongs to different agentId → 401
  test('Token agentId mismatch → 401 INVALID_TOKEN', async () => {
    const delegation = makeMockDelegation({ agentId: '99' }); // token is for agent 99
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem'); // but URL says agent 42

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_TOKEN');
  });

  // 6. Delegation revoked → 410
  test('Revoked delegation → 410 REVOKED', async () => {
    const delegation = makeMockDelegation({ revokedAt: new Date(Date.now() - 1000) });
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, 'REVOKED');
  });

  // 7. Delegation expired → 410
  test('Expired delegation → 410 EXPIRED', async () => {
    const delegation = makeMockDelegation({ expiresAt: new Date(Date.now() - 60000) });
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, 'EXPIRED');
  });

  // 8. Spend cap exhausted → 402
  test('Spend cap exhausted (pointsSpent >= spendCapPoints) → 402 CAP_EXHAUSTED', async () => {
    const delegation = makeMockDelegation({ spendCapPoints: 200, pointsSpent: 200 });
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'CAP_EXHAUSTED');
  });

  // 9. Spend cap partially used but not exhausted — still redeemable
  test('Partial cap spend → still 200 (not exhausted)', async () => {
    const delegation = makeMockDelegation({ spendCapPoints: 200, pointsSpent: 199 });
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 200);
  });

  // 10. Agent doc missing from userCore → 404
  test('Agent account not found in userCore → 404 NOT_FOUND', async () => {
    const app = createTestApp({ agentDoc: null });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // 11. JWT_SECRET missing → 500
  test('JWT_SECRET not set → 500 INTERNAL_ERROR', async () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    const app = createTestApp();
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 500);

    process.env.JWT_SECRET = saved;
  });

  // 12. No Set-Cookie on error — cookie not leaked on failure
  test('Failed redeem does not set a cookie', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .post('/42/delegations/wrong-token/redeem');

    assert.equal(res.status, 401);
    const cookies = res.headers['set-cookie'];
    assert.ok(!cookies || cookies.length === 0, 'no cookie on failed redeem');
  });

  // 13. Null spend cap (unlimited) → no delegationRemainingPoints in JWT
  test('Null spend cap → no delegationRemainingPoints in JWT payload', async () => {
    const delegation = makeMockDelegation({ spendCapPoints: null });
    const app = createTestApp({ delegation });
    const res = await supertest(app)
      .post('/42/delegations/opaque-token-abc/redeem');

    assert.equal(res.status, 200);
    const cookieStr = res.headers['set-cookie'][0];
    const rawJwt = cookieStr.split('=')[1].split(';')[0];
    const payload = jwt.verify(rawJwt, TEST_JWT_SECRET);
    assert.equal(payload.delegationRemainingPoints, undefined);
  });
});
