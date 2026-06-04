// =============================================================================
// OctraClient — the RPC seam. ALL Octra wire UNCERTAINty is quarantined here.
// =============================================================================
//
// Build against the CURRENT webcli JSON-RPC 2.0 dialect (POST /rpc; methods
// octra_account, octra_transaction, octra_submit, octra_balance, + a head/
// finalized-epoch method). The archived octra_pre_client REST paths
// (/address/{addr}, /tx/{hash}, /send-tx, /balance, /staging) are STALE — do
// not implement them.
//
// Until verified on a live node, the exact method names and result shapes are
// [UNCERTAIN]. Everything below is normalized into the dialect-independent
// OctraTx, so resolving the wire format is a one-file change.
//
// AUTHENTICITY (required for mainnet — see docs Layer 6):
//   1. node quorum — ≥2 independently operated nodes must agree on
//      existence/amount/epoch before a tx is treated as authentic
//   2. verify the tx Ed25519 signature and RECOMPUTE the tx hash locally from
//      canonical bytes — never trust the node's reported hash
//   3. per-deposit / per-epoch valor circuit-breakers live in the watcher/pricer
//
// Octra validators are currently private, so #1 cannot fully eliminate a
// colluding-operator oracle. We proceed treating finality as legitimate and
// record the residual risk; run your OWN node(s) as the real mitigation.
// =============================================================================

import { makeLogger } from '../lib/logger.js'
import type { OctraClient, OctraTx } from '../types/octra.js'

const log = makeLogger('octra:client')

export interface OctraClientConfig {
  /** One or more node URLs. ≥2 enables quorum (recommended for mainnet). */
  rpcUrls: string[]
  /** Quorum size that must agree on existence/amount/epoch. Default 1 (DEV ONLY). */
  quorum?: number
  timeoutMs?: number
}

interface JsonRpcResult {
  result?: unknown
  error?: { code: number; message: string }
}

/**
 * HTTP JSON-RPC implementation. The method names + result parsing marked
 * [UNCERTAIN] MUST be confirmed against a live node (run scripts/octra-verify.ts).
 */
export class HttpOctraClient implements OctraClient {
  private readonly quorum: number
  private readonly timeoutMs: number

  constructor(private readonly cfg: OctraClientConfig) {
    this.quorum = cfg.quorum ?? 1
    this.timeoutMs = cfg.timeoutMs ?? 10_000
    if (this.quorum > cfg.rpcUrls.length) {
      throw new Error(`octra quorum ${this.quorum} exceeds node count ${cfg.rpcUrls.length}`)
    }
    if (this.quorum < 2) {
      log.warn('octra client running WITHOUT quorum — DEV ONLY, not mainnet-safe', { nodes: cfg.rpcUrls.length })
    }
  }

  // --- low-level JSON-RPC against one node -----------------------------------

  private async rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await fetch(url + '/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`octra rpc ${method} → HTTP ${res.status}`)
      const body = (await res.json()) as JsonRpcResult
      if (body.error) throw new Error(`octra rpc ${method} → ${body.error.code} ${body.error.message}`)
      return body.result
    } finally {
      clearTimeout(t)
    }
  }

  /** Run a read across the quorum and require agreement on the normalized value. */
  private async quorumRead<T>(method: string, params: unknown[], normalize: (raw: unknown) => T, eq: (a: T, b: T) => boolean): Promise<T> {
    const results: T[] = []
    for (const url of this.cfg.rpcUrls) {
      try {
        results.push(normalize(await this.rpc(url, method, params)))
      } catch (err) {
        log.warn('octra node read failed', { url, method, error: String(err) })
      }
    }
    if (results.length < this.quorum) {
      throw new Error(`octra quorum not met for ${method}: ${results.length}/${this.quorum}`)
    }
    const agree = results.filter((r) => eq(r, results[0]!)).length
    if (agree < this.quorum) {
      throw new Error(`octra nodes disagree on ${method}`)
    }
    return results[0]!
  }

  // --- public API ------------------------------------------------------------
  //
  // The method names and field mappings below are [UNCERTAIN] until verified.
  // normalizeTx() is where the wire shape becomes OctraTx; it MUST also verify
  // the Ed25519 signature and recompute the hash locally (TODO — see codec).

  async fetchHeadEpoch(): Promise<number> {
    // [UNCERTAIN] method name — likely octra_head / octra_finalizedEpoch.
    return this.quorumRead(
      'octra_head',
      [],
      (raw) => Number((raw as { epoch?: number })?.epoch ?? raw),
      (a, b) => a === b,
    )
  }

  async fetchInbound(addr: string): Promise<OctraTx | null> {
    const page = await this.fetchHistory(addr, 1)
    return page.find((tx) => tx.to === addr) ?? null
  }

  async fetchHistory(addr: string, limit: number): Promise<OctraTx[]> {
    // [UNCERTAIN] octra_account → { transactions: [...] }; newest-first assumed.
    const raw = await this.rpc(this.cfg.rpcUrls[0]!, 'octra_account', [addr, limit])
    const txs = ((raw as { transactions?: unknown[] })?.transactions ?? []) as unknown[]
    return txs.map((t) => this.normalizeTx(t))
  }

  async fetchTxDetail(hash: string): Promise<OctraTx> {
    return this.quorumRead(
      'octra_transaction',
      [hash],
      (raw) => this.normalizeTx(raw),
      (a, b) => a.hash === b.hash && a.amount === b.amount && a.epoch === b.epoch,
    )
  }

  async getBalance(addr: string): Promise<{ balanceMicro: bigint; nonce: number }> {
    const raw = (await this.rpc(this.cfg.rpcUrls[0]!, 'octra_balance', [addr])) as { balance?: string; nonce?: number }
    return { balanceMicro: BigInt(raw?.balance ?? '0'), nonce: Number(raw?.nonce ?? 0) }
  }

  async submitTx(signed: unknown): Promise<{ hash: string }> {
    const raw = (await this.rpc(this.cfg.rpcUrls[0]!, 'octra_submit', [signed])) as { hash?: string }
    if (!raw?.hash) throw new Error('octra_submit returned no hash')
    return { hash: raw.hash }
  }

  // --- normalization + authenticity -----------------------------------------

  /**
   * Map a raw node tx into OctraTx. [UNCERTAIN] field names.
   * TODO before mainnet: verify Ed25519 signature over canonical bytes and
   * recompute the hash locally (port from octra-labs/webcli tx_builder); reject
   * if the recomputed hash != reported hash. Until then the `hash` is the node's.
   */
  private normalizeTx(raw: unknown): OctraTx {
    const t = raw as Record<string, unknown>
    return {
      hash: String(t.hash ?? ''),
      to: String(t.to_ ?? t.to ?? ''),
      from: String(t.from ?? ''),
      amount: BigInt(String(t.amount ?? '0')),
      nonce: Number(t.nonce ?? 0),
      timestamp: Number(t.timestamp ?? 0),
      epoch: t.epoch == null ? null : Number(t.epoch),
      message: (t.message as string | undefined) ?? null,
      signature: String(t.signature ?? ''),
      publicKey: String(t.public_key ?? t.publicKey ?? ''),
    }
  }
}
