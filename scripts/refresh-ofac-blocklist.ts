// Sync the OFAC SDN crypto-address blocklist used by the deposit sanctions screen.
//
// OFAC publishes sanctioned digital-currency addresses inside the SDN list. This
// pulls the well-known machine-readable mirror (0xB10C/ofac-sanctioned-digital-
// currency-addresses, refreshed daily from OFAC's own SDN.XML) for the chains we
// settle on — Ethereum (mainnet) and, since CreditVault is on Base too, the same
// ETH-address set applies (Base addresses are EVM addresses on the same list).
//
// Run: npx tsx scripts/refresh-ofac-blocklist.ts [outPath]
//   outPath — defaults to data/ofac-blocklist.json (point OFAC_BLOCKLIST_PATH here).
//
// This is the FRESHNESS seam for the SanctionsScreen: the screen is real and
// Set-backed, but only as current as this file. Run it on a schedule (cron/CI)
// before go-live and daily after. Exits non-zero on fetch/parse failure so a
// scheduled run surfaces staleness instead of silently writing an empty list.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// 0xB10C mirror — per-chain JSON arrays of lowercase 0x addresses, sourced from OFAC SDN.XML.
const SOURCES = [
  'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json',
]

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? 'data/ofac-blocklist.json'
  const merged = new Set<string>()

  for (const url of SOURCES) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`)
    const list = (await res.json()) as unknown
    if (!Array.isArray(list)) throw new Error(`source ${url} is not a JSON array`)
    for (const a of list) {
      if (typeof a === 'string' && a.startsWith('0x')) merged.add(a.toLowerCase())
    }
  }

  if (merged.size === 0) throw new Error('refused to write an empty OFAC blocklist — sources returned nothing')

  const addresses = [...merged].sort()
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(addresses, null, 0) + '\n')
  console.log(`OFAC blocklist: wrote ${addresses.length} addresses → ${outPath}`)
}

main().catch((err) => {
  console.error('OFAC blocklist refresh failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
