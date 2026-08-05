#!/usr/bin/env node
// READ-ONLY. Counts one user's legacy generations to size the Vestigium self-migration
// (see docs/plans/2026-06-17-vestigium-self-migration.md §5). Performs ZERO writes — only
// findOne / countDocuments / aggregate. Reads the LIVE `noema` prod DB, so it is deliberately
// query-only and never mutates anything.
//
// Usage (you supply creds — nothing is hardcoded):
//   MONGODB_URI='mongodb+srv://…'  node scripts/count-my-generations.mjs --telegram 123456789
//   MONGODB_URI='…'                node scripts/count-my-generations.mjs --wallet 0xabc…
//   MONGODB_URI='…'                node scripts/count-my-generations.mjs --account 665f…  (masterAccountId)
//
// Tip: point MONGODB_URI at a read replica if you have one. This script opens no transactions
// and issues no write commands.

import { MongoClient, ObjectId } from 'mongodb';

const DB_NAME = 'noema'; // legacy production DB (read-only here)

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('✗ Set MONGODB_URI (the legacy noema cluster). Aborting — nothing was queried.');
  process.exit(1);
}
const telegram = arg('telegram');
const wallet = arg('wallet');
const account = arg('account');
if (!telegram && !wallet && !account) {
  console.error('✗ Provide one of: --telegram <id> | --wallet <0x…> | --account <masterAccountId>');
  process.exit(1);
}

const client = new MongoClient(uri, { readPreference: 'secondaryPreferred' });

try {
  await client.connect();
  const db = client.db(DB_NAME);
  const userCore = db.collection('userCore');
  const gens = db.collection('generationOutputs');

  // 1. Resolve masterAccountId (read-only lookup).
  let masterAccountId;
  if (account) {
    masterAccountId = new ObjectId(account);
  } else if (telegram) {
    const u = await userCore.findOne({ 'platformIdentities.telegram': String(telegram) }, { projection: { _id: 1, 'profile.displayName': 1 } });
    if (!u) throw new Error(`No userCore with platformIdentities.telegram = ${telegram}`);
    masterAccountId = u._id;
    console.log(`• Resolved telegram ${telegram} → masterAccountId ${u._id} (${u.profile?.displayName ?? 'no name'})`);
  } else {
    const u = await userCore.findOne({ wallets: wallet }, { projection: { _id: 1, 'profile.displayName': 1 } });
    if (!u) throw new Error(`No userCore with wallet = ${wallet}`);
    masterAccountId = u._id;
    console.log(`• Resolved wallet ${wallet} → masterAccountId ${u._id} (${u.profile?.displayName ?? 'no name'})`);
  }

  const mine = { masterAccountId };

  // 2. Headline counts.
  const total = await gens.countDocuments(mine);
  const completed = await gens.countDocuments({ ...mine, status: 'completed' });
  const withImages = await gens.countDocuments({ ...mine, status: 'completed', artifactUrls: { $exists: true, $not: { $size: 0 } } });

  console.log('\n=== Headline ===');
  console.log(`total generations          : ${total.toLocaleString()}`);
  console.log(`  completed                : ${completed.toLocaleString()}`);
  console.log(`  completed w/ artifactUrls : ${withImages.toLocaleString()}   ← migratable into vestigia`);

  // 3. By media type (unwind artifactUrls.type), completed only.
  const byType = await gens.aggregate([
    { $match: { ...mine, status: 'completed', artifactUrls: { $exists: true, $not: { $size: 0 } } } },
    { $unwind: '$artifactUrls' },
    { $group: { _id: '$artifactUrls.type', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  console.log('\n=== By media type (artifacts) ===');
  for (const r of byType) console.log(`  ${String(r._id ?? 'unknown').padEnd(12)} ${r.n.toLocaleString()}`);

  // 4. By year.
  const byYear = await gens.aggregate([
    { $match: { ...mine, status: 'completed' } },
    { $group: { _id: { $year: '$requestTimestamp' }, n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();
  console.log('\n=== By year (completed) ===');
  for (const r of byYear) console.log(`  ${r._id ?? '—'}  ${r.n.toLocaleString()}`);

  // 5. Top tools.
  const byTool = await gens.aggregate([
    { $match: { ...mine, status: 'completed' } },
    { $group: { _id: '$toolDisplayName', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 15 },
  ]).toArray();
  console.log('\n=== Top tools (completed) ===');
  for (const r of byTool) console.log(`  ${String(r._id ?? 'unknown').padEnd(28)} ${r.n.toLocaleString()}`);

  console.log('\nDone. (No writes were performed.)');
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
