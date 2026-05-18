/**
 * Treasury Admin API Integration Tests
 *
 * Tests all endpoints of createTreasuryAdminApi using a mock TreasuryDB.
 * Does not hit MongoDB.
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');

const { createTreasuryAdminApi } = require('../../../../src/api/internal/admin/treasuryAdminApi');

const sampleTreasury = {
  treasuryId: 'test-1',
  issuerName: 'TEST',
  issuerDomain: 'test.example.com',
  balance: 1000,
  faucetPolicy: { starterGrant: 100, monthlyMax: 500, subsidyMode: 'on', refillCadence: 'monthly' },
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeMockTreasuryDb(overrides = {}) {
  return {
    listAll: async () => [sampleTreasury],
    findByTreasuryId: async (id) => (id === 'test-1' ? sampleTreasury : null),
    createTreasury: async () => ({ insertedId: 'fake-id' }),
    addBalance: async () => {},
    debitBalance: async () => true,
    updateFaucetPolicy: async () => {},
    setStatus: async () => {},
    updatePartnerId: async () => {},
    ...overrides,
  };
}

function makeMockAgentAccountDb(overrides = {}) {
  return {
    countByTreasuryId: async () => 0,
    ...overrides,
  };
}

function createTestApp(mockDb, mockAgentAccountDb) {
  const app = express();
  app.use(express.json());
  const router = createTreasuryAdminApi({ treasuryDb: mockDb, agentAccountDb: mockAgentAccountDb || makeMockAgentAccountDb() });
  app.use('/treasury', router);
  return app;
}

describe('Treasury Admin API', () => {
  let app;

  before(() => {
    app = createTestApp(makeMockTreasuryDb());
  });

  // ─── GET / ───────────────────────────────────────────────────────────────

  test('GET / returns 200 with { treasuries: [...] }', async () => {
    const res = await supertest(app).get('/treasury');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.treasuries));
    assert.equal(res.body.treasuries[0].treasuryId, 'test-1');
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────

  test('GET /:id returns 200 with { treasury: {...}, agentCount } when found', async () => {
    const res = await supertest(app).get('/treasury/test-1');
    assert.equal(res.status, 200);
    assert.equal(res.body.treasury.treasuryId, 'test-1');
    assert.equal(typeof res.body.agentCount, 'number');
    assert.equal(res.body.agentCount, 0);
  });

  test('GET /:id returns 404 when not found', async () => {
    const res = await supertest(app).get('/treasury/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'NOT_FOUND');
  });

  // ─── POST / ───────────────────────────────────────────────────────────────

  test('POST / returns 201 with { treasuryId } on valid body', async () => {
    const res = await supertest(app)
      .post('/treasury')
      .send({
        issuerName: 'ACME',
        issuerDomain: 'acme.example.com',
        faucetPolicy: { starterGrant: 50, monthlyMax: 200, subsidyMode: 'on', refillCadence: 'monthly' },
      });
    assert.equal(res.status, 201);
    assert.ok(typeof res.body.treasuryId === 'string');
  });

  test('POST / returns 400 when issuerName is missing', async () => {
    const res = await supertest(app)
      .post('/treasury')
      .send({
        issuerDomain: 'acme.example.com',
        faucetPolicy: { starterGrant: 50, monthlyMax: 200, subsidyMode: 'on', refillCadence: 'monthly' },
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  test('POST / returns 400 when issuerDomain is missing', async () => {
    const res = await supertest(app)
      .post('/treasury')
      .send({
        issuerName: 'ACME',
        faucetPolicy: { starterGrant: 50, monthlyMax: 200, subsidyMode: 'on', refillCadence: 'monthly' },
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  test('POST / returns 400 when faucetPolicy is missing', async () => {
    const res = await supertest(app)
      .post('/treasury')
      .send({
        issuerName: 'ACME',
        issuerDomain: 'acme.example.com',
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  // ─── POST /:id/fund ───────────────────────────────────────────────────────

  test('POST /:id/fund returns 200 with { balance } on valid body', async () => {
    const updatedTreasury = { ...sampleTreasury, balance: 1500 };
    const mockDb = makeMockTreasuryDb({
      findByTreasuryId: async (id) => {
        if (id !== 'test-1') return null;
        // Return updated balance on second call (after addBalance)
        return updatedTreasury;
      },
    });
    const localApp = createTestApp(mockDb);
    const res = await supertest(localApp)
      .post('/treasury/test-1/fund')
      .send({ points: 500 });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.balance === 'number');
  });

  test('POST /:id/fund returns 400 when points is missing', async () => {
    const res = await supertest(app)
      .post('/treasury/test-1/fund')
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  test('POST /:id/fund returns 400 when points is 0 or negative', async () => {
    const res0 = await supertest(app)
      .post('/treasury/test-1/fund')
      .send({ points: 0 });
    assert.equal(res0.status, 400);
    assert.equal(res0.body.error, 'BAD_REQUEST');

    const resNeg = await supertest(app)
      .post('/treasury/test-1/fund')
      .send({ points: -10 });
    assert.equal(resNeg.status, 400);
    assert.equal(resNeg.body.error, 'BAD_REQUEST');
  });

  test('POST /:id/fund returns 404 when treasury not found', async () => {
    const res = await supertest(app)
      .post('/treasury/no-such-id/fund')
      .send({ points: 100 });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'NOT_FOUND');
  });

  // ─── POST /:id/debit ──────────────────────────────────────────────────────

  test('POST /:id/debit returns 200 with { balance } when balance is sufficient', async () => {
    const updatedTreasury = { ...sampleTreasury, balance: 900 };
    const mockDb = makeMockTreasuryDb({
      findByTreasuryId: async (id) => {
        if (id !== 'test-1') return null;
        return updatedTreasury;
      },
    });
    const localApp = createTestApp(mockDb);
    const res = await supertest(localApp)
      .post('/treasury/test-1/debit')
      .send({ points: 100 });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.balance === 'number');
  });

  test('POST /:id/debit returns 400 (INSUFFICIENT_BALANCE) when balance < points', async () => {
    const mockDb = makeMockTreasuryDb({
      debitBalance: async () => false,
    });
    const localApp = createTestApp(mockDb);
    const res = await supertest(localApp)
      .post('/treasury/test-1/debit')
      .send({ points: 5000 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'INSUFFICIENT_BALANCE');
  });

  test('POST /:id/debit returns 400 when points is missing', async () => {
    const res = await supertest(app)
      .post('/treasury/test-1/debit')
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  test('POST /:id/debit returns 400 when points is 0', async () => {
    const res = await supertest(app)
      .post('/treasury/test-1/debit')
      .send({ points: 0 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  test('POST /:id/debit returns 400 when points is negative', async () => {
    const res = await supertest(app)
      .post('/treasury/test-1/debit')
      .send({ points: -10 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  // ─── PATCH /:id/policy ────────────────────────────────────────────────────

  test('PATCH /:id/policy returns 200 with { ok: true } on valid body', async () => {
    const res = await supertest(app)
      .patch('/treasury/test-1/policy')
      .send({ starterGrant: 200 });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test('PATCH /:id/policy returns 404 when treasury not found', async () => {
    const res = await supertest(app)
      .patch('/treasury/no-such-id/policy')
      .send({ starterGrant: 200 });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'NOT_FOUND');
  });

  test('PATCH /:id/policy returns 400 for invalid subsidyMode', async () => {
    const res = await supertest(app)
      .patch('/treasury/test-1/policy')
      .send({ subsidyMode: 'turbo' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  test('PATCH /:id/policy returns 400 for invalid refillCadence', async () => {
    const res = await supertest(app)
      .patch('/treasury/test-1/policy')
      .send({ refillCadence: 'daily' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  // ─── PATCH /:id/status ────────────────────────────────────────────────────

  test('PATCH /:id/status returns 200 with { ok: true } for valid status', async () => {
    const resActive = await supertest(app)
      .patch('/treasury/test-1/status')
      .send({ status: 'active' });
    assert.equal(resActive.status, 200);
    assert.equal(resActive.body.ok, true);

    const resSuspended = await supertest(app)
      .patch('/treasury/test-1/status')
      .send({ status: 'suspended' });
    assert.equal(resSuspended.status, 200);
    assert.equal(resSuspended.body.ok, true);
  });

  test('PATCH /:id/status returns 400 for invalid status value', async () => {
    const res = await supertest(app)
      .patch('/treasury/test-1/status')
      .send({ status: 'banana' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });

  // ─── POST / with optional partnerId ──────────────────────────────────────

  test('POST / passes optional partnerId through to createTreasury', async () => {
    let capturedArgs = null;
    const mockDb = makeMockTreasuryDb({
      createTreasury: async (args) => {
        capturedArgs = args;
        return { insertedId: 'fake-id' };
      },
    });
    const localApp = createTestApp(mockDb);
    const res = await supertest(localApp)
      .post('/treasury')
      .send({
        issuerName: 'PARTNER',
        issuerDomain: 'partner.example.com',
        faucetPolicy: { starterGrant: 50, monthlyMax: 200, subsidyMode: 'on', refillCadence: 'monthly' },
        partnerId: 'pk_live_abc123',
      });
    assert.equal(res.status, 201);
    assert.equal(capturedArgs.partnerId, 'pk_live_abc123');
  });

  // ─── PATCH /:id/partner ───────────────────────────────────────────────────

  test('PATCH /:id/partner returns 200 { ok: true } for valid partnerId', async () => {
    const res = await supertest(app)
      .patch('/treasury/test-1/partner')
      .send({ partnerId: 'pk_live_xyz789' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  test('PATCH /:id/partner returns 404 when treasury not found', async () => {
    const res = await supertest(app)
      .patch('/treasury/no-such-id/partner')
      .send({ partnerId: 'pk_live_xyz789' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'NOT_FOUND');
  });

  test('PATCH /:id/partner returns 400 when partnerId is missing', async () => {
    const res = await supertest(app)
      .patch('/treasury/test-1/partner')
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
  });
});
