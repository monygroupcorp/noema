// tests/integration/db/partner.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb } = require('../../helpers/setup');
const PartnerDB = require('../../../src/core/services/db/partnerDb');

describe('PartnerDB', () => {
  let db;
  before(async () => { ({ db } = await getTestDb()); });
  after(async () => {
    const partnerDb = new PartnerDB(console);
    await partnerDb.deleteOne({ partnerId: 'pk_test_abc123' });
    await closeTestDb();
  });

  test('createPartner inserts and findPartnerById retrieves', async () => {
    const partnerDb = new PartnerDB(console);
    const result = await partnerDb.createPartner({
      name: 'Test Site',
      partnerId: 'pk_test_abc123',
      allowedDomains: ['testsite.com'],
      splitBps: 500,
    });
    assert.ok(result.insertedId);

    const found = await partnerDb.findPartnerById('pk_test_abc123');
    assert.equal(found.name, 'Test Site');
    assert.equal(found.status, 'active');
  });

  test('findPartnerByDomain returns partner for registered domain', async () => {
    const partnerDb = new PartnerDB(console);
    const found = await partnerDb.findPartnerByDomain('testsite.com');
    assert.ok(found);
    assert.equal(found.partnerId, 'pk_test_abc123');
  });
});
