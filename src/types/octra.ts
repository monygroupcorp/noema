// =============================================================================
// OCTRA — native OCT funding rail for Arcanum notes
// =============================================================================
//
// A third ingestion rail. An OCT payment on the Octra network funds the EXACT
// SAME Arcanum note as the EVM rail — it ends in arcanumTree.insert(commitment,
// valor). No circuit change, no tree change, no spend-path change. OCT- and
// EVM-funded leaves co-mingle in one anonymity set.
//
// This file holds only types. Mechanics live in:
//   src/octra/OctraClient.ts        — RPC seam (all wire UNCERTAINty quarantined)
//   src/octra/octraPricing.ts       — µOCT → valor
//   src/crystal/MongoOctraDeposit.ts — durable per-deposit state machine + cursor
//   src/crystal/OctraWatcher.ts     — the poll loop calling arcanumTree.insert
//   src/api/octra/octraRouter.ts    — deposit-intent registration endpoint
//
// CANONICAL BINDING: single-use deposit address (NOT the tx `message` field).
// The platform derives a fresh oct-address per commitment, maps address→commitment
// server-side, and recovers the commitment from the immutable signed `to_` field.
//
// LAUNCH BLOCKERS (verify on a live mainnet-alpha node — Octra validators are
// currently private, so finality cannot be independently verified; we proceed
// treating it as legitimate and record the residual risk):
//   - finality/reorg semantics (tree.insert is irreversible)
//   - decimal scale (assumed 1 OCT = 1_000_000 µOCT)
//   - authenticated head-epoch RPC exists
// See docs/octra-blind-issuance.md Layer 0.
// =============================================================================

/** BN254 / alt-bn128 scalar field order. A commitment must be in [1, ORDER). */
export const BN254_FIELD_ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

/** Assumed micro-unit scale: 1 OCT = 10^OCT_DECIMALS µOCT. [UNCERTAIN — verify on live node] */
export const OCT_DECIMALS = 6

export type OctraDepositStatus =
  | 'expectatum'   // intent registered (address→commitment), awaiting funding tx
  | 'confirmatum'  // funding tx confirmed at depth, awaiting a valid price
  | 'processatum'  // valor minted, leaf inserted — terminal success
  | 'remansum'     // received but un-mintable (terminal): bad-message | dup-commitment | dust | shielded

export type OctraRemansumReason =
  | 'bad-message'
  | 'dup-commitment'
  | 'dust'
  | 'shielded'

/** One deposit, from intent through terminal state. Collection: octra_deposits. */
export interface OctraDeposit {
  id: string
  depositAddr: string              // single-use oct-address; the recovery key for the commitment
  commitment?: string              // recovered commitment (decimal field-element string)
  status: OctraDepositStatus
  reason?: OctraRemansumReason     // set only on remansum
  txHash?: string                  // locally-recomputed funding tx hash, once seen + verified
  epoch?: number                   // epoch the funding tx landed in
  amountMicro?: string             // integer µOCT, read from the confirmed on-chain tx (never user-claimed)
  octUsdRate?: string              // pinned at confirmation
  fundingRate?: string             // pinned at confirmation
  valor?: string                   // bigint serialized as decimal string
  natum: Date
  mutatum: Date
}

/** Normalized inbound transaction — dialect-independent (OctraClient produces this). */
export interface OctraTx {
  hash: string                     // recomputed locally from canonical bytes — NOT trusted from the node
  to: string                       // recipient oct-address (the `to_` field) — a platform address
  from: string                     // plaintext sender — verified for signature, then DISCARDED, never stored
  amount: bigint                   // µOCT, parsed from the node's decimal string
  nonce: number                    // sender account nonce (NOT a global ordering key)
  timestamp: number                // Unix seconds (advisory; client-supplied)
  epoch: number | null             // null while in staging / unconfirmed
  message: string | null           // optional memo (fallback binding only)
  signature: string                // base64 Ed25519 detached signature
  publicKey: string                // base64 Ed25519 verify key
}

/** Resume marker. One doc per platform-seed scope. Collection: octra_cursors. */
export interface OctraCursor {
  id: string                       // scope key (the platform identity); also _id
  lastEpoch: number                // highest fully-processed epoch
  lastTxHash: string               // most recent processed tx hash (walk recognizer, fallback scheme)
  lastSeenAt: number               // Unix seconds — ops hint
  mutatum: Date
}

/** Durable deposit state machine + cursor. */
export interface OctraDepositorum {
  /** Register intent: persist address→commitment, return the new deposit. */
  registerIntent(depositAddr: string, commitment: string): Promise<OctraDeposit>
  byDepositAddr(depositAddr: string): Promise<OctraDeposit | null>
  byTxHash(txHash: string): Promise<OctraDeposit | null>
  /** Atomic first-writer claim of a funding tx (unique txHash). True = claimed by us. */
  claimTx(txHash: string): Promise<boolean>
  save(d: OctraDeposit): Promise<void>
  /** Deposits still in flight: status in {expectatum, confirmatum}. */
  pending(): Promise<OctraDeposit[]>
  // cursor
  getCursor(scope: string): Promise<OctraCursor | null>
  saveCursor(c: OctraCursor): Promise<void>
}

/** RPC seam. ALL wire UNCERTAINty lives behind this interface. */
export interface OctraClient {
  // --- read (watcher) ---
  /** Authenticated chain head — NEVER derive from max(epoch) of a history page. [Layer 0 item 3] */
  fetchHeadEpoch(): Promise<number>
  /** Scheme A: the (≤1) funding tx for a single-use deposit address, or null. */
  fetchInbound(addr: string): Promise<OctraTx | null>
  /** Fallback scheme: newest-first inbound page for a shared address. */
  fetchHistory(addr: string, limit: number): Promise<OctraTx[]>
  /** Full tx detail (amount/message/nonce/epoch). */
  fetchTxDetail(hash: string): Promise<OctraTx>
  getBalance(addr: string): Promise<{ balanceMicro: bigint; nonce: number }>
  // --- write (sweeper only; signs locally) ---
  submitTx(signed: unknown): Promise<{ hash: string }>
}
