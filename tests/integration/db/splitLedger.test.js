// tests/integration/db/splitLedger.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb } = require('../../helpers/setup');
const SplitLedgerDB = require('../../../src/core/services/db/splitLedgerDb');

describe('SplitLedgerDB', () => {
  before(async () => { await getTestDb(); });
  after(async () => {
    const splitDb = new SplitLedgerDB(console);
    await splitDb.deleteOne({ runId: 'run-001' });
    await splitDb.deleteOne({ runId: 'test-run-unclaimed-1' });
    await splitDb.deleteOne({ runId: 'test-run-unclaimed-2' });
    await splitDb.deleteOne({ runId: 'test-run-unclaimed-3' });
    await closeTestDb();
  });

  test('createEntry inserts with pending status', async () => {
    const splitDb = new SplitLedgerDB(console);
    const result = await splitDb.createEntry({
      partnerId: 'pk_test_abc',
      runId: 'run-001',
      spellSlug: 'my-spell',
      uploadId: 'upload-001',
      grossAmount: '1000000',
      partnerAmount: '50000',
      asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      network: 'eip155:8453',
    });
    assert.ok(result.insertedId);
  });

  test('markCredited transitions status to credited', async () => {
    const splitDb = new SplitLedgerDB(console);
    await splitDb.markCredited('run-001');
    const entries = await splitDb.findByPartnerId('pk_test_abc');
    assert.equal(entries[0].status, 'credited');
  });

  test('partnerTotal returns sum of credited partnerAmount', async () => {
    const splitDb = new SplitLedgerDB(console);
    const total = await splitDb.partnerTotal('pk_test_abc');
    assert.equal(total, 50000);
  });

  test('createUnclaimedAgentOwnerEntry stores unclaimed entry', async () => {
    const db = new SplitLedgerDB(console);
    const result = await db.createUnclaimedAgentOwnerEntry({
      runId: 'test-run-unclaimed-1',
      spellSlug: 'test-spell',
      agentId: 'agent_abc',
      ownerAddress: '0xdeadbeef',
      pointsAmount: 14,
    });
    assert.ok(result.insertedId);

    const entry = await db.findOne({ runId: 'test-run-unclaimed-1' });
    assert.equal(entry.type, 'agent_owner_unclaimed');
    assert.equal(entry.status, 'pending');
    assert.equal(entry.pointsAmount, 14);
    assert.equal(entry.ownerAddress, '0xdeadbeef');
  });

  test('findUnclaimed returns pending agent_owner_unclaimed entries', async () => {
    const db = new SplitLedgerDB(console);
    await db.createUnclaimedAgentOwnerEntry({
      runId: 'test-run-unclaimed-2',
      spellSlug: 'test-spell',
      agentId: 'agent_abc',
      ownerAddress: '0xcafe',
      pointsAmount: 20,
    });
    const entries = await db.findUnclaimed(10);
    assert.ok(entries.some(e => e.runId === 'test-run-unclaimed-2'));
  });

  test('markAgentOwnerCredited transitions status to credited', async () => {
    const db = new SplitLedgerDB(console);
    await db.createUnclaimedAgentOwnerEntry({
      runId: 'test-run-unclaimed-3',
      spellSlug: 'test-spell',
      agentId: 'agent_abc',
      ownerAddress: '0xfeed',
      pointsAmount: 7,
    });
    await db.markAgentOwnerCredited('test-run-unclaimed-3');
    const entry = await db.findOne({ runId: 'test-run-unclaimed-3' });
    assert.equal(entry.status, 'credited');
    assert.ok(entry.creditedAt instanceof Date);
  });
});
