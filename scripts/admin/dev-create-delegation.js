// scripts/admin/dev-create-delegation.js
//
// Mints a delegation token for the dev agent and prints it.
// Run with: node scripts/admin/dev-create-delegation.js
//
// Optional env overrides:
//   AGENT_ID          — defaults to dev-agent-001
//   LABEL             — defaults to "dev"
//   SPEND_CAP         — point cap, omit for unlimited
//   EXPIRES_IN_HOURS  — omit for no expiry

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const DB_NAME   = process.env.MONGO_DB_NAME || 'noema';
const AGENT_ID  = process.env.AGENT_ID || 'dev-agent-001';
const LABEL     = process.env.LABEL || 'dev';
const CAP       = process.env.SPEND_CAP ? parseInt(process.env.SPEND_CAP, 10) : null;
const EXP_HRS   = process.env.EXPIRES_IN_HOURS ? parseInt(process.env.EXPIRES_IN_HOURS, 10) : null;

async function main() {
  const uri = process.env.MONGO_PASS;
  if (!uri) { console.error('MONGO_PASS not set'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);

  const userCore = db.collection('userCore');
  const delegations = db.collection('agent_delegations');

  const agent = await userCore.findOne({ accountType: 'agent', agentId: AGENT_ID });
  if (!agent) { console.error(`Agent not found: ${AGENT_ID}`); process.exit(1); }

  const now = new Date();
  const token = crypto.randomBytes(24).toString('hex');
  const doc = {
    agentId: AGENT_ID,
    agentAccountId: agent._id,
    token,
    label: LABEL,
    spendCapPoints: CAP,
    pointsSpent: 0,
    usageCount: 0,
    expiresAt: EXP_HRS ? new Date(Date.now() + EXP_HRS * 3600_000) : null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await delegations.insertOne(doc);

  const port = process.env.PORT || 4000;
  console.log('\n─────────────────────────────────────────');
  console.log(`  Agent:  ${AGENT_ID}`);
  console.log(`  Label:  ${LABEL}`);
  console.log(`  Cap:    ${CAP !== null ? CAP + ' pts' : 'unlimited'}`);
  console.log(`  Expiry: ${EXP_HRS ? EXP_HRS + 'h' : 'none'}`);
  console.log(`\n  Token (paste into widget code box):`);
  console.log(`\n    ${token}\n`);
  console.log('─────────────────────────────────────────\n');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
