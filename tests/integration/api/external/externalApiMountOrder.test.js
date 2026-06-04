/**
 * Assembled External API — mount-order / auth-shadow regression test.
 *
 * This is the test that would have caught the CAMEL launch incident
 * (403 FORBIDDEN before the provisioning handler was ever reached).
 *
 * Unlike the per-router integration tests, this boots the FULL
 * `externalApiRouter` via `initializeExternalApi` with mocked deps, so the
 * cook/batch '/' catch-all hard-auth gate is present in the stack — exactly
 * as it is in production. If that gate is ever re-ordered ahead of the public
 * CAMEL routes again, this test fails.
 *
 * See docs/plans/2026-06-04-external-api-auth-architecture.md (Phase 0 / §6).
 */

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const express = require('express');

const { initializeExternalApi } = require('../../../../src/api/external/index');

// ─── Mocked dependencies ──────────────────────────────────────────────────────

function makeDependencies() {
  const treasury = {
    treasuryId: 'camel-1',
    issuerName: 'camel',
    issuerDomain: 'camelcabal.fun',
    balance: 1000,
    status: 'active',
    faucetPolicy: { starterGrant: 100, monthlyMax: 500, subsidyMode: 'on', refillCadence: 'monthly' },
  };

  const treasuryDb = {
    findByTreasuryId: async (id) => (id === treasury.treasuryId ? treasury : null),
    debitBalance: async () => true,
  };

  const agentAccountDb = {
    findByAgentId: async () => null,
    findByAgentAccountId: async () => null,
    createAgentAccount: async () => ({ agentAccountId: 'cmw_abc123', insertedId: 'oid' }),
    addBalance: async () => {},
    setStatus: async () => {},
  };

  // A bad (non-Noema, non-issuer) Bearer token: the verifier rejects it,
  // which the provisioning handler maps to 401 INVALID_ASSERTION.
  const agentJwtVerifier = {
    verifyAssertionJwt: async () => {
      throw new Error('invalid signature');
    },
  };

  const workspaceFactory = {
    provisionAgentWorkspace: async () => ({ workspaceId: 'fake-ws-id', slug: 'new-workspace-slug' }),
  };

  // Internal API client — never actually called in this test, but required by initializeExternalApi.
  const internalApiClient = {
    post: async () => ({ data: {} }),
    get: async () => ({ data: {} }),
  };

  return {
    internalApiClient,
    logger: { error: () => {}, warn: () => {}, debug: () => {}, info: () => {} },
    // createStatusApi throws hard if statusService is absent; a stub is enough to mount it.
    statusService: { getStatus: async () => ({ ok: true }) },
    db: {
      data: {
        treasury: treasuryDb,
        agentAccount: agentAccountDb,
        workspaces: { findOne: async () => null, createWorkspace: async () => ({}), deleteWorkspace: async () => ({}) },
        splitLedger: null,
      },
    },
    agentJwtVerifier,
    workspaceFactory,
    economyService: { creditPoints: async () => ({ entryId: 'eid' }) },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Assembled External API — auth-shadow mount order', () => {
  let app;

  before(() => {
    // The cook '/' gate engages real JWT verification; give it a secret so a
    // bad Bearer fails with 403 (the shadow) rather than 500 CONFIG_ERROR.
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-mount-order';
    app = express();
    app.use(express.json());
    app.use('/api/v1', initializeExternalApi(makeDependencies()));
  });

  test('POST /treasury/:t/agents with a non-Noema Bearer reaches the CAMEL handler (401 INVALID_ASSERTION, never 403 FORBIDDEN)', async () => {
    const res = await supertest(app)
      .post('/api/v1/treasury/camel-1/agents')
      .set('Authorization', 'Bearer not-a-noema-token')
      .send();

    // 403 FORBIDDEN here would mean the cook '/' gate shadowed the public route.
    assert.notEqual(res.status, 403, `Got 403 — the cook catch-all gate is shadowing the CAMEL route again. Body: ${JSON.stringify(res.body)}`);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_ASSERTION');
  });

  test('a genuinely protected cook route still rejects an unauthenticated request (regression guard)', async () => {
    const res = await supertest(app)
      .get('/api/v1/cooks')
      .send();

    // No credential at all → cook gate rejects. Proves the gate is still active for cook paths.
    assert.ok(res.status === 401 || res.status === 403, `Expected cook route to require auth, got ${res.status}`);
  });
});
