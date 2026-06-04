#!/usr/bin/env node
// =============================================================================
// octra-verify — Layer 0 live-node probe for the OCT funding rail
// =============================================================================
//
// Settles the [UNCERTAIN] facts the rail depends on, against a real node, BEFORE
// any mainnet build. Read-only — needs no private key. Octra validators are
// currently private, so finality (item 2) likely needs a direct answer from the
// Octra team; this script settles the mechanical items (decimals, head-epoch,
// RPC shapes, message survivability).
//
// Usage:
//   OCTRA_RPC_URL=https://octra.network \
//   OCTRA_PROBE_ADDRESS=oct... \           # an address with known history
//   OCTRA_PROBE_TXHASH=...      \          # a known tx hash to inspect
//   node --import tsx scripts/octra-verify.ts
//
// It does NOT assert; it REPORTS. Read the output, then update OCT_DECIMALS,
// the OctraClient method names, and docs/octra-blind-issuance.md Layer 0.
// =============================================================================

const RPC = process.env.OCTRA_RPC_URL ?? 'https://octra.network'
const ADDR = process.env.OCTRA_PROBE_ADDRESS
const TXHASH = process.env.OCTRA_PROBE_TXHASH

const HEAD_METHODS = ['octra_head', 'octra_finalizedEpoch', 'octra_status', 'octra_chainInfo']
const ACCOUNT_METHODS = ['octra_account', 'octra_getAccount', 'octra_address']
const TX_METHODS = ['octra_transaction', 'octra_getTransaction', 'octra_tx']
const BAL_METHODS = ['octra_balance', 'octra_getBalance']

async function rpc(method: string, params: unknown[]): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const res = await fetch(RPC + '/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } }
    if (body.error) return { ok: false, error: body.error.message ?? 'rpc error' }
    return { ok: true, result: body.result }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function probe(label: string, methods: string[], params: unknown[]): Promise<void> {
  console.log(`\n=== ${label} ===`)
  for (const m of methods) {
    const r = await rpc(m, params)
    if (r.ok) {
      console.log(`  [FOUND] ${m} →`, JSON.stringify(r.result).slice(0, 600))
    } else {
      console.log(`  [----]  ${m}: ${r.error}`)
    }
  }
}

async function main(): Promise<void> {
  console.log(`Octra Layer 0 probe → ${RPC}`)
  console.log('Octra validators are private; finality must be confirmed with the Octra team separately.')

  await probe('1. HEAD / FINALIZED EPOCH (Layer 0 item 3)', HEAD_METHODS, [])

  if (ADDR) {
    await probe('2. ACCOUNT / HISTORY shape + pagination (item 5)', ACCOUNT_METHODS, [ADDR, 5])
    await probe('   BALANCE shape', BAL_METHODS, [ADDR])
  } else {
    console.log('\n(set OCTRA_PROBE_ADDRESS to probe account/history/balance shapes)')
  }

  if (TXHASH) {
    await probe('3. TX DETAIL — inspect amount units (item 1) + message field (item 4)', TX_METHODS, [TXHASH])
    console.log('\n  >> Check: is `amount` integer µOCT (1 OCT = 1e6)? Is `message` present + returned?')
    console.log('  >> Check: which fields are inside the signed blob (sig verification)?')
  } else {
    console.log('\n(set OCTRA_PROBE_TXHASH to inspect amount units + message survivability)')
  }

  console.log('\nDone. Update OCT_DECIMALS, OctraClient method names, and Layer 0 flags from the FOUND shapes.')
}

main().catch((err) => { console.error('probe failed:', err); process.exit(1) })
