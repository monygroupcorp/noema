// tests/integration/db/treasury.test.js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { getTestDb, closeTestDb } = require('../../helpers/setup');
const TreasuryDB = require('../../../src/core/services/db/treasuryDb');

const TEST_TREASURY_ID = 'camel-test-1';
const TEST_DOMAIN = 'camelcabal-test.fun';

describe('TreasuryDB', () => {
  let db;
  before(async () => { ({ db } = await getTestDb()); });
  after(async () => {
    const treasuryDb = new TreasuryDB(console);
    await treasuryDb.deleteOne({ treasuryId: TEST_TREASURY_ID });
    await closeTestDb();
  });

  test('createTreasury inserts with status=active and timestamps', async () => {
    const treasuryDb = new TreasuryDB(console);
    const result = await treasuryDb.createTreasury({
      treasuryId: TEST_TREASURY_ID,
      issuerName: 'camel',
      issuerDomain: TEST_DOMAIN,
      faucetPolicy: {
        starterGrant: 100,
        monthlyMax: 500,
        subsidyMode: 'on',
        refillCadence: 'monthly',
      },
      balance: 0,
    });
    assert.ok(result.insertedId);
  });

  test('findByTreasuryId retrieves the record', async () => {
    const treasuryDb = new TreasuryDB(console);
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.ok(found);
    assert.equal(found.treasuryId, TEST_TREASURY_ID);
    assert.equal(found.issuerName, 'camel');
    assert.equal(found.status, 'active');
    assert.equal(found.balance, 0);
    assert.ok(found.createdAt instanceof Date);
    assert.ok(found.updatedAt instanceof Date);
  });

  test('findByIssuerDomain retrieves by domain', async () => {
    const treasuryDb = new TreasuryDB(console);
    const found = await treasuryDb.findByIssuerDomain(TEST_DOMAIN);
    assert.ok(found);
    assert.equal(found.treasuryId, TEST_TREASURY_ID);
  });

  test('addBalance increments the balance', async () => {
    const treasuryDb = new TreasuryDB(console);
    await treasuryDb.addBalance(TEST_TREASURY_ID, 50);
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.equal(found.balance, 50);
  });

  test('debitBalance returns true and decrements the balance when sufficient', async () => {
    const treasuryDb = new TreasuryDB(console);
    const result = await treasuryDb.debitBalance(TEST_TREASURY_ID, 20);
    assert.equal(result, true);
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.equal(found.balance, 30);
  });

  test('debitBalance returns false and makes no write when points > balance', async () => {
    const treasuryDb = new TreasuryDB(console);
    const result = await treasuryDb.debitBalance(TEST_TREASURY_ID, 99999);
    assert.equal(result, false);
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.equal(found.balance, 30); // unchanged
  });

  test('updateFaucetPolicy sets new policy', async () => {
    const treasuryDb = new TreasuryDB(console);
    const newPolicy = {
      starterGrant: 200,
      monthlyMax: 1000,
      subsidyMode: 'hybrid',
      refillCadence: 'weekly',
    };
    await treasuryDb.updateFaucetPolicy(TEST_TREASURY_ID, newPolicy);
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.equal(found.faucetPolicy.starterGrant, 200);
    assert.equal(found.faucetPolicy.subsidyMode, 'hybrid');
    assert.equal(found.faucetPolicy.refillCadence, 'weekly');
  });

  test('setStatus changes status to suspended', async () => {
    const treasuryDb = new TreasuryDB(console);
    await treasuryDb.setStatus(TEST_TREASURY_ID, 'suspended');
    // findByTreasuryId does not filter by status, so we use a direct findOne
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.equal(found.status, 'suspended');
  });

  test('createTreasury with partnerId stores the partnerId field', async () => {
    const altId = 'camel-test-partner';
    const treasuryDb = new TreasuryDB(console);
    const result = await treasuryDb.createTreasury({
      treasuryId: altId,
      issuerName: 'partner-test',
      issuerDomain: 'partner-test.example.com',
      faucetPolicy: { starterGrant: 10, monthlyMax: 100, subsidyMode: 'on', refillCadence: 'monthly' },
      partnerId: 'pk_live_test123',
    });
    assert.ok(result.insertedId);
    const found = await treasuryDb.findByTreasuryId(altId);
    assert.equal(found.partnerId, 'pk_live_test123');
    // Clean up
    await treasuryDb.deleteOne({ treasuryId: altId });
  });

  test('updatePartnerId sets partnerId on existing treasury', async () => {
    const treasuryDb = new TreasuryDB(console);
    await treasuryDb.updatePartnerId(TEST_TREASURY_ID, 'pk_live_updated456');
    const found = await treasuryDb.findByTreasuryId(TEST_TREASURY_ID);
    assert.equal(found.partnerId, 'pk_live_updated456');
  });
});
