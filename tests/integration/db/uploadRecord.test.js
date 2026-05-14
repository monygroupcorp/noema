// tests/integration/db/uploadRecord.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb } = require('../../helpers/setup');
const UploadRecordDB = require('../../../src/core/services/db/uploadRecordDb');

describe('UploadRecordDB', () => {
  let db;
  before(async () => { ({ db } = await getTestDb()); });
  after(async () => {
    const uploadDb = new UploadRecordDB(console);
    await uploadDb.deleteOne({ uploadId: 'test-upload-id-001' });
    await closeTestDb();
  });

  test('createUploadRecord inserts with pending status', async () => {
    const uploadDb = new UploadRecordDB(console);
    const result = await uploadDb.createUploadRecord({
      uploadId: 'test-upload-id-001',
      partnerId: 'pk_test_abc',
      originDomain: 'testsite.com',
      ipHash: 'abc123hash',
    });
    assert.ok(result.insertedId);
  });

  test('findUploadRecord retrieves by uploadId with pending status', async () => {
    const uploadDb = new UploadRecordDB(console);
    const found = await uploadDb.findUploadRecord('test-upload-id-001');
    assert.equal(found.status, 'pending');
    assert.ok(found.expiresAt > new Date());
  });

  test('markUsed sets status to used and links runId', async () => {
    const uploadDb = new UploadRecordDB(console);
    await uploadDb.markUsed('test-upload-id-001', 'run-id-xyz');
    const found = await uploadDb.findUploadRecord('test-upload-id-001');
    assert.equal(found.status, 'used');
    assert.equal(found.usedInRunId, 'run-id-xyz');
  });
});
