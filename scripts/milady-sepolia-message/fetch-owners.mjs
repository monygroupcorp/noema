#!/usr/bin/env node
// Pulls the current owner of every Milady (token ids 0..9999) from Ethereum
// mainnet as of one pinned block, via plain JSON-RPC batch requests to a
// public node (no API key). Writes the result to owners.json beside this
// script.
//
// Usage: node scripts/milady-sepolia-message/fetch-owners.mjs

const MILADY_CONTRACT = '0x5af0d9827e0c53e4799bb226655a1de152a425a5'; // Milady Maker (name "Milady", symbol "MIL"), verified via name()/symbol()/totalSupply() on-chain
const TOTAL_SUPPLY = 10000; // confirmed via totalSupply() == 0x2710
const RPC_URL = 'https://ethereum-rpc.publicnode.com';
const BATCH_SIZE = 200;
const BATCH_DELAY_MS = 150;

const OWNER_OF_SELECTOR = '6352211e';

function ownerOfCallData(tokenId) {
  return '0x' + OWNER_OF_SELECTOR + tokenId.toString(16).padStart(64, '0');
}

async function rpc(body) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  return res.json();
}

async function getLatestBlock() {
  const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result; // hex string
}

async function fetchBatchOwners(tokenIds, blockTag) {
  const reqs = tokenIds.map((id, i) => ({
    jsonrpc: '2.0',
    id: i,
    method: 'eth_call',
    params: [{ to: MILADY_CONTRACT, data: ownerOfCallData(id) }, blockTag],
  }));
  let results;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      results = await rpc(reqs);
      break;
    } catch (err) {
      if (attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  const byId = new Map(results.map((r) => [r.id, r]));
  return tokenIds.map((tokenId, i) => {
    const r = byId.get(i);
    if (!r || r.error || !r.result || r.result === '0x') {
      return { tokenId, owner: null, error: r?.error ?? 'empty result' };
    }
    const owner = '0x' + r.result.slice(-40);
    return { tokenId, owner };
  });
}

async function main() {
  const blockTag = await getLatestBlock();
  console.error(`[fetch-owners] pinned block ${blockTag} (${parseInt(blockTag, 16)})`);

  const tokens = [];
  for (let i = 0; i < TOTAL_SUPPLY; i++) tokens.push(i);

  const results = [];
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    const batchResults = await fetchBatchOwners(batch, blockTag);
    results.push(...batchResults);
    console.error(`[fetch-owners] ${Math.min(i + BATCH_SIZE, tokens.length)}/${tokens.length}`);
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  const failed = results.filter((r) => !r.owner);
  const owners = results.filter((r) => r.owner);
  const uniqueOwners = [...new Set(owners.map((r) => r.owner))].sort();

  const out = {
    source: {
      contract: MILADY_CONTRACT,
      contractName: 'Milady',
      contractSymbol: 'MIL',
      chain: 'ethereum-mainnet',
      rpc: RPC_URL,
      method: 'ownerOf(tokenId) via eth_call, batched JSON-RPC, no API key',
      totalSupply: TOTAL_SUPPLY,
      block: blockTag,
      blockDecimal: parseInt(blockTag, 16),
      fetchedAt: new Date().toISOString(),
    },
    counts: {
      tokensQueried: tokens.length,
      tokensResolved: owners.length,
      tokensFailed: failed.length,
      uniqueOwners: uniqueOwners.length,
    },
    failedTokenIds: failed.map((f) => f.tokenId),
    ownersByTokenId: results,
    uniqueOwnerAddresses: uniqueOwners,
  };

  const outPath = new URL('./owners.json', import.meta.url);
  await import('node:fs/promises').then((fs) => fs.writeFile(outPath, JSON.stringify(out, null, 2)));
  console.error(`[fetch-owners] wrote ${outPath.pathname}`);
  console.error(`[fetch-owners] ${out.counts.uniqueOwners} unique owners, ${out.counts.tokensFailed} failed lookups`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
