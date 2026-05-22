#!/usr/bin/env node
/**
 * availability-watcher.js — read-only RunPod availability + pricing poller.
 *
 * Polls the GraphQL API (no pods, $0) for every datacenter's GPU stock + price
 * and appends timestamped JSONL snapshots. Run on a cron (e.g. every 30 min) to
 * build the landscape needed to pick a network-volume datacenter: which DCs
 * support storage AND reliably have FLUX-capable GPUs in stock, at what price,
 * across peak/off-peak hours.
 *
 * Env:
 *   RUNPOD_API_KEY   (required)
 *   WATCHER_OUT      output JSONL path        (default ./runpod-availability.jsonl)
 *   WATCHER_MIN_VRAM minimum GPU VRAM in GB    (default 24)
 */
const fs = require('fs')

const API_KEY = process.env.RUNPOD_API_KEY
const OUT = process.env.WATCHER_OUT || './runpod-availability.jsonl'
const MIN_VRAM = Number(process.env.WATCHER_MIN_VRAM || 24)
if (!API_KEY) { console.error('RUNPOD_API_KEY not set'); process.exit(1) }

async function gql(query) {
  const res = await fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ query }),
  })
  const j = await res.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors))
  return j.data
}

async function main() {
  const ts = new Date().toISOString()
  const dcs = (await gql('query { dataCenters { id location storageSupport } }')).dataCenters
  const lines = []
  for (const dc of dcs) {
    let gpus
    try {
      gpus = (await gql(
        `query { gpuTypes { id memoryInGb ` +
        `lowestPrice(input:{gpuCount:1, dataCenterId:"${dc.id}", secureCloud:true}) ` +
        `{ stockStatus uninterruptablePrice } } }`,
      )).gpuTypes
    } catch (e) {
      console.error(`[${ts}] ${dc.id} query failed: ${e.message}`)
      continue
    }
    for (const g of gpus) {
      if ((g.memoryInGb || 0) < MIN_VRAM) continue
      const lp = g.lowestPrice || {}
      if (!lp.stockStatus) continue // GPU not offered in this DC
      lines.push(JSON.stringify({
        ts, dc: dc.id, location: dc.location, storage: !!dc.storageSupport,
        gpu: g.id, vramGb: g.memoryInGb, stock: lp.stockStatus, usdHr: lp.uninterruptablePrice,
      }))
    }
  }
  if (lines.length) fs.appendFileSync(OUT, lines.join('\n') + '\n')
  console.log(`[${ts}] wrote ${lines.length} records (${dcs.length} datacenters) to ${OUT}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
