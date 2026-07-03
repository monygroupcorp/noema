// =============================================================================
// CdpX402Facilitator — the real on-chain verify/settle edge for x402 (ADR-0011 §5).
// =============================================================================
//
// The x402 router (x402AgentRouter) drives the whole state machine over an injected
// `X402Facilitator` seam; this adapter is the one implementation that actually moves
// USDC. It wraps the Coinbase CDP facilitator client (`@x402/core` + `@coinbase/x402`,
// resolved at the edge in index.ts since `node10` can't see their `exports` maps) and
// maps our wire shapes ↔ theirs.
//
// The adapter itself imports NOTHING from those packages — the client + the header
// decoder are INJECTED. That keeps it pure crystal TypeScript, hermetically testable
// against a fake client, and confines the untyped third-party `require()` to index.ts.
//
// Security contract: we hand the CDP facilitator OUR own `PaymentRequirements` (derived
// from our quote), never the payer-supplied `accepted` block inside the header. CDP's
// verify checks the signed authorization against those requirements, so a client cannot
// under-pay by claiming a cheaper price. The replay key is a stable hash of the raw
// `X-PAYMENT` header (it embeds the signed authorization's unique nonce).

import { createHash } from 'node:crypto'
import type {
  X402Accept, X402Facilitator, X402VerifyResult, X402SettleResult,
} from '../types/x402.js'

// ── The CDP client surface we depend on (a subset of @x402/core's HTTPFacilitatorClient) ──

/** CDP PaymentRequirements — mirrors our X402Accept, `extra` widened to a bag. */
export interface CdpPaymentRequirements {
  scheme: string
  network: string
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra: Record<string, unknown>
}

/** The decoded `X-PAYMENT` header (from decodePaymentSignatureHeader). */
export interface CdpPaymentPayload {
  x402Version: number
  resource: unknown
  accepted: CdpPaymentRequirements
  payload: Record<string, unknown>
  extensions?: Record<string, unknown>
}

/** The verify/settle surface of @x402/core's HTTPFacilitatorClient. */
export interface CdpFacilitatorClient {
  verify(payload: CdpPaymentPayload, requirements: CdpPaymentRequirements): Promise<{
    isValid: boolean; invalidReason?: string; payer?: string
  }>
  settle(payload: CdpPaymentPayload, requirements: CdpPaymentRequirements): Promise<{
    success: boolean; errorReason?: string; payer?: string; transaction: string
  }>
}

export interface CdpFacilitatorDeps {
  /** A constructed HTTPFacilitatorClient (CDP-authed). */
  client: CdpFacilitatorClient
  /** `decodePaymentSignatureHeader` from `@x402/core/http` — base64 header → payload. */
  decodePayment: (header: string) => CdpPaymentPayload
}

/** Our X402Accept → the CDP PaymentRequirements we verify/settle against (never the payer's). */
function toRequirements(accept: X402Accept): CdpPaymentRequirements {
  return {
    scheme: accept.scheme,
    network: accept.network,
    asset: accept.asset,
    amount: accept.amount,
    payTo: accept.payTo,
    maxTimeoutSeconds: accept.maxTimeoutSeconds,
    extra: accept.extra ? { ...accept.extra } : {},
  }
}

/** Stable replay key — the raw header embeds the signed authorization's unique nonce. */
function signatureHashOf(paymentHeader: string): string {
  return createHash('sha256').update(paymentHeader).digest('hex')
}

export function createCdpX402Facilitator(deps: CdpFacilitatorDeps): X402Facilitator {
  return {
    async verify(paymentHeader: string, accept: X402Accept): Promise<X402VerifyResult> {
      let payload: CdpPaymentPayload
      try {
        payload = deps.decodePayment(paymentHeader)
      } catch (err) {
        return { valid: false, error: `malformed X-PAYMENT header: ${(err as Error).message}` }
      }
      let resp
      try {
        resp = await deps.client.verify(payload, toRequirements(accept))
      } catch (err) {
        return { valid: false, error: `facilitator verify failed: ${(err as Error).message}` }
      }
      if (!resp.isValid) {
        return { valid: false, error: resp.invalidReason ?? 'payment invalid' }
      }
      return {
        valid: true,
        payer: (resp.payer ?? '').toLowerCase(),
        amount: accept.amount,               // authorised ≥ our price (verified against OUR requirements)
        signatureHash: signatureHashOf(paymentHeader),
      }
    },

    async settle(paymentHeader: string, accept: X402Accept): Promise<X402SettleResult> {
      let payload: CdpPaymentPayload
      try {
        payload = deps.decodePayment(paymentHeader)
      } catch (err) {
        return { success: false, error: `malformed X-PAYMENT header: ${(err as Error).message}` }
      }
      let resp
      try {
        resp = await deps.client.settle(payload, toRequirements(accept))
      } catch (err) {
        return { success: false, error: `facilitator settle failed: ${(err as Error).message}` }
      }
      if (!resp.success) {
        return { success: false, error: resp.errorReason ?? 'settlement failed' }
      }
      return { success: true, transaction: resp.transaction }
    },
  }
}
