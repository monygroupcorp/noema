// tests/integration/db/agentAccount.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb } = require('../../helpers/setup');
const AgentAccountDB = require('../../../src/core/services/db/agentAccountDb');

const TEST_TREASURY_ID = 'camel-agent-test-1';
const TEST_AGENT_ID = '999888777';
const TEST_TOKEN_ID = '42';
const TEST_OWNER = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const TEST_NOEMA_ACCOUNT_ID = 'aabbccddeeff001122334455';
const TEST_WORKSPACE_SLUG = 'agent-workspace-test';

describe('AgentAccountDB', () => {
  let db;
  let createdAgentAccountId;

  before(async () => { ({ db } = await getTestDb()); });
  after(async () => {
    const agentAccountDb = new AgentAccountDB(console);
    if (createdAgentAccountId) {
      await agentAccountDb.deleteOne({ agentAccountId: createdAgentAccountId });
    }
    await closeTestDb();
  });

  test('createAgentAccount generates agentAccountId starting with cmw_ and 10 chars total', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    const now = new Date();
    const expires = new Date(now.getTime() + 86400000);
    const result = await agentAccountDb.createAgentAccount({
      treasuryId: TEST_TREASURY_ID,
      agentId: TEST_AGENT_ID,
      tokenId: TEST_TOKEN_ID,
      ownerAddress: TEST_OWNER,
      noemaAccountId: TEST_NOEMA_ACCOUNT_ID,
      workspaceSlug: TEST_WORKSPACE_SLUG,
      scope: ['generate', 'read'],
      sessionIssuedAt: now,
      sessionExpiresAt: expires,
    });
    assert.ok(result.agentAccountId, 'createAgentAccount should return agentAccountId');
    assert.ok(result.insertedId, 'createAgentAccount should return insertedId');

    // Fetch the inserted doc to check agentAccountId
    const found = await agentAccountDb.findByAgentId(TEST_AGENT_ID);
    assert.ok(found);
    assert.ok(found.agentAccountId.startsWith('cmw_'), `agentAccountId should start with cmw_, got: ${found.agentAccountId}`);
    assert.equal(found.agentAccountId.length, 10, `agentAccountId should be 10 chars, got: ${found.agentAccountId.length}`);
    createdAgentAccountId = found.agentAccountId;
  });

  test('createAgentAccount sets status=active, balance=0, payoutPolicy.mode=self-fund', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    const found = await agentAccountDb.findByAgentId(TEST_AGENT_ID);
    assert.equal(found.status, 'active');
    assert.equal(found.balance, 0);
    assert.equal(found.payoutPolicy.mode, 'self-fund');
    assert.ok(found.createdAt instanceof Date);
    assert.ok(found.updatedAt instanceof Date);
  });

  test('findByAgentId returns the account', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    const found = await agentAccountDb.findByAgentId(TEST_AGENT_ID);
    assert.ok(found);
    assert.equal(found.treasuryId, TEST_TREASURY_ID);
    assert.equal(found.tokenId, TEST_TOKEN_ID);
  });

  test('findByNoemaAccountId returns the account', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    const found = await agentAccountDb.findByNoemaAccountId(TEST_NOEMA_ACCOUNT_ID);
    assert.ok(found);
    assert.equal(found.agentId, TEST_AGENT_ID);
  });

  test('findActiveByTreasuryId returns active accounts for that treasury', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    const results = await agentAccountDb.findActiveByTreasuryId(TEST_TREASURY_ID);
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1);
    assert.ok(results.every(r => r.status === 'active'));
    assert.ok(results.some(r => r.agentId === TEST_AGENT_ID));
  });

  test('addBalance increments balance', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    await agentAccountDb.addBalance(createdAgentAccountId, 75);
    const found = await agentAccountDb.findByAgentAccountId(createdAgentAccountId);
    assert.equal(found.balance, 75);
  });

  test('debitBalance decrements balance correctly', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    // balance is currently 75 from the addBalance test above
    await agentAccountDb.debitBalance(createdAgentAccountId, 30);
    const found = await agentAccountDb.findByAgentAccountId(createdAgentAccountId);
    assert.equal(found.balance, 45);
  });

  test('setStatus updates status correctly', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    await agentAccountDb.setStatus(createdAgentAccountId, 'suspended');
    const found = await agentAccountDb.findByAgentAccountId(createdAgentAccountId);
    assert.equal(found.status, 'suspended');
  });

  test('setPayoutPolicy updates payoutPolicy', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    const newPolicy = { mode: 'withdraw', withdrawAddress: '0x1234567890abcdef1234567890abcdef12345678' };
    await agentAccountDb.setPayoutPolicy(createdAgentAccountId, newPolicy);
    const found = await agentAccountDb.findByAgentAccountId(createdAgentAccountId);
    assert.equal(found.payoutPolicy.mode, 'withdraw');
    assert.equal(found.payoutPolicy.withdrawAddress, '0x1234567890abcdef1234567890abcdef12345678');
  });

  test('revoke sets status to revoked', async () => {
    const agentAccountDb = new AgentAccountDB(console);
    await agentAccountDb.revoke(createdAgentAccountId);
    const found = await agentAccountDb.findByAgentAccountId(createdAgentAccountId);
    assert.equal(found.status, 'revoked');
  });
});
