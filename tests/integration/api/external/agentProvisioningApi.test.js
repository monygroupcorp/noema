/**
 * Agent Provisioning API Integration Tests
 *
 * Tests all error paths and the happy path of POST /:treasuryId/agents.
 * All dependencies are mocked — no MongoDB or HTTP calls are made.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

const { createAgentProvisioningApi } = require('../../../../src/api/external/agents/agentProvisioningApi');

// ─── Mock factories ──────────────────────────────────────────────────────────

function makeMockTreasury(overrides = {}) {
  return {
    treasuryId: 'camel-1',
    issuerName: 'camel',
    issuerDomain: 'camelcabal.fun',
    balance: 1000,
    status: 'active',
    faucetPolicy: { starterGrant: 100, monthlyMax: 500, subsidyMode: 'on', refillCadence: 'monthly' },
    ...overrides,
  };
}

function makeMockTreasuryDb(treasury, overrides = {}) {
  return {
    findByTreasuryId: async (id) => (id === (treasury && treasury.treasuryId) ? treasury : null),
    debitBalance: async () => true,
    ...overrides,
  };
}

function makeMockAgentAccountDb(overrides = {}) {
  return {
    findByAgentId: async () => null,
    createAgentAccount: async () => ({ agentAccountId: 'cmw_abc123', insertedId: 'fake-oid' }),
    addBalance: async () => {},
    setStatus: async () => {},
    ...overrides,
  };
}

function makeMockWorkspacesDb(overrides = {}) {
  return {
    findOne: async ({ slug }) => {
      if (slug === '745218a5') {
        return { slug: '745218a5', snapshot: { toolWindows: [{ templateWindowId: 'w-3', value: '' }] } };
      }
      return null;
    },
    createWorkspace: async () => ({ _id: 'fake-ws-id', slug: 'new-workspace-slug' }),
    ...overrides,
  };
}

function makeMockAgentJwtVerifier(payload, overrides = {}) {
  return {
    verifyAssertionJwt: async () => payload,
    ...overrides,
  };
}

function makeMockEconomyService(overrides = {}) {
  return {
    creditPoints: async () => ({ entryId: 'fake-entry-id' }),
    ...overrides,
  };
}

function makeMockInternalApiClient(overrides = {}) {
  return {
    post: async (url) => {
      if (url.includes('find-or-create-by-wallet')) {
        return { data: { user: { _id: 'aabbccddeeff001122334455' } } };
      }
      // session callback — just resolve
      return { data: {} };
    },
    ...overrides,
  };
}

const DEFAULT_JWT_PAYLOAD = {
  agentId: '999888777',
  tokenId: '42',
  owner_at_assertion: '0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef',
  scope: ['generate', 'read'],
  spending_cap: { amount: '100', currency: 'points', period: 'monthly' },
  exp: Math.floor(Date.now() / 1000) + 3600,
};

// ─── Test app factory ─────────────────────────────────────────────────────────

const DEFAULT_AGENT_CARD = {
  profile: { name: 'Test Agent', description: 'A test agent', image: null },
  collection: 'camel',
  agentId: 'agent-1',
};

function createTestApp({
  treasury = makeMockTreasury(),
  treasuryDbOverrides = {},
  agentAccountDbOverrides = {},
  workspacesDbOverrides = {},
  jwtPayload = DEFAULT_JWT_PAYLOAD,
  jwtVerifierOverrides = {},
  economyServiceOverrides = {},
  internalApiClientOverrides = {},
  agentCardFetcher = async () => DEFAULT_AGENT_CARD,
} = {}) {
  const app = express();
  app.use(express.json());

  const router = createAgentProvisioningApi({
    treasuryDb: makeMockTreasuryDb(treasury, treasuryDbOverrides),
    agentAccountDb: makeMockAgentAccountDb(agentAccountDbOverrides),
    workspacesDb: makeMockWorkspacesDb(workspacesDbOverrides),
    agentJwtVerifier: makeMockAgentJwtVerifier(jwtPayload, jwtVerifierOverrides),
    economyService: makeMockEconomyService(economyServiceOverrides),
    internalApiClient: makeMockInternalApiClient(internalApiClientOverrides),
    agentCardFetcher,
    logger: { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} },
  });

  app.use('/treasury', router);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Agent Provisioning API', () => {
  // 1. Happy path
  test('Happy path: valid JWT, active treasury, all services succeed → 202 with provisioning response', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 202);
    assert.ok(typeof res.body.agentAccountId === 'string');
    assert.ok(res.body.manifestURI.includes(res.body.agentAccountId));
    assert.ok(res.body.revokeURI.includes(res.body.agentAccountId));
    assert.ok(typeof res.body.balance.amount === 'string');
    assert.equal(res.body.balance.currency, 'USDC');
  });

  // 2. Idempotency
  test('Idempotency: findByAgentId returns active record → 200 with existing record, no treasury debit', async () => {
    const existingAccount = {
      agentAccountId: 'cmw_exist1',
      status: 'active',
      balance: 50,
    };
    let debitCalled = false;
    const app = createTestApp({
      agentAccountDbOverrides: {
        findByAgentId: async () => existingAccount,
      },
      treasuryDbOverrides: {
        debitBalance: async () => { debitCalled = true; return true; },
      },
    });

    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 200);
    assert.equal(res.body.agentAccountId, 'cmw_exist1');
    assert.ok(res.body.manifestURI.includes('cmw_exist1'));
    assert.equal(debitCalled, false, 'Treasury should not be debited on idempotent request');
  });

  // 3. Missing Authorization header
  test('Missing Authorization header → 401 UNAUTHORIZED', async () => {
    const app = createTestApp();
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .send();

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  // 4. Treasury not found
  test('Treasury not found → 404 TREASURY_NOT_FOUND', async () => {
    const app = createTestApp({ treasury: null });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'TREASURY_NOT_FOUND');
  });

  // 5. Treasury suspended
  test('Treasury suspended → 403 TREASURY_SUSPENDED', async () => {
    const app = createTestApp({ treasury: makeMockTreasury({ status: 'suspended' }) });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'TREASURY_SUSPENDED');
  });

  // 6. Treasury balance < starterGrant
  test('Treasury balance < starterGrant → 402 INSUFFICIENT_FUNDS (pre-check)', async () => {
    const app = createTestApp({
      treasury: makeMockTreasury({ balance: 50, faucetPolicy: { starterGrant: 100, monthlyMax: 500, subsidyMode: 'on', refillCadence: 'monthly' } }),
    });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'INSUFFICIENT_FUNDS');
  });

  // 7. JWT expired
  test('JWT expired → 401 INVALID_ASSERTION', async () => {
    const app = createTestApp({
      jwtVerifierOverrides: {
        verifyAssertionJwt: async () => {
          const err = new Error('jwt expired');
          err.name = 'AssertionExpiredError';
          throw err;
        },
      },
    });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer expired-token')
      .send();

    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_ASSERTION');
  });

  // 8. JWKS unavailable
  test('JWKS unavailable → 503 SERVICE_UNAVAILABLE', async () => {
    const app = createTestApp({
      jwtVerifierOverrides: {
        verifyAssertionJwt: async () => {
          const err = new Error('JWKS fetch failed');
          err.name = 'JwksUnavailableError';
          throw err;
        },
      },
    });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer bad-token')
      .send();

    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  // 9. find-or-create-by-wallet fails
  test('find-or-create-by-wallet fails → 503 ACCOUNT_SERVICE_UNAVAILABLE', async () => {
    const app = createTestApp({
      internalApiClientOverrides: {
        post: async (url) => {
          if (url.includes('find-or-create-by-wallet')) {
            throw new Error('Network error');
          }
          return { data: {} };
        },
      },
    });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'ACCOUNT_SERVICE_UNAVAILABLE');
  });

  // 10. Workspace creation fails
  test('Workspace creation fails → 503 WORKSPACE_CREATION_FAILED', async () => {
    const app = createTestApp({
      workspacesDbOverrides: {
        findOne: async ({ slug }) => {
          if (slug === '745218a5') {
            return { slug: '745218a5', snapshot: { toolWindows: [] } };
          }
          return null;
        },
        createWorkspace: async () => { throw new Error('MongoDB error'); },
      },
    });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'WORKSPACE_CREATION_FAILED');
  });

  // 11. Race condition: debitBalance returns false
  test('Race condition: debitBalance returns false → 402 INSUFFICIENT_FUNDS, agentAccount suspended', async () => {
    let suspendedId = null;
    const app = createTestApp({
      treasuryDbOverrides: {
        debitBalance: async () => false,
      },
      agentAccountDbOverrides: {
        findByAgentId: async () => null,
        createAgentAccount: async () => ({ agentAccountId: 'cmw_race01', insertedId: 'fake-oid' }),
        addBalance: async () => {},
        setStatus: async (id, status) => { suspendedId = id; return {}; },
      },
    });

    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'INSUFFICIENT_FUNDS');
    assert.equal(suspendedId, 'cmw_race01', 'Agent account should be suspended on debit failure');
  });

  // 12. Card fetch failure → still returns 202 (fallback values used)
  test('Card fetch failure → still returns 202 (fallback values used)', async () => {
    const app = createTestApp({
      agentCardFetcher: async () => null,
      workspacesDbOverrides: {
        findOne: async ({ slug }) => {
          if (slug === '745218a5') {
            return { slug: '745218a5', snapshot: { toolWindows: [] } };
          }
          return null;
        },
        createWorkspace: async () => ({ _id: 'fake', slug: 'new-slug' }),
      },
    });

    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 202);
    assert.ok(res.body.agentAccountId);
  });

  // 13. creditPoints failure → still returns 202 (non-fatal)
  test('creditPoints failure → still returns 202 (non-fatal)', async () => {
    const app = createTestApp({
      economyServiceOverrides: {
        creditPoints: async () => { throw new Error('Economy service down'); },
      },
    });
    const res = await supertest(app)
      .post('/treasury/camel-1/agents')
      .set('Authorization', 'Bearer valid-token')
      .send();

    assert.equal(res.status, 202);
    assert.ok(res.body.agentAccountId);
  });
});
