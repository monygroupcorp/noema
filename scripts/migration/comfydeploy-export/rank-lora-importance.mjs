#!/usr/bin/env node
/**
 * Rank the CD-only LoRAs by real-world importance, using the generation corpus + DB usageCount,
 * so the models→R2 recovery hunt is prioritized (chase the heavily-used ones; deprioritize dead weight).
 *
 * Importance signal per LoRA = max of:
 *   - loraModels.usageCount      (the app's own per-LoRA usage counter; prod noema)
 *   - corpusUses                 (# of generations whose prompt contains <lora:<name>...>),
 *                                 counted across noema.generationOutputs.input_prompt
 *                                 AND stationthisbot.gens.promptObj.{prompt,userPrompt,basePrompt}
 *
 * Read-only. Reads prod noema (usageCount + noema prompts) and legacy stationthisbot (prompts).
 * Joins to comfydeploy-archive/loras.reconciliation.json mustRecover[] (the 212 CD-only orphans).
 *
 * Usage: ALLOW_PROD=1 node scripts/migration/comfydeploy-export/rank-lora-importance.mjs
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';

function loadEnv(p) { const e = {}; if (!fs.existsSync(p)) return e;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ''); } return e; }
const repoRoot = path.resolve(new URL('../../..', import.meta.url).pathname);
const env = { ...loadEnv(path.join(repoRoot, '.env')), ...process.env };
if (env.ALLOW_PROD !== '1') { console.error('Set ALLOW_PROD=1 (reads prod noema, read-only).'); process.exit(1); }

const recon = JSON.parse(fs.readFileSync(path.join(repoRoot, 'comfydeploy-archive/loras.reconciliation.json'), 'utf8'));
const orphans = recon.mustRecover; // 212: CD_ONLY + ORPHAN_NO_RECORD
// candidate name keys per orphan: the filename stem (== slug) and a few normalizations
const stem = (f) => f.replace(/\.safetensors$/i, '');
const orphanKeys = new Map(); // lowercased name -> orphan
for (const o of orphans) {
  const s = stem(o.filename).toLowerCase();
  orphanKeys.set(s, o);
  orphanKeys.set(s.replace(/-[0-9a-f]{6}$/, ''), o); // strip slug hash suffix
  if (o.name) orphanKeys.set(String(o.name).toLowerCase(), o);
}

const LORA_TAG = /<lora:([^:>]+)/gi;
const corpusUses = new Map(); // loraName(lower) -> count
function tallyPrompt(text) {
  if (!text || typeof text !== 'string') return;
  const seen = new Set();
  for (const m of text.matchAll(LORA_TAG)) { const k = m[1].trim().toLowerCase(); if (!seen.has(k)) { seen.add(k); corpusUses.set(k, (corpusUses.get(k) || 0) + 1); } }
}

const client = new MongoClient(env.MONGODB_URI);
await client.connect();

// 1) usageCount from loraModels (prod noema)
const usageBySlug = new Map();
for (const d of await client.db('noema').collection('loraModels').find({}, { projection: { slug: 1, name: 1, usageCount: 1 } }).toArray()) {
  if (d.slug) usageBySlug.set(d.slug.toLowerCase(), d.usageCount || 0);
  if (d.name) usageBySlug.set(String(d.name).toLowerCase(), Math.max(usageBySlug.get(String(d.name).toLowerCase()) || 0, d.usageCount || 0));
}
console.log(`loraModels usageCount loaded: ${usageBySlug.size} keys`);

// 2) corpus prompt scan — noema
let nN = 0;
for await (const d of client.db('noema').collection('generationOutputs').find({ 'requestPayload.input_prompt': { $type: 'string' } }, { projection: { 'requestPayload.input_prompt': 1 } })) {
  tallyPrompt(d.requestPayload.input_prompt); nN++;
}
console.log(`scanned noema prompts: ${nN}`);
// 3) corpus prompt scan — legacy gens
let nL = 0;
for await (const d of client.db('stationthisbot').collection('gens').find({}, { projection: { promptObj: { prompt: 1, userPrompt: 1, basePrompt: 1 } } })) {
  const po = d.promptObj || {}; tallyPrompt(po.prompt); tallyPrompt(po.userPrompt); tallyPrompt(po.basePrompt); nL++;
}
console.log(`scanned legacy prompts: ${nL}\n`);
await client.close();

// 3) join importance to orphans
const lookupCorpus = (keys) => Math.max(0, ...keys.map(k => corpusUses.get(k) || 0));
const ranked = orphans.map(o => {
  const s = stem(o.filename).toLowerCase();
  const keys = [s, s.replace(/-[0-9a-f]{6}$/, ''), (o.name || '').toLowerCase()].filter(Boolean);
  const usage = Math.max(0, ...keys.map(k => usageBySlug.get(k) || 0));
  const corpus = lookupCorpus(keys);
  return { ...o, usageCount: usage, corpusUses: corpus, importance: Math.max(usage, corpus) };
}).sort((a, b) => b.importance - a.importance);

// output
const tsv = ['importance\tusageCount\tcorpusUses\tstatus\tgb\tfilename\tname',
  ...ranked.map(r => [r.importance, r.usageCount, r.corpusUses, r.status, r.gb.toFixed(3), r.filename, r.name || ''].join('\t'))].join('\n');
fs.writeFileSync(path.join(repoRoot, 'comfydeploy-archive/loras-ranked.tsv'), tsv);

const used = ranked.filter(r => r.importance > 0);
const unused = ranked.filter(r => r.importance === 0);
console.log('=== TOP 25 CD-only LoRAs by importance ===');
console.log('imp'.padStart(5), 'usage'.padStart(6), 'corpus'.padStart(6), '  name/file');
for (const r of ranked.slice(0, 25)) console.log(String(r.importance).padStart(5), String(r.usageCount).padStart(6), String(r.corpusUses).padStart(6), '  ' + (r.name || r.filename));
console.log(`\n${used.length} orphans HAVE usage (${(used.reduce((s,r)=>s+r.gb,0)).toFixed(1)}GB) — prioritize these`);
console.log(`${unused.length} orphans show ZERO usage (${(unused.reduce((s,r)=>s+r.gb,0)).toFixed(1)}GB) — likely low priority / dead weight`);
console.log(`\nFull ranking -> comfydeploy-archive/loras-ranked.tsv`);
