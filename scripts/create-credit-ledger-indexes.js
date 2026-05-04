require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB_NAME || 'noema';

async function createCreditLedgerIndexes() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db(DB_NAME);
    const collection = db.collection('credit_ledger');
    
    console.log('Creating indexes for credit_ledger collection...');
    
    // Critical: Unique index on deposit_tx_hash to prevent duplicates
    try {
      await collection.createIndex(
        { deposit_tx_hash: 1 },
        { unique: true, background: true, name: 'idx_deposit_tx_hash_unique' }
      );
      console.log('✓ Created unique index on deposit_tx_hash');
    } catch (error) {
      if (error.code === 85) {
        console.log('⚠ Index on deposit_tx_hash already exists with different options');
      } else {
        throw error;
      }
    }
    
    // Critical: Index on request_tx_hash for withdrawal requests
    await collection.createIndex(
      { request_tx_hash: 1 },
      { background: true, name: 'idx_request_tx_hash' }
    );
    console.log('✓ Created index on request_tx_hash');
    
    // Critical: Compound index for findActiveDepositsForUser
    await collection.createIndex(
      { master_account_id: 1, status: 1, points_remaining: 1 },
      { background: true, name: 'idx_master_status_points' }
    );
    console.log('✓ Created compound index on master_account_id + status + points_remaining');
    
    // Critical: Compound index for findActiveDepositsForWalletAddress
    await collection.createIndex(
      { depositor_address: 1, status: 1, points_remaining: 1 },
      { background: true, name: 'idx_depositor_status_points' }
    );
    console.log('✓ Created compound index on depositor_address + status + points_remaining');
    
    // High: Index for status queries and processable entries
    await collection.createIndex(
      { status: 1, updatedAt: -1 },
      { background: true, name: 'idx_status_updated' }
    );
    console.log('✓ Created index on status + updatedAt');
    
    // Medium: Referral vault indexes
    await collection.createIndex(
      { vault_name: 1, type: 1 },
      { unique: true, background: true, name: 'idx_vault_name_type', partialFilterExpression: { type: 'REFERRAL_VAULT' } }
    );
    console.log('✓ Created unique compound index on vault_name + type');
    
    // CreditVault: referral key indexes for dashboard aggregations and vault lookup
    await collection.createIndex(
      { referral_key: 1, status: 1 },
      { background: true, name: 'idx_referral_key_status', partialFilterExpression: { referral_key: { $exists: true } } }
    );
    console.log('✓ Created compound index on referral_key + status');

    await collection.createIndex(
      { referral_key: 1, type: 1 },
      { background: true, name: 'idx_referral_key_type', partialFilterExpression: { type: 'REFERRAL_VAULT' } }
    );
    console.log('✓ Created compound index on referral_key + type');

    await collection.createIndex(
      { master_account_id: 1, type: 1, is_active: 1 },
      { background: true, name: 'idx_master_type_active' }
    );
    console.log('✓ Created compound index on master_account_id + type + is_active');
    
    // Medium: Aggregation optimization for vault stats
    await collection.createIndex(
      { vault_account: 1, status: 1 },
      { background: true, name: 'idx_vault_account_status' }
    );
    console.log('✓ Created compound index on vault_account + status');
    
    // Index for finding referral vaults by registration transaction hash
    await collection.createIndex(
      { registration_tx_hash: 1, type: 1 },
      { background: true, name: 'idx_registration_tx_hash_type', partialFilterExpression: { type: 'REFERRAL_VAULT' } }
    );
    console.log('✓ Created compound index on registration_tx_hash + type');
    
    // Critical: Unique compound index for contributor reward tally upserts
    await collection.createIndex(
      { master_account_id: 1, type: 1, reward_category: 1 },
      { unique: true, background: true, name: 'idx_reward_tally_upsert', partialFilterExpression: { type: 'CONTRIBUTOR_REWARD_TALLY' } }
    );
    console.log('✓ Created unique compound index for reward tally upserts');

    // Contributor reward leaderboard on userEconomy collection
    const userEconomyCollection = db.collection('userEconomy');
    await userEconomyCollection.createIndex(
      { 'contributorRewards.totalLifetimePoints': -1 },
      { background: true, name: 'idx_contributor_leaderboard', sparse: true }
    );
    console.log('✓ Created leaderboard index on userEconomy.contributorRewards.totalLifetimePoints');

    console.log('\n✅ All credit_ledger indexes created successfully!');

    // List all indexes for verification
    const indexes = await collection.indexes();
    console.log('\n📋 Current indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });
    
  } catch (error) {
    console.error('Error creating indexes:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the script
createCreditLedgerIndexes().catch(console.error);

