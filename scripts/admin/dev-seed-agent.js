// scripts/admin/dev-seed-agent.js
//
// Creates a fake dev agent doc + provisions its starter workspace from the template.
// Run with: node scripts/admin/dev-seed-agent.js
//
// Requires in .env:
//   MONGO_PASS                     — MongoDB connection URI
//   MONGO_DB_NAME                  — database name (default: noema)
//   AGENT_STARTER_WORKSPACE_SLUG   — template workspace slug

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');

const DB_NAME = process.env.MONGO_DB_NAME || 'noema';

// ── Minimal WorkspaceFactory wiring (no full app boot needed) ─────────────────

// Point require paths to project root
const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

async function main() {
  const uri = process.env.MONGO_PASS;
  if (!uri) { console.error('MONGO_PASS not set'); process.exit(1); }

  const templateSlug = process.env.AGENT_STARTER_WORKSPACE_SLUG;
  if (!templateSlug) { console.error('AGENT_STARTER_WORKSPACE_SLUG not set — create an admin workspace first, then set this.'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`Connected to ${DB_NAME}`);

  const userCore = db.collection('userCore');
  const workspaces = db.collection('workspaces');
  const spells = db.collection('spells');
  const creditLedger = db.collection('credit_ledger');

  // ── 1. Upsert a dev agent doc ──────────────────────────────────────────────
  const devAgentId = 'dev-agent-001';
  const existing = await userCore.findOne({ accountType: 'agent', agentId: devAgentId });

  let agentDoc;
  if (existing) {
    agentDoc = existing;
    console.log(`Dev agent already exists: ${devAgentId} (_id: ${agentDoc._id})`);
  } else {
    const now = new Date();
    const result = await userCore.insertOne({
      accountType: 'agent',
      agentId: devAgentId,
      agentTokenId: 1,
      agentCollection: '0x0000000000000000000000000000000000000001',
      agentChainId: 1,
      agentOwnerAddress: '0xdevowner0000000000000000000000000000dead',
      profile: {
        name: 'Dev Agent',
        description: 'Seeded by dev-seed-agent.js for local widget testing.',
        image: '',
      },
      wallets: [{ address: '0xdevwallet0000000000000000000000000000dead', chainId: 1, isPrimary: true }],
      awards: [],
      status: 'active',
      userCreationTimestamp: now,
      updatedAt: now,
    });
    agentDoc = await userCore.findOne({ _id: result.insertedId });
    console.log(`Created dev agent: ${devAgentId} (_id: ${agentDoc._id})`);
  }

  // ── 2. Ensure dev wallet has credit ledger entry ───────────────────────────
  const devWallet = agentDoc.wallets?.find(w => w.isPrimary)?.address
    || '0xdevwallet0000000000000000000000000000dead';
  const existing_ledger = await creditLedger.findOne({ depositor_address: devWallet, status: 'CONFIRMED' });
  if (existing_ledger) {
    console.log(`Credit ledger entry already exists for ${devWallet} (${existing_ledger.points_remaining} pts)`);
  } else {
    const now = new Date();
    await creditLedger.insertOne({
      depositor_address: devWallet,
      status: 'CONFIRMED',
      points_remaining: 1000000,
      points_total: 1000000,
      source: 'dev-seed',
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Created credit ledger entry for ${devWallet} (1,000,000 pts)`);
  }

  // ── 3. Check if workspace already provisioned ──────────────────────────────
  if (agentDoc.starterWorkspaceSlug) {
    const ws = await workspaces.findOne({ slug: agentDoc.starterWorkspaceSlug });
    if (ws) {
      console.log(`\nWorkspace already provisioned: ${agentDoc.starterWorkspaceSlug}`);
      printSummary(agentDoc, agentDoc.starterWorkspaceSlug);
      await client.close();
      return;
    }
    console.log(`starterWorkspaceSlug set to ${agentDoc.starterWorkspaceSlug} but workspace not found — re-provisioning.`);
  }

  // ── 4. Load template ───────────────────────────────────────────────────────
  const template = await workspaces.findOne({ slug: templateSlug });
  if (!template) {
    console.error(`Template workspace not found: ${templateSlug}`);
    await client.close();
    process.exit(1);
  }
  console.log(`Template: ${template.slug} (r${template.revision ?? 1})`);

  // ── 5. Provision (inline, avoids full app boot) ────────────────────────────
  const snapshot = template.snapshot || {};

  // Clone spell windows
  const toolWindows = snapshot.toolWindows || [];
  const agentContextIds = new Set();
  const clonedWindows = [];

  for (const win of toolWindows) {
    if (win.type === 'agent-context') {
      agentContextIds.add(win.id);
      continue; // strip from agent workspace
    }

    if (!win.isSpell || !win.spell?._id) {
      clonedWindows.push({ ...win, templateWindowId: win.id });
      continue;
    }

    // Clone the spell
    let original;
    try {
      original = await spells.findOne({ _id: typeof win.spell._id === 'string' ? new ObjectId(win.spell._id) : win.spell._id });
    } catch (e) {
      console.error(`  Spell lookup error for ${win.spell._id}: ${e.message}`);
    }

    if (!original) {
      console.warn(`  Spell ${win.spell._id} not found — keeping reference`);
      clonedWindows.push({ ...win, templateWindowId: win.id });
      continue;
    }

    const clonedSlug = `${original.slug}-${crypto.randomBytes(3).toString('hex')}`;
    const clonedId = new ObjectId();
    const now = new Date();
    await spells.insertOne({
      _id: clonedId,
      slug: clonedSlug,
      name: original.name,
      description: original.description || '',
      creatorId: agentDoc._id,
      ownedBy: agentDoc._id,
      steps: JSON.parse(JSON.stringify(original.steps || [])),
      exposedInputs: JSON.parse(JSON.stringify(original.exposedInputs || [])),
      tags: original.tags || [],
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  Cloned spell ${original.slug} → ${clonedSlug}`);
    clonedWindows.push({
      ...win,
      templateWindowId: win.id,
      spell: { _id: clonedId, slug: clonedSlug, name: original.name },
    });
  }

  // Strip connections involving agent-context windows
  const filteredConnections = (snapshot.connections || []).filter(c => {
    const from = c.fromWindowId || c.from;
    const to = c.toWindowId || c.to;
    return !agentContextIds.has(from) && !agentContextIds.has(to);
  });

  const agentSnapshot = { toolWindows: clonedWindows, connections: filteredConnections };
  const sizeBytes = Buffer.byteLength(JSON.stringify(agentSnapshot), 'utf8');
  const slug = crypto.randomBytes(4).toString('hex');
  const now = new Date();

  await workspaces.insertOne({
    slug,
    ownerId: agentDoc._id,
    walletAddress: null,
    name: `Dev Agent — ${devAgentId}`,
    visibility: 'private',
    snapshot: agentSnapshot,
    sizeBytes,
    version: 1,
    isAgentStarter: true,
    origin: {
      slug: template.slug,
      ownerId: template.ownerId || null,
      walletAddress: template.walletAddress || null,
      templateRevision: template.revision ?? 1,
    },
    createdAt: now,
    updatedAt: now,
  });

  await userCore.updateOne(
    { _id: agentDoc._id },
    { $set: { starterWorkspaceSlug: slug, updatedAt: now } }
  );

  console.log(`\nWorkspace provisioned: ${slug} (${clonedWindows.filter(w => w.isSpell).length} spell(s))`);
  printSummary(agentDoc, slug);
  await client.close();
}

function printSummary(agentDoc, workspaceSlug) {
  const port = process.env.PORT || 4000;
  console.log('\n─────────────────────────────────────────');
  console.log(`  Agent ID:  ${agentDoc.agentId}`);
  console.log(`  Workspace: ${workspaceSlug}`);
  console.log(`\n  Widget endpoint:`);
  console.log(`    http://localhost:${port}/widget/${agentDoc.agentId}/workspace`);
  console.log(`\n  Widget demo page:`);
  console.log(`    http://localhost:${port}/widget-demo.html?agent=${agentDoc.agentId}`);
  console.log('─────────────────────────────────────────\n');
}

main().catch(err => { console.error(err); process.exit(1); });
