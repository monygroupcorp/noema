// =============================================================================
// x402 — pay-per-call capability serving for on-chain agents (ADR-0011 §5).
// =============================================================================
//
// x402 is HTTP 402 Payment Required with the Coinbase CDP facilitator: an external
// on-chain agent discovers a Noema agent's spell, is quoted a USDC price, pays with
// an `X-PAYMENT` header, and the platform verifies → runs → settles the USDC. The
// Noema agent's OWNER takes a rev-share skim. This is the product moat — "the premise".
//
// Everything here is either a wire DTO (PaymentRequirements/Quote) or an INJECTED
// SEAM (the facilitator = on-chain verify/settle; the payment log = replay-protected
// audit trail; the owner-reward sink). No new domain noun: the run is a normal
// crystal run, the owner reward is normal `reward` signa, the payment log is
// operational plumbing (like the wide-event store), and the facilitator is edge I/O.

// ---------------------------------------------------------------------------
// Wire DTOs — the x402 protocol shapes (x402Version 2)
// ---------------------------------------------------------------------------

/** One accepted payment method in a 402 response. */
export interface X402Accept {
  scheme: 'exact'
  /** CAIP-2 network id, e.g. `eip155:8453` (Base). */
  network: string
  /** Token contract, e.g. USDC on Base. */
  asset: string
  /** Price in the token's atomic units (USDC = 6 decimals), decimal string. */
  amount: string
  /** Receiver address. */
  payTo: string
  maxTimeoutSeconds: number
  extra?: { name: string; version: string }
}

/** The `paymentRequired` body of a 402 response. */
export interface PaymentRequirements {
  x402Version: 2
  resource: { url: string; description: string; mimeType: string }
  accepts: X402Accept[]
}

/** A human-facing cost breakdown returned alongside the 402 (and by discover). */
export interface X402Quote {
  baseCostUsd: number
  markupUsd: number
  totalCostUsd: number
  totalCostAtomic: string
  currency: 'USDC'
  network: string
  payTo: string
}

// ---------------------------------------------------------------------------
// Facilitator seam — on-chain verify + settle (injected; edge I/O)
// ---------------------------------------------------------------------------

export interface X402VerifyResult {
  valid: boolean
  /** The payer wallet address (lowercased) on success. */
  payer?: string
  /** Amount paid in atomic units (decimal string). */
  amount?: string
  /** Stable hash of the payment signature — the replay key. */
  signatureHash?: string
  error?: string
}

export interface X402SettleResult {
  success: boolean
  /** On-chain settlement tx hash. */
  transaction?: string
  error?: string
}

/**
 * The CDP-facilitator seam. Real impl talks to the Coinbase facilitator over HTTP;
 * hermetic tests inject a fake. `verify` checks the `X-PAYMENT` header against the
 * requirements; `settle` executes the on-chain USDC transfer after a successful run.
 */
export interface X402Facilitator {
  verify(paymentHeader: string, accept: X402Accept): Promise<X402VerifyResult>
  settle(paymentHeader: string, accept: X402Accept): Promise<X402SettleResult>
}

// ---------------------------------------------------------------------------
// Payment log — replay-protected audit trail (operational store)
// ---------------------------------------------------------------------------

export type X402Status = 'VERIFIED' | 'SETTLED' | 'FAILED'

export interface X402LogEntry {
  /** Unique — the replay key (hash of the payment signature). */
  signatureHash: string
  payer: string
  amount: string
  network: string
  asset: string
  payTo: string
  agentId: string
  spellName: string
  modusId: string
  costUsd: number
  status: X402Status
  runId?: string
  txHash?: string
  failureReason?: string
  verifiedAt: Date
  settledAt?: Date
  failedAt?: Date
}

export interface X402LogStore {
  /**
   * Record a verified payment. MUST fail (throw / return false) if `signatureHash`
   * already exists — that is the replay guard (backed by a unique index).
   */
  recordVerified(entry: Omit<X402LogEntry, 'status' | 'verifiedAt'>): Promise<boolean>
  recordSettled(signatureHash: string, txHash: string, runId?: string): Promise<void>
  recordFailed(signatureHash: string, reason: string): Promise<void>
  find(signatureHash: string): Promise<X402LogEntry | null>
}
