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
});
