/**
 * Agent Session API Integration Tests
 *
 * Tests all four agent session endpoints: manifest, revoke, payout-policy, earnings.
 * All dependencies are mocked — no MongoDB or HTTP calls are made.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

const { createAgentSessionApi } = require('../../../../src/api/external/agents/agentSessionApi');

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeMockAgentAccount(overrides = {}) {
  return {
    agentAccountId: 'cmw_test01',
    agentId: 'agent-42',
    treasuryId: 'camel-1',
    tokenId: '42',
    scope: ['spell.image.generate'],
    balance: 1000,
    status: 'active',
    workspaceSlug: 'testslug',
    sessionIssuedAt: new Date(Date.now() - 3600000),
    sessionExpiresAt: new Date(Date.now() + 86400000),
    ...overrides,
  };
}

function makeMockTreasury(overrides = {}) {
  return {
    treasuryId: 'camel-1',
    issuerDomain: 'camelcabal.fun',
    faucetPolicy: { monthlyMax: 500 },
    ...overrides,
  };
}

function makeMockAgentAccountDb(agentAccount, overrides = {}) {
  return {
    findByAgentAccountId: async (id) => (id === (agentAccount && agentAccount.agentAccountId) ? agentAccount : null),
    revoke: async () => ({ modifiedCount: 1 }),
    setPayoutPolicy: async () => ({ modifiedCount: 1 }),
    ...overrides,
  };
}

function makeMockTreasuryDb(treasury, overrides = {}) {
  return {
    findByTreasuryId: async (id) => (id === (treasury && treasury.treasuryId) ? treasury : null),
    ...overrides,
  };
}

// ─── Test app factory ─────────────────────────────────────────────────────────

function createTestApp({
  agentAccount = makeMockAgentAccount(),
  treasury = makeMockTreasury(),
  agentAccountDbOverrides = {},
  treasuryDbOverrides = {},
  splitLedgerDb = null,
} = {}) {
  const app = express();
  app.use(express.json());

  const router = createAgentSessionApi({
    agentAccountDb: makeMockAgentAccountDb(agentAccount, agentAccountDbOverrides),
    treasuryDb: makeMockTreasuryDb(treasury, treasuryDbOverrides),
    splitLedgerDb,
    logger: { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} },
  });

  app.use('/', router);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Agent Session API — GET /agents/:agentAccountId/manifest', () => {
  // 1. Valid agentAccountId → 200 with full manifest
  test('Valid agentAccountId → 200 with full manifest (all fields present)', async () => {
    const app = createTestApp();
    const res = await supertest(app).get('/agents/cmw_test01/manifest');

    assert.equal(res.status, 200);
    assert.equal(res.body.platform, 'noema.art');
    assert.ok(Array.isArray(res.body.scope));
    assert.ok(typeof res.body.issuedAt === 'number');
    assert.ok(typeof res.body.expiresAt === 'number');
    assert.ok(res.body.workspaceURL.includes('testslug'));
    assert.ok(res.body.billing);
    assert.equal(res.body.billing.model, 'treasury-funded');
    assert.equal(res.body.billing.treasuryRef, 'camel-1');
    assert.ok(typeof res.body.billing.agentBalance === 'string');
    assert.ok(typeof res.body.billing.monthlyCap === 'string');
    assert.equal(res.body.billing.currency, 'USDC');
  });

  // 1b. Active manifest includes status: 'active'
  test('Active account manifest includes status: "active"', async () => {
    const app = createTestApp();
    const res = await supertest(app).get('/agents/cmw_test01/manifest');

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'active');
  });

  // 1c. Revoked account → 200 lean response (no billing/workspaceURL)
  test('Revoked account → 200 lean response with status: "revoked"', async () => {
    const app = createTestApp({
      agentAccount: makeMockAgentAccount({ status: 'revoked' }),
    });
    const res = await supertest(app).get('/agents/cmw_test01/manifest');

    assert.equal(res.status, 200);
    assert.equal(res.body.platform, 'noema.art');
    assert.equal(res.body.agentAccountId, 'cmw_test01');
    assert.equal(res.body.status, 'revoked');
    // Should NOT have billing or workspaceURL
    assert.equal(res.body.billing, undefined);
    assert.equal(res.body.workspaceURL, undefined);
  });

  // 2. agentAccountId not found → 404 NOT_FOUND
  test('agentAccountId not found → 404 NOT_FOUND', async () => {
    const app = createTestApp({ agentAccount: null });
    const res = await supertest(app).get('/agents/cmw_missing/manifest');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // 3. Treasury missing → 500 INTERNAL_ERROR
  test('Treasury missing → 500 INTERNAL_ERROR', async () => {
    const app = createTestApp({ treasury: null });
    const res = await supertest(app).get('/agents/cmw_test01/manifest');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  // 4. Verify pointsToUsd conversion: 1000 points → "0.34" (1000 * 0.000337 = 0.337 → "0.34")
  test('pointsToUsd conversion: 1000 points → agentBalance "0.34"', async () => {
    const app = createTestApp({ agentAccount: makeMockAgentAccount({ balance: 1000 }) });
    const res = await supertest(app).get('/agents/cmw_test01/manifest');

    assert.equal(res.status, 200);
    assert.equal(res.body.billing.agentBalance, '0.34');
  });
});

describe('Agent Session API — POST /sessions/:agentAccountId/revoke', () => {
  // 5. Active account → revoke → 200 with revoked status
  test('Active account → revoke → 200 with agentAccountId, status, revokedAt', async () => {
    const app = createTestApp();
    const res = await supertest(app).post('/sessions/cmw_test01/revoke');

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_test01');
    assert.equal(res.body.status, 'revoked');
    assert.ok(typeof res.body.revokedAt === 'string');
    // revokedAt should be a valid ISO timestamp
    assert.ok(!isNaN(Date.parse(res.body.revokedAt)));
  });

  // 6. Already revoked → 200 idempotent (not an error)
  test('Already revoked → 200 idempotent response', async () => {
    const app = createTestApp({
      agentAccount: makeMockAgentAccount({ status: 'revoked' }),
    });
    const res = await supertest(app).post('/sessions/cmw_test01/revoke');

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_test01');
    assert.equal(res.body.status, 'revoked');
  });

  // 7. agentAccountId not found → 404 NOT_FOUND
  test('agentAccountId not found → 404 NOT_FOUND', async () => {
    const app = createTestApp({ agentAccount: null });
    const res = await supertest(app).post('/sessions/cmw_missing/revoke');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // 8. DB revoke fails → 500 INTERNAL_ERROR
  test('DB revoke fails → 500 INTERNAL_ERROR', async () => {
    const app = createTestApp({
      agentAccountDbOverrides: {
        revoke: async () => { throw new Error('MongoDB write failed'); },
      },
    });
    const res = await supertest(app).post('/sessions/cmw_test01/revoke');

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });
});

// ─── Tests: PATCH /agents/:agentAccountId/payout-policy ─────────────────────

describe('Agent Session API — PATCH /agents/:agentAccountId/payout-policy', () => {
  // 8. Valid PATCH with mode self-fund → 200 with updated policy
  test('Valid PATCH mode "self-fund" → 200 with payoutPolicy', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_test01');
    assert.equal(res.body.payoutPolicy.mode, 'self-fund');
    assert.equal(res.body.payoutPolicy.withdrawAddress, null);
  });

  // 9. Valid PATCH with mode withdraw + valid ETH address → 200
  test('Valid PATCH mode "withdraw" + valid ETH address → 200', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'withdraw', withdrawAddress: '0xAbCd1234567890abcdef1234567890abcdef1234' });

    assert.equal(res.status, 200);
    assert.equal(res.body.payoutPolicy.mode, 'withdraw');
    assert.equal(res.body.payoutPolicy.withdrawAddress, '0xAbCd1234567890abcdef1234567890abcdef1234');
  });

  // 10. Mode withdraw without withdrawAddress → 400
  test('Mode "withdraw" without withdrawAddress → 400', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'withdraw' });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  // 11. Invalid mode → 400
  test('Invalid mode → 400', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'drain' });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  // 12. Invalid ETH address format → 400
  test('Invalid ETH address format → 400', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'split', withdrawAddress: 'not-an-eth-address' });

    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  // 13. Agent not found → 404
  test('Agent not found → 404', async () => {
    const app = createTestApp({ agentAccount: null });
    const res = await supertest(app)
      .patch('/agents/cmw_missing/payout-policy')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });
});

// ─── Tests: GET /agents/:agentAccountId/earnings ─────────────────────────────

describe('Agent Session API — GET /agents/:agentAccountId/earnings', () => {
  function makeMockSplitLedgerDb(entries = [], overrides = {}) {
    return {
      findByAgentId: async (_agentId, _limit) => entries,
      ...overrides,
    };
  }

  const creditedEntry = {
    spellSlug: 'generate-image',
    grossAmount: '50000',
    status: 'credited',
    createdAt: new Date('2026-05-01T10:00:00Z'),
  };
  const pendingEntry = {
    spellSlug: 'generate-image',
    grossAmount: '50000',
    status: 'pending',
    createdAt: new Date('2026-05-02T10:00:00Z'),
  };

  // 14. No splitLedgerDb → 200 with empty totals
  test('No splitLedgerDb → 200 with zero totals and empty recentRuns', async () => {
    const app = createTestApp({ splitLedgerDb: null });
    const res = await supertest(app).get('/agents/cmw_test01/earnings');

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_test01');
    assert.equal(res.body.agentId, 'agent-42');
    assert.equal(res.body.totals.creditedRuns, 0);
    assert.equal(res.body.totals.grossAtomicUsdc, '0');
    assert.deepEqual(res.body.recentRuns, []);
  });

  // 15. Agent not found → 404
  test('Unknown agentAccountId → 404 NOT_FOUND', async () => {
    const app = createTestApp({ agentAccount: null });
    const res = await supertest(app).get('/agents/cmw_missing/earnings');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  // 16. Credited entries summed correctly
  test('Credited entries → correct totals and recentRuns shape', async () => {
    const app = createTestApp({
      splitLedgerDb: makeMockSplitLedgerDb([creditedEntry, pendingEntry]),
    });
    const res = await supertest(app).get('/agents/cmw_test01/earnings');

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.creditedRuns, 1, 'only credited entries counted');
    assert.equal(res.body.totals.grossAtomicUsdc, '50000');
    assert.equal(res.body.recentRuns.length, 2, 'all entries in recentRuns');
    const first = res.body.recentRuns[0];
    assert.equal(first.spell, 'generate-image');
    assert.equal(first.grossAmount, '50000');
    assert.ok(typeof first.timestamp === 'number');
  });

  // 17. splitLedgerDb query failure → 200 with empty (non-fatal)
  test('splitLedgerDb query throws → 200 with empty totals (non-fatal)', async () => {
    const app = createTestApp({
      splitLedgerDb: makeMockSplitLedgerDb([], {
        findByAgentId: async () => { throw new Error('DB unavailable'); },
      }),
    });
    const res = await supertest(app).get('/agents/cmw_test01/earnings');

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.creditedRuns, 0);
  });
});

// ─── Tests: PATCH /agents/:agentAccountId/payout-policy — auth enforcement ───
// These tests exercise Finding #2 fix: when agentJwtVerifier is injected the
// endpoint requires a valid CAMEL JWT whose agentId matches the account.

function makeMockAgentJwtVerifier(overrides = {}) {
  return {
    verifyAssertionJwt: async (_token, _issuerDomain) => ({ agentId: 'agent-42' }),
    ...overrides,
  };
}

function createTestAppWithAuth({
  agentAccount = makeMockAgentAccount(),
  treasury = makeMockTreasury(),
  agentAccountDbOverrides = {},
  treasuryDbOverrides = {},
  agentJwtVerifierOverrides = {},
} = {}) {
  const app = express();
  app.use(express.json());
  const router = createAgentSessionApi({
    agentAccountDb: makeMockAgentAccountDb(agentAccount, agentAccountDbOverrides),
    treasuryDb: makeMockTreasuryDb(treasury, treasuryDbOverrides),
    agentJwtVerifier: makeMockAgentJwtVerifier(agentJwtVerifierOverrides),
    logger: { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} },
  });
  app.use('/', router);
  return app;
}

describe('Agent Session API — PATCH /agents/:agentAccountId/payout-policy (auth enforced)', () => {
  // 17. No Authorization header → 401
  test('No Authorization header → 401 UNAUTHORIZED', async () => {
    const app = createTestAppWithAuth();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // 18. Authorization header not "Bearer <token>" → 401
  test('Authorization header not "Bearer <token>" → 401 UNAUTHORIZED', async () => {
    const app = createTestAppWithAuth();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .set('Authorization', 'Basic dXNlcjpwYXNz')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // 19. Token present but verifyAssertionJwt throws a generic error → 401
  test('Invalid/expired JWT → 401 UNAUTHORIZED', async () => {
    const app = createTestAppWithAuth({
      agentJwtVerifierOverrides: {
        verifyAssertionJwt: async () => { throw new Error('jwt expired'); },
      },
    });
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .set('Authorization', 'Bearer bad.token.here')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // 20. JWKS unavailable → 503
  test('JWKS unavailable → 503 SERVICE_UNAVAILABLE', async () => {
    const jwksErr = Object.assign(new Error('JWKS fetch failed'), { name: 'JwksUnavailableError' });
    const app = createTestAppWithAuth({
      agentJwtVerifierOverrides: {
        verifyAssertionJwt: async () => { throw jwksErr; },
      },
    });
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .set('Authorization', 'Bearer some.token')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  // 21. JWT's agentId doesn't match the account → 403
  test('JWT agentId mismatch → 403 FORBIDDEN', async () => {
    const app = createTestAppWithAuth({
      agentJwtVerifierOverrides: {
        verifyAssertionJwt: async () => ({ agentId: 'different-agent-99' }),
      },
    });
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .set('Authorization', 'Bearer valid.token')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  // 22. Treasury missing for account → 500 (misconfiguration)
  test('Treasury not found for account → 500 INTERNAL_ERROR', async () => {
    const app = createTestAppWithAuth({ treasury: null });
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .set('Authorization', 'Bearer valid.token')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  });

  // 23. Valid JWT with matching agentId → 200 (happy path with auth enforced)
  test('Valid JWT with matching agentId → 200', async () => {
    const app = createTestAppWithAuth();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .set('Authorization', 'Bearer valid.camel.token')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_test01');
    assert.equal(res.body.payoutPolicy.mode, 'self-fund');
  });

  // 24. Without agentJwtVerifier, no auth required (backward compat)
  test('Without agentJwtVerifier, no auth required (backward compat)', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .patch('/agents/cmw_test01/payout-policy')
      .send({ mode: 'self-fund' });

    assert.equal(res.status, 200);
  });
});
